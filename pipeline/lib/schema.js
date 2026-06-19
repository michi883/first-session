// Canonical therapist record shape for the First Session project.
//
// IMPORTANT (product guidance): we deliberately do NOT normalize into a medical
// taxonomy here. Raw text fields (`raw_card_text`, `raw_profile_text`,
// `insurance_text`, etc.) are preserved verbatim so downstream AI + human review
// can later compress profiles into parent-friendly, emotionally meaningful
// summaries. The enrichment fields below are intentionally left empty for that
// later stage.

/** Ordered list of every field a record carries. Used to keep JSON + CSV in sync. */
export const FIELD_ORDER = [
  // --- core captured fields ---
  "name",
  "credentials_or_title",
  "profile_url",
  "headshot_url",
  "location",
  "accepts_medicaid",
  "works_with_teens",
  "specialties",
  "issues",
  "treatment_approaches",
  "insurance_text",
  "availability_text",
  "raw_card_text",
  "raw_profile_text",
  "phone_or_contact_text",
  "source_search_url",
  "extracted_at",
  // --- First Session enrichment (populated by Gemini in lib/enrich.js) ---
  "child_fit_signals",
  "parent_concern_signals",
  "communication_style_signals",
  "emotional_tone_summary",
  "parent_friendly_summary",
  "possible_good_fit_for",
  "possible_less_ideal_if",
  "parent_question_suggestions",
  "confidence_notes",
  "data_quality_notes",
];

/**
 * Describes the First Session UX fields Gemini fills. Shared by the enrichment
 * prompt, validation, and empty-fallback logic so the contract stays in one place.
 *   "array"  -> string[]   "string" -> string
 * NOTE: data_quality_notes is intentionally excluded here — it is owned by the
 * extractor/validator (we append to it), not overwritten by the model.
 */
export const ENRICHMENT_FIELDS = {
  child_fit_signals: "array",
  parent_concern_signals: "array",
  communication_style_signals: "array",
  emotional_tone_summary: "string",
  parent_friendly_summary: "string",
  possible_good_fit_for: "array",
  possible_less_ideal_if: "array",
  parent_question_suggestions: "array",
  confidence_notes: "array",
};

// ---------------------------------------------------------------------------
// Controlled First Session UX taxonomy
// ---------------------------------------------------------------------------
//
// Three enrichment fields are constrained to fixed label sets so the app can
// rely on stable chips, filters, and cards. Gemini is prompted to pick ONLY
// from these lists; the validator repairs/removes anything off-list.

export const CHILD_FIT_LABELS = [
  "Withdrawn",
  "Overwhelmed",
  "Big emotions",
  "Anxious",
  "Burned out",
  "Lonely",
  "Emotionally guarded",
  "School stress",
  "Friendship struggles",
  "Family conflict",
  "Identity exploration",
  "Trauma support",
  "Creative teen",
  "Not sure",
];

export const PARENT_CONCERN_LABELS = [
  "Child may not open up",
  "Child may feel judged",
  "Needs gentle approach",
  "Needs structure",
  "Needs identity-affirming care",
  "Needs trauma-informed care",
  "Needs help with anxiety",
  "Needs school support",
  "Needs family involvement",
  "Wants practical coping skills",
  "Unsure where to start",
];

export const COMMUNICATION_STYLE_LABELS = [
  "Warm",
  "Gentle",
  "Structured",
  "Collaborative",
  "Affirming",
  "Skills-focused",
  "Insight-oriented",
  "Creative",
  "Relational",
  "Direct",
  "Nonjudgmental",
  "Culturally responsive",
];

/** Maps each taxonomy-controlled field to its allowed label list. */
export const TAXONOMY_FIELDS = {
  child_fit_signals: CHILD_FIT_LABELS,
  parent_concern_signals: PARENT_CONCERN_LABELS,
  communication_style_signals: COMMUNICATION_STYLE_LABELS,
};

// "Catch-all" labels used only when the profile is broad / not specific enough.
export const TAXONOMY_FALLBACK_LABEL = {
  child_fit_signals: "Not sure",
  parent_concern_signals: "Unsure where to start",
  communication_style_signals: null, // no catch-all for style
};

// How many labels each taxonomy field should hold.
export const TAXONOMY_MIN = 2;
export const TAXONOMY_MAX = 5;

