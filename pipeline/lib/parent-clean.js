// Shared, deterministic cleanup for the parent-shareable spreadsheet.
//
// The parent-facing sheet (therapists_parent_shareable.tsv) is meant to be scanned
// quickly by overwhelmed parents. Two columns tend to get noisy:
//
//   * "Noted Focus Areas" mixes clinical terms with parent-language emotional tags
//     and frequently lists near-duplicates (Anxiety + Anxious, Trauma and PTSD +
//     Trauma support).
//   * "Therapist Style" can carry more labels than anyone wants to read.
//
// This module reduces both to at most THREE short, conservative, parent-readable
// items using deterministic rules only — normalization maps + priority ordering.
// There are NO AI/API calls here, so it is safe, fast, and repeatable. It is the
// single source of truth shared by both the permanent exporter (pipeline/lib/export.js)
// and the one-off migration script (pipeline/clean-parent-shareable-tsv.js).

// ---------------------------------------------------------------------------
// Noted Focus Areas
// ---------------------------------------------------------------------------

/**
 * Canonical focus terms in display form, ordered by importance. When several
 * candidates survive cleaning, items earlier in this list win the limited slots.
 * These are the specifics worth preserving for a parent skimming the sheet.
 */
export const FOCUS_PRIORITY = [
  "Autism",
  "ADHD",
  "Anxiety",
  "Depression",
  "Trauma",
  "School stress",
  "Family conflict",
  "Identity support",
  "LGBTQ+",
  "Substance use",
  "Eating disorders",
  "Self-esteem",
  "Parenting",
  "Relationship issues",
  "Grief",
];

/**
 * Map of raw cell value (lowercased, whitespace-collapsed) -> canonical display
 * term. Folds casing variants and near-duplicates onto one term so dedup works
 * (e.g. "anxious" and "anxiety" both become "Anxiety"). Values that map to a
 * FOCUS_PRIORITY entry are treated as priority items; the rest (e.g. "Life
 * transitions") are normalized for consistency but ranked as secondary.
 */
export const FOCUS_NORMALIZE = {
  // Autism
  autism: "Autism",
  "asperger's syndrome": "Autism",
  "asperger syndrome": "Autism",
  "autism spectrum": "Autism",
  // ADHD
  adhd: "ADHD",
  "add/adhd": "ADHD",
  // Anxiety
  anxiety: "Anxiety",
  anxious: "Anxiety",
  // Depression
  depression: "Depression",
  // Trauma
  trauma: "Trauma",
  "trauma and ptsd": "Trauma",
  "trauma support": "Trauma",
  "trauma-informed": "Trauma",
  ptsd: "Trauma",
  // School stress
  "school stress": "School stress",
  "school issues": "School stress",
  // Family conflict
  "family conflict": "Family conflict",
  // Identity support
  "identity support": "Identity support",
  "identity exploration": "Identity support",
  // LGBTQ+
  "lgbtq+": "LGBTQ+",
  lgbtq: "LGBTQ+",
  // Substance use
  "substance use": "Substance use",
  "substance abuse": "Substance use",
  addiction: "Substance use",
  "alcohol use": "Substance use",
  "drug abuse": "Substance use",
  // Eating disorders
  "eating disorders": "Eating disorders",
  "eating disorder": "Eating disorders",
  // Self-esteem
  "self esteem": "Self-esteem",
  "self-esteem": "Self-esteem",
  // Parenting
  parenting: "Parenting",
  // Relationship issues
  "relationship issues": "Relationship issues",
  "peer relationships": "Relationship issues",
  "friendship struggles": "Relationship issues",
  // Grief
  grief: "Grief",
  "grief and loss": "Grief",
  // Secondary (non-priority) normalizations, for casing/consistency only:
  "life transitions": "Life transitions",
};

/**
 * Vague / overly broad terms. These are only used to fill remaining slots when
 * fewer than 3 stronger (priority or secondary) items are available, matching the
 * "keep only if no stronger term is present" rule.
 */
export const FOCUS_DEMOTE = new Set([
  "overwhelmed",
  "stress",
  "coping skills",
  "mood disorders",
  "behavioral issues",
  "big emotions",
  "burned out",
  "lonely",
  "emotional regulation",
  "emotional disturbance",
  "crisis intervention",
]);

const MAX_ITEMS = 3;

