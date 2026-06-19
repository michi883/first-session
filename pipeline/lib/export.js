// Parent-facing TSV exporter for the First Session spreadsheet workflow.
//
// This produces the PRIMARY community-feedback artifact: a clean, tab-separated
// file that imports straight into Google Sheets and can be shared with NYC parent
// communities. It deliberately omits the noisy/internal fields (raw_card_text,
// raw_profile_text, full insurance blobs, extraction metadata) and keeps only the
// concise, parent-readable columns. JSON remains the source of truth for audit and
// the app — see pipeline/lib/csv.js for the full-fidelity CSV.
//
// TSV (not CSV) is preferred because therapist text frequently contains commas;
// tabs are far less ambiguous and Google Sheets imports TSV cleanly. Every cell is
// flattened to a single line so each therapist stays on exactly one row.

import { cleanNotedFocusAreas, cleanTherapistStyle } from "./parent-clean.js";

/**
 * Internal full-spreadsheet columns, in order. This is the working sheet for QA,
 * enrichment review, and deciding which columns are actually useful — it keeps the
 * fuller, more clinical fields (Specialties, Issues, Treatment Approaches, Data
 * Quality Notes). The last two (`Community Feedback`, `Parent Notes`) are left blank
 * for humans to fill in.
 */
export const INTERNAL_COLUMNS = [
  "Name",
  "Credentials",
  "Psychology Today Profile",
  "Location / Online",
  "Contact",
  "Medicaid Listed",
  "Works With Teens",
  "Specialties",
  "Issues",
  "Treatment Approaches",
  "Emotional Tone",
  "Communication Style",
  "May Be A Good Fit For",
  "May Be Less Ideal If",
  "Questions Parents May Ask",
  "Availability Notes",
  "Data Quality Notes",
  "Community Feedback",
  "Parent Notes",
];

/**
 * Parent-shareable columns, in order. This is a community VERIFICATION sheet, not an
 * AI recommendation sheet: it deliberately drops every "fit" judgment (good-fit /
 * less-ideal / question suggestions / emotional-tone prose) and instead gives parents
 * practical info to confirm plus blank columns to record lived experience. Built only
 * from concise enriched/extracted fields — NO raw text, insurance, extraction
 * metadata, data-quality notes, or long clinical dumps.
 */
export const PARENT_COLUMNS = [
  "Name",
  "Online / In-person",
  "Contact",
  "Profile Link",
  "Short Profile Summary",
  "Noted Focus Areas",
  "Therapist Style",
  "Has anyone contacted them?",
  "Accepting new clients?",
  "Medicaid confirmed?",
  "Experience with teens?",
  "Parent/community notes",
];

// Backward-compatibility alias. The old single export used this name.
export const TSV_COLUMNS = INTERNAL_COLUMNS;

/**
 * Flatten a value into a single-line, tab-safe TSV cell. Arrays are joined with
 * "; "; tabs/newlines are collapsed to spaces so a long blurb can never spill into
 * a second row. Trims and de-doubles whitespace for readability.
 */