// Synonym → canonical label, applied ONLY when the match is obvious. Keyed by a
// normalized form (lowercase, alphanumerics). The validator uses this to repair
// near-misses (e.g. "Compassionate" → "Warm"); anything else is dropped.
export const TAXONOMY_SYNONYMS = {
  child_fit_signals: {
    anxiety: "Anxious",
    anxious: "Anxious",
    worried: "Anxious",
    shy: "Withdrawn",
    isolated: "Lonely",
    alone: "Lonely",
    stressed: "Overwhelmed",
    overwhelm: "Overwhelmed",
    "big feelings": "Big emotions",
    "intense emotions": "Big emotions",
    "emotional dysregulation": "Big emotions",
    "shut down": "Emotionally guarded",
    guarded: "Emotionally guarded",
    "closed off": "Emotionally guarded",
    burnout: "Burned out",
    exhausted: "Burned out",
    "academic stress": "School stress",
    "school pressure": "School stress",
    "school issues": "School stress",
    "peer relationships": "Friendship struggles",
    "social struggles": "Friendship struggles",
    friendships: "Friendship struggles",
    "family issues": "Family conflict",
    "family stress": "Family conflict",
    identity: "Identity exploration",
    lgbtq: "Identity exploration",
    "gender identity": "Identity exploration",
    trauma: "Trauma support",
    ptsd: "Trauma support",
    creative: "Creative teen",
    artistic: "Creative teen",
    "creative individuals": "Creative teen",
  },
  parent_concern_signals: {
    "may not open up": "Child may not open up",
    "may not talk": "Child may not open up",
    "fears judgment": "Child may feel judged",
    "feels judged": "Child may feel judged",
    gentle: "Needs gentle approach",
    structure: "Needs structure",
    routine: "Needs structure",
    "identity affirming": "Needs identity-affirming care",
    "lgbtq affirming": "Needs identity-affirming care",
    "affirming care": "Needs identity-affirming care",
    "trauma informed": "Needs trauma-informed care",
    "trauma informed care": "Needs trauma-informed care",
    "help with anxiety": "Needs help with anxiety",
    "anxiety help": "Needs help with anxiety",
    "school support": "Needs school support",
    "academic support": "Needs school support",
    "family involvement": "Needs family involvement",
    "family therapy": "Needs family involvement",
    "coping skills": "Wants practical coping skills",
    "practical skills": "Wants practical coping skills",
    skills: "Wants practical coping skills",
    "not sure": "Unsure where to start",
    unsure: "Unsure where to start",
  },
  communication_style_signals: {
    compassionate: "Warm",
    caring: "Warm",
    empathetic: "Warm",
    empathic: "Warm",
    supportive: "Warm",
    kind: "Warm",
    soft: "Gentle",
    "client centered": "Collaborative",
    "person centered": "Collaborative",
    "client focused": "Collaborative",
    collaborative: "Collaborative",
    "solution focused": "Skills-focused",
    practical: "Skills-focused",
    "skill based": "Skills-focused",
    "strength based": "Skills-focused",
    psychodynamic: "Insight-oriented",
    "depth oriented": "Insight-oriented",
    reflective: "Insight-oriented",
    "art based": "Creative",
    expressive: "Creative",
    playful: "Creative",
    "attachment based": "Relational",
    relational: "Relational",
    straightforward: "Direct",
    honest: "Direct",
    frank: "Direct",
    "non judgmental": "Nonjudgmental",
    nonjudgmental: "Nonjudgmental",
    accepting: "Nonjudgmental",
    "culturally sensitive": "Culturally responsive",
    "culturally aware": "Culturally responsive",
    multicultural: "Culturally responsive",
    "lgbtq affirming": "Affirming",
    "identity affirming": "Affirming",
    affirming: "Affirming",
  },
};

/** Normalize a label for case/punctuation-insensitive matching. */
export function normalizeLabel(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A blank set of enrichment values (used as the fallback when Gemini fails). */
export function emptyEnrichment() {
  const out = {};
  for (const [field, type] of Object.entries(ENRICHMENT_FIELDS)) {
    out[field] = type === "array" ? [] : "";
  }
  return out;
}

/** Fields that hold arrays (joined with "; " when flattened to CSV). */
export const ARRAY_FIELDS = new Set([
  "specialties",
  "issues",
  "treatment_approaches",
  "child_fit_signals",
  "parent_concern_signals",
  "communication_style_signals",
  "possible_good_fit_for",
  "possible_less_ideal_if",
  "parent_question_suggestions",
  "confidence_notes",
  "data_quality_notes",
]);

/**
 * Produce a fully-populated record with safe defaults, then overlay `partial`.
 * Guarantees every field in FIELD_ORDER exists so JSON/CSV columns stay stable.
 */
export function makeRecord(partial = {}) {
  const base = {
    name: null,
    credentials_or_title: null,
    profile_url: null,
    headshot_url: null,
    location: null,
    accepts_medicaid: null,
    works_with_teens: null,
    specialties: [],
    issues: [],
    treatment_approaches: [],
    insurance_text: null,
    availability_text: null,
    raw_card_text: null,
    raw_profile_text: null,
    phone_or_contact_text: null,
    source_search_url: null,
    extracted_at: null,
    // enrichment placeholders (filled by lib/enrich.js)
    child_fit_signals: [],
    parent_concern_signals: [],
    communication_style_signals: [],
    emotional_tone_summary: "",
    parent_friendly_summary: "",
    possible_good_fit_for: [],
    possible_less_ideal_if: [],
    parent_question_suggestions: [],
    confidence_notes: [],
    data_quality_notes: [],
  };
  return { ...base, ...partial };
}

/**
 * Inspect a record and append warnings to data_quality_notes for any core field
 * that ended up empty. Helps the later enrichment stage know what to trust.
 */
export function addQualityNotes(record) {
  const notes = record.data_quality_notes;
  const flagIfEmpty = (field, label) => {
    const v = record[field];
    const empty =
      v === null ||
      v === undefined ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty) notes.push(`missing:${label || field}`);
  };

  flagIfEmpty("name");
  flagIfEmpty("headshot_url");
  flagIfEmpty("location");
  flagIfEmpty("raw_profile_text", "raw_profile_text (profile may not have been fetched)");
  flagIfEmpty("specialties");
  flagIfEmpty("insurance_text");

  return record;
}