/** Normalize a single raw value: trim + collapse internal whitespace. */
function tidy(raw) {
  if (raw == null) return "";
  return String(raw).replace(/\s+/g, " ").trim();
}

/**
 * Clean a list of raw focus strings down to at most 3 conservative, deduplicated,
 * priority-ordered terms. Input is the already-split list (one topic per element);
 * output is an array of display strings. Deterministic — never invents a topic.
 */
export function cleanFocusList(rawItems) {
  const priority = []; // { term, idx }
  const secondary = []; // term
  const demoted = []; // term
  const seen = new Set(); // canonical lowercased keys (cross-bucket dedup)

  for (const raw of rawItems || []) {
    const orig = tidy(raw);
    if (!orig) continue;
    const lower = orig.toLowerCase();
    const canonical = FOCUS_NORMALIZE[lower] || orig;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const idx = FOCUS_PRIORITY.indexOf(canonical);
    if (idx !== -1) {
      priority.push({ term: canonical, idx });
    } else if (FOCUS_DEMOTE.has(lower)) {
      demoted.push(canonical);
    } else {
      secondary.push(canonical);
    }
  }

  priority.sort((a, b) => a.idx - b.idx);
  const ordered = [...priority.map((p) => p.term), ...secondary, ...demoted];
  return ordered.slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------------
// Therapist Style
// ---------------------------------------------------------------------------

/**
 * Allowed style labels in display form, ordered by preference. Limited slots are
 * filled following this order, giving the sheet a consistent, calm vocabulary.
 */
export const STYLE_PREFERRED = [
  "Warm",
  "Gentle",
  "Structured",
  "Collaborative",
  "Affirming",
  "Nonjudgmental",
  "Skills-focused",
  "Culturally responsive",
  "Relational",
  "Direct",
  "Creative",
  "Insight-oriented",
];

/** Raw style value (lowercased) -> canonical preferred label. */
export const STYLE_NORMALIZE = {
  warm: "Warm",
  gentle: "Gentle",
  structured: "Structured",
  collaborative: "Collaborative",
  affirming: "Affirming",
  nonjudgmental: "Nonjudgmental",
  "non-judgmental": "Nonjudgmental",
  "non judgmental": "Nonjudgmental",
  "skills-focused": "Skills-focused",
  "skills focused": "Skills-focused",
  "skill-focused": "Skills-focused",
  "skills based": "Skills-focused",
  "skills-based": "Skills-focused",
  "culturally responsive": "Culturally responsive",
  "culturally-responsive": "Culturally responsive",
  relational: "Relational",
  direct: "Direct",
  creative: "Creative",
  "insight-oriented": "Insight-oriented",
  "insight oriented": "Insight-oriented",
};

/**
 * Clean a list of raw style strings down to at most 3 deduplicated labels.
 * Preferred-set labels are emitted in preferred order; any value not in the set
 * is kept (uninvented) only as a fallback to fill remaining slots.
 */
export function cleanStyleList(rawItems) {
  const matched = []; // { term, idx }
  const extra = []; // term (unmapped fallback)
  const seen = new Set();

  for (const raw of rawItems || []) {
    const orig = tidy(raw);
    if (!orig) continue;
    const canonical = STYLE_NORMALIZE[orig.toLowerCase()];
    if (canonical) {
      const key = canonical.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push({ term: canonical, idx: STYLE_PREFERRED.indexOf(canonical) });
    } else {
      const key = orig.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(orig);
    }
  }

  matched.sort((a, b) => a.idx - b.idx);
  const ordered = [...matched.map((m) => m.term), ...extra];
  return ordered.slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------------
// Record-level helpers (used by the exporter)
// ---------------------------------------------------------------------------

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Build the cleaned "Noted Focus Areas" list for an enriched record. Pulls from
 * the same conservative fields the sheet has always used (specialties, issues,
 * child_fit_signals) and runs them through the shared focus cleaner. Returns an
 * array of at most 3 display strings.
 */
export function cleanNotedFocusAreas(record) {
  const items = [
    ...asArray(record.specialties),
    ...asArray(record.issues),
    ...asArray(record.child_fit_signals),
  ];
  return cleanFocusList(items);
}

/**
 * Build the cleaned "Therapist Style" list for an enriched record from
 * communication_style_signals. Returns an array of at most 3 display strings.
 */
export function cleanTherapistStyle(record) {
  return cleanStyleList(asArray(record.communication_style_signals));
}
