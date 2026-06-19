// Gemini-based enrichment for First Session.
//
// Turns a therapist's extracted PUBLIC profile text into parent-friendly UX
// fields (see ENRICHMENT_FIELDS in schema.js). This module NEVER mutates the
// raw extracted fields — it only produces the enrichment values, which the
// caller overlays onto a copy of the record.
//
// Product guardrails (encoded in the prompt below): use only what's in the
// profile text, never claim "best"/"guaranteed", prefer cautious wording, keep
// language simple and non-clinical, and never give medical advice.

import {
  ENRICHMENT_FIELDS,
  emptyEnrichment,
  TAXONOMY_FIELDS,
  TAXONOMY_SYNONYMS,
  TAXONOMY_MIN,
  TAXONOMY_MAX,
  normalizeLabel,
} from "./schema.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Model preference order. The caller passes the resolved list, but these are the
// defaults referenced in the spec.
export const DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"];

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Render the allowed-label lists into the prompt from the single source of truth. */
function taxonomyBlock() {
  const list = (field) => TAXONOMY_FIELDS[field].map((l) => `"${l}"`).join(", ");
  return `CONTROLLED TAXONOMY — these three fields MUST use ONLY the exact labels below (copy them verbatim, same spelling and capitalization). Do not invent, rephrase, pluralize, or combine labels.

child_fit_signals — choose ${TAXONOMY_MIN}-${TAXONOMY_MAX} from:
  ${list("child_fit_signals")}

parent_concern_signals — choose ${TAXONOMY_MIN}-${TAXONOMY_MAX} from:
  ${list("parent_concern_signals")}

communication_style_signals — choose ${TAXONOMY_MIN}-${TAXONOMY_MAX} from:
  ${list("communication_style_signals")}`;
}

const SYSTEM_GUIDANCE = `You help "First Session", a calmer mobile-first experience that helps overwhelmed parents choose a therapist for their child.
Your job: read ONE therapist's public profile and produce short, parent-friendly UX fields that make emotional fit easy to scan on a phone.

${taxonomyBlock()}

TAXONOMY RULES:
- Use ONLY the exact labels listed above for child_fit_signals, parent_concern_signals, and communication_style_signals.
- Select ${TAXONOMY_MIN} to ${TAXONOMY_MAX} labels for each of those three fields.
- Do NOT invent new labels or alter wording. If the profile does not clearly support a label, do not use it.
- Use "Not sure" (child_fit_signals) or "Unsure where to start" (parent_concern_signals) only when the profile is broad or not specific enough to choose more specific labels.

EVIDENCE RULES:
- Use ONLY information present in the provided fields: raw_card_text, raw_profile_text, specialties, issues, treatment_approaches, availability_text, insurance_text. Do not assume anything not in the text.
- Do NOT infer diagnosis, clinical effectiveness, or guaranteed fit. Do not evaluate credentials or quality.
- Never say a therapist is "best", "guaranteed", or "top". Use cautious wording: "may fit", "profile suggests", "may be worth asking about".
- Keep all parent-facing language simple, warm, non-clinical, and mobile-friendly.
- If evidence for a free-text field is weak, return a shorter value (or empty) rather than guessing.

FREE-TEXT FIELDS (not taxonomy-controlled):
- emotional_tone_summary: a short phrase, e.g. "Warm, affirming, and skills-focused."
- parent_friendly_summary: ONE cautious sentence, e.g. "May fit teens who feel anxious or overwhelmed and need a warm, affirming therapist who builds trust gradually."
- possible_good_fit_for: 1-4 short cautious phrases, e.g. "Teens working through anxiety".
- possible_less_ideal_if: 1-4 cautious phrases grounded in missing or explicit signals, e.g. "May be less ideal if you are looking for clearly stated in-person availability."
- parent_question_suggestions: 2-4 simple questions a parent could ask in a first call, e.g. "How do you help a teen who shuts down?".
- confidence_notes: short notes on how strong the evidence was, e.g. "Profile text was brief".

Return STRICT JSON ONLY (no markdown, no commentary) matching the requested schema.`;

/** Compact, labeled view of just the public fields the model is allowed to use. */
function buildProfileContext(record) {
  const parts = [
    ["Name", record.name],
    ["Credentials/Title", record.credentials_or_title],
    ["Location", record.location],
    ["Specialties", (record.specialties || []).join(", ")],
    ["Issues/Expertise", (record.issues || []).join(", ")],
    ["Treatment approaches", (record.treatment_approaches || []).join(", ")],
    ["Insurance", record.insurance_text],
    ["Availability", record.availability_text],
    ["Profile text", record.raw_profile_text || record.raw_card_text],
  ];
  return parts
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([label, v]) => `${label}: ${v}`)
    .join("\n");
}