function tsvCell(value) {
  if (value == null) return "";
  const s = Array.isArray(value) ? value.filter((v) => v != null && v !== "").join("; ") : String(value);
  return s.replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Boolean → simple "Yes"/"No" for the parent-facing Medicaid / Teens columns. */
function yesNo(v) {
  return v ? "Yes" : "No";
}

/**
 * Infer in-person / online availability from the availability blurb so parents can
 * see at a glance whether a therapist offers virtual sessions. Best-effort only.
 */
function deriveModality(rec) {
  const t = `${rec.availability_text || ""}`.toLowerCase();
  const online = /\bonline\b|\bvirtual\b|telehealth|video/.test(t);
  const inPerson = /in[\s-]?person/.test(t);
  if (online && inPerson) return "In-person & online";
  if (online) return "Online";
  if (inPerson) return "In-person";
  return "";
}

/** Combine the location string with an in-person/online indicator. */
function locationOnline(rec) {
  const loc = tsvCell(rec.location);
  const modality = deriveModality(rec);
  if (loc && modality) return `${loc} · ${modality}`;
  return loc || modality || "";
}

/**
 * Produce a concise availability note from the (often long, repetitive)
 * availability_text. Prefers a "I am available …" sentence; otherwise truncates the
 * cleaned blurb so it stays readable in a spreadsheet cell.
 */
function availabilityNote(rec) {
  let t = rec.availability_text;
  if (!t) return "";
  t = String(t)
    .replace(/^My Practice at a Glance\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = t.match(/I am available[^.]*\./i);
  let note = sentence ? sentence[0].trim() : t;
  if (note.length > 240) note = note.slice(0, 237).trimEnd() + "…";
  return tsvCell(note);
}

// ---------------------------------------------------------------------------
// Parent-shareable helpers (community verification sheet)
// ---------------------------------------------------------------------------

/**
 * Simple, parent-readable delivery mode inferred from location + availability text.
 * One of: "Online only", "In-person and online", "In-person", "Unknown".
 */
function onlineInPerson(rec) {
  const avail = `${rec.availability_text || ""}`;
  const t = avail.toLowerCase();
  const loc = `${rec.location || ""}`;
  const online = /\bonline\b|\bvirtual\b|telehealth|video/.test(t);
  // In-person if the text says so, or there's a concrete street address / ZIP.
  const inPerson =
    /in[\s-]?person/.test(t) || /\d{2,}\s+\w+/.test(avail) || /\b\d{5}\b/.test(loc);
  if (online && inPerson) return "In-person and online";
  if (online) return "Online only";
  if (inPerson) return "In-person";
  return "Unknown";
}

/**
 * Lightly rewrite the Gemini summary so it reads as a neutral description of the
 * profile rather than a "good fit" recommendation. Keeps cautious, humble framing.
 */
function shortProfileSummary(rec) {
  let t = rec.parent_friendly_summary;
  if (!t) return "";
  t = String(t);
  // Replace recommendation lead-ins (incl. a leading "<Name> ..." prefix).
  t = t.replace(/^[^.]*?\bmay be a (?:good|strong) fit for\b/i, "Profile describes support for");
  t = t.replace(/^[^.]*?\bmay fit\b/i, "Profile mentions support for");
  // Mop up any remaining inline recommendation phrasing.
  t = t.replace(/\bmay be a (?:good|strong) fit for\b/gi, "supports");
  t = t.replace(/\bmay be a (?:good|strong) fit\b/gi, "Profile describes");
  t = t.replace(/\bmay fit\b/gi, "supports");
  return tsvCell(t);
}

// "Noted Focus Areas" and "Therapist Style" are intentionally limited to 3 concise,
// conservative items to reduce parent scanning fatigue. The deterministic rules
// (normalization maps + priority ordering) live in ./parent-clean.js so the exporter
// and the one-off migration script (pipeline/clean-parent-shareable-tsv.js) stay in
// sync. The internal QA sheet keeps the fuller raw fields untouched.

/** Map one enriched record to the parent-shareable (community verification) cells. */
function recordToParentCells(rec) {
  return {
    "Name": tsvCell(rec.name),
    "Online / In-person": onlineInPerson(rec),
    "Contact": tsvCell(rec.phone_or_contact_text),
    "Profile Link": tsvCell(rec.profile_url),
    "Short Profile Summary": shortProfileSummary(rec),
    "Noted Focus Areas": tsvCell(cleanNotedFocusAreas(rec)),
    "Therapist Style": tsvCell(cleanTherapistStyle(rec)),
    // Blank community-verification / feedback columns:
    "Has anyone contacted them?": "",
    "Accepting new clients?": "",
    "Medicaid confirmed?": "",
    "Experience with teens?": "",
    "Parent/community notes": "",
  };
}

/** Map one enriched record to its parent-facing column values. */
function recordToCells(rec) {
  return {
    "Name": tsvCell(rec.name),
    "Credentials": tsvCell(rec.credentials_or_title),
    "Psychology Today Profile": tsvCell(rec.profile_url),
    "Location / Online": locationOnline(rec),
    "Contact": tsvCell(rec.phone_or_contact_text),
    "Medicaid Listed": yesNo(rec.accepts_medicaid),
    "Works With Teens": yesNo(rec.works_with_teens),
    "Specialties": tsvCell(rec.specialties),
    "Issues": tsvCell(rec.issues),
    "Treatment Approaches": tsvCell(rec.treatment_approaches),
    "Emotional Tone": tsvCell(rec.emotional_tone_summary),
    "Communication Style": tsvCell(rec.communication_style_signals),
    "May Be A Good Fit For": tsvCell(rec.possible_good_fit_for),
    "May Be Less Ideal If": tsvCell(rec.possible_less_ideal_if),
    "Questions Parents May Ask": tsvCell(rec.parent_question_suggestions),
    "Availability Notes": availabilityNote(rec),
    "Data Quality Notes": tsvCell(rec.data_quality_notes),
    "Community Feedback": "", // left blank for manual spreadsheet use
    "Parent Notes": "", // left blank for manual spreadsheet use
  };
}

/**
 * Serialize records into a TSV string: a header row of `columns` followed by one
 * single-line row per therapist, built via `cellBuilder`. `columns` + `cellBuilder`
 * default to the fuller internal set for backward compatibility.
 */
export function recordsToTsv(records, columns = INTERNAL_COLUMNS, cellBuilder = recordToCells) {
  const header = columns.join("\t");
  const rows = (records || []).map((rec) => {
    const cells = cellBuilder(rec);
    return columns.map((col) => cells[col] ?? "").join("\t");
  });
  return [header, ...rows].join("\n") + "\n";
}

/** Internal full-fidelity QA spreadsheet (therapists_internal.tsv). */
export function recordsToInternalTsv(records) {
  return recordsToTsv(records, INTERNAL_COLUMNS, recordToCells);
}

/** Simplified, parent-shareable community verification sheet (therapists_parent_shareable.tsv). */
export function recordsToParentTsv(records) {
  return recordsToTsv(records, PARENT_COLUMNS, recordToParentCells);
}