/** Build a responseSchema (OpenAPI subset) from ENRICHMENT_FIELDS for strict JSON. */
function buildResponseSchema() {
  const properties = {};
  for (const [field, type] of Object.entries(ENRICHMENT_FIELDS)) {
    if (type !== "array") {
      properties[field] = { type: "string" };
      continue;
    }
    // Taxonomy fields are constrained to their enum at the schema level too, so
    // the model is pushed hard toward valid labels (the validator still repairs).
    const allowed = TAXONOMY_FIELDS[field];
    properties[field] = allowed
      ? { type: "array", maxItems: TAXONOMY_MAX, items: { type: "string", enum: allowed } }
      : { type: "array", items: { type: "string" } };
  }
  return {
    type: "object",
    properties,
    required: Object.keys(ENRICHMENT_FIELDS),
    propertyOrdering: Object.keys(ENRICHMENT_FIELDS),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Precompute normalized lookups per taxonomy field (canonical + synonyms).
const TAXONOMY_LOOKUP = Object.fromEntries(
  Object.entries(TAXONOMY_FIELDS).map(([field, labels]) => {
    const canonicalByNorm = new Map(labels.map((l) => [normalizeLabel(l), l]));
    const synonymByNorm = new Map(
      Object.entries(TAXONOMY_SYNONYMS[field] || {}).map(([syn, canon]) => [normalizeLabel(syn), canon])
    );
    return [field, { canonicalByNorm, synonymByNorm }];
  })
);

/**
 * Constrain one taxonomy array to allowed labels:
 *  - exact (case/punct-insensitive) match → canonical label
 *  - obvious synonym → mapped canonical label (recorded as "repaired")
 *  - otherwise dropped (recorded), then capped at TAXONOMY_MAX.
 * Returns { kept, repaired:[[from,to]], dropped:[], truncated:[] }.
 */
export function repairTaxonomyField(field, items) {
  const { canonicalByNorm, synonymByNorm } = TAXONOMY_LOOKUP[field];
  const kept = [];
  const repaired = [];
  const dropped = [];
  const seen = new Set();

  for (const item of items) {
    const norm = normalizeLabel(item);
    let canon = canonicalByNorm.get(norm);
    if (!canon) {
      const mapped = synonymByNorm.get(norm);
      if (mapped) {
        canon = mapped;
        repaired.push([item, canon]);
      }
    }
    if (!canon) {
      dropped.push(item);
      continue;
    }
    if (!seen.has(canon)) {
      seen.add(canon);
      kept.push(canon);
    }
  }

  let truncated = [];
  if (kept.length > TAXONOMY_MAX) {
    truncated = kept.slice(TAXONOMY_MAX);
    kept.length = TAXONOMY_MAX;
  }
  return { kept, repaired, dropped, truncated };
}

/**
 * Validate + normalize a parsed enrichment object against the contract.
 * Returns { ok, values, errors, notes }:
 *  - array fields coerced to trimmed non-empty strings
 *  - the three taxonomy fields constrained to allowed labels (repair/drop/cap)
 *  - `notes` are human-facing data_quality_notes additions (repairs/removals)
 *  - `errors` with a structural problem (missing field / wrong base type) → !ok → retry
 */
export function validateEnrichment(parsed) {
  const errors = [];
  const notes = [];
  const values = {};
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, values: emptyEnrichment(), errors: ["response was not a JSON object"], notes };
  }

  for (const [field, type] of Object.entries(ENRICHMENT_FIELDS)) {
    const raw = parsed[field];
    if (type === "array") {
      if (!Array.isArray(raw)) {
        errors.push(`${field} is not an array`);
        values[field] = [];
        continue;
      }
      let items = raw
        .filter((x) => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean);
      if (raw.some((x) => typeof x !== "string")) errors.push(`${field} had non-string items`);

      // Apply controlled-taxonomy repair to the three constrained fields.
      if (TAXONOMY_FIELDS[field]) {
        const { kept, repaired, dropped, truncated } = repairTaxonomyField(field, items);
        items = kept;
        if (repaired.length) {
          notes.push(`${field}: repaired ${repaired.map(([f, t]) => `"${f}"→"${t}"`).join(", ")}`);
        }
        if (dropped.length) {
          notes.push(`${field}: removed unsupported label(s) ${dropped.map((d) => `"${d}"`).join(", ")}`);
        }
        if (truncated.length) {
          notes.push(`${field}: trimmed to ${TAXONOMY_MAX} labels (dropped ${truncated.map((t) => `"${t}"`).join(", ")})`);
        }
        if (items.length < TAXONOMY_MIN) {
          notes.push(`${field}: only ${items.length} supported label(s) (target ${TAXONOMY_MIN}-${TAXONOMY_MAX})`);
        }
      }
      values[field] = items;
    } else {
      if (typeof raw !== "string") {
        errors.push(`${field} is not a string`);
        values[field] = "";
        continue;
      }
      values[field] = raw.trim();
    }
  }

  // Only hard-fail (retry) on structural problems: missing/wrong base types.
  const structural = errors.filter((e) => e.includes("not an array") || e.includes("not a string"));
  return { ok: structural.length === 0, values, errors, notes };
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

/** One generateContent call. Throws Error with .modelUnavailable on 404/unknown-model. */
async function callGemini({ apiKey, model, prompt, schema, timeoutMs = 30_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey, // key only ever travels in this header; never logged
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_GUIDANCE }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
      const looksLikeMissingModel =
        res.status === 404 || /not found|not supported|unknown|does not exist/i.test(body);
      err.modelUnavailable = looksLikeMissingModel;
      throw err;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
    if (!text.trim()) throw new Error("empty response from Gemini");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip accidental markdown fences and parse JSON; returns object or null. */
function parseJsonLoose(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    // Last resort: grab the outermost {...} block.
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an enricher bound to an API key + model preference list. The first
 * model that responds is cached so we don't re-probe unavailable models per record.
 *
 * @param {object} cfg
 * @param {string} cfg.apiKey
 * @param {string[]} cfg.models  preference order
 * @param {(...a:any)=>void} [cfg.log]
 */
export function createEnricher({ apiKey, models = DEFAULT_MODELS, log = console.log }) {
  if (!apiKey) throw new Error("createEnricher: missing apiKey");
  let resolvedModel = null;
  const schema = buildResponseSchema();

  async function generate(prompt) {
    const candidates = resolvedModel ? [resolvedModel] : models;
    let lastErr;
    for (const model of candidates) {
      try {
        const text = await callGemini({ apiKey, model, prompt, schema });
        if (resolvedModel !== model) {
          resolvedModel = model;
          log(`Gemini model in use: ${model}`);
        }
        return text;
      } catch (err) {
        lastErr = err;
        if (err.modelUnavailable && !resolvedModel) {
          log(`Gemini model "${model}" unavailable; trying next candidate.`);
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new Error(`No usable Gemini model among: ${models.join(", ")}`);
  }

  /**
   * Enrich one record. Returns { values, model, qualityNotes }.
   * - Retries once on invalid JSON / structural validation failure.
   * - On total failure returns empty enrichment + a data_quality_notes warning.
   */
  async function enrich(record) {
    const prompt = `Therapist public profile:\n\n${buildProfileContext(record)}\n\nReturn the JSON object now.`;
    const qualityNotes = [];

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await generate(prompt);
        const parsed = parseJsonLoose(text);
        if (!parsed) {
          log(`  ! Gemini returned non-JSON (attempt ${attempt}/2).`);
          if (attempt === 1) continue;
          break;
        }
        const { ok, values, errors, notes } = validateEnrichment(parsed);
        if (!ok) {
          log(`  ! Gemini JSON failed validation (attempt ${attempt}/2): ${errors.join("; ")}`);
          if (attempt === 1) continue;
          // Second attempt still invalid: keep whatever coerced cleanly, note the rest.
          qualityNotes.push(`enrichment: partial — ${errors.join("; ")}`);
          qualityNotes.push(...notes);
          return { values, model: resolvedModel, qualityNotes };
        }
        // Taxonomy repair/removal notes are surfaced even on a clean parse.
        qualityNotes.push(...notes);
        if (notes.length) log(`    ~ taxonomy adjustments: ${notes.length} (see data_quality_notes)`);
        return { values, model: resolvedModel, qualityNotes };
      } catch (err) {
        log(`  ! Gemini request error (attempt ${attempt}/2): ${err.message}`);
        if (attempt === 1) continue;
        qualityNotes.push(`enrichment failed: ${err.message}`);
        return { values: emptyEnrichment(), model: resolvedModel, qualityNotes };
      }
    }

    qualityNotes.push("enrichment failed: invalid model output after retry; saved empty enrichment");
    return { values: emptyEnrichment(), model: resolvedModel, qualityNotes };
  }

  return {
    enrich,
    get model() {
      return resolvedModel;
    },
  };
}
