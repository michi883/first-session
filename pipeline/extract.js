#!/usr/bin/env node
/**
 * First Session — Psychology Today therapist extractor.
 *
 * Extracts therapist records from a filtered Psychology Today search result
 * (New York County · Medicaid · Teens), then enriches each one with Gemini into
 * parent-friendly UX fields. Writes two spreadsheet TSVs (a full internal QA sheet
 * and a simplified parent-shareable sheet) plus raw + enriched JSON/CSV. See CLAUDE.md.
 *
 * Usage:
 *   node pipeline/extract.js [--dry-run] [--max-records N] [--output-dir DIR]
 *                           [--headless true|false] [--delay-ms N]
 *                           [--no-resume] [--no-enrich] [--spreadsheet-only]
 *
 *   --spreadsheet-only rebuilds both TSVs (therapists_internal.tsv and
 *   therapists_parent_shareable.tsv) from an existing therapists_enriched.json
 *   without scraping again (errors if it doesn't exist).
 *
 * Env (.env, auto-loaded): GEMINI_API_KEY (required for enrichment),
 *   GEMINI_MODEL (optional; overrides the default model preference).
 *
 * Design notes:
 *  - Enrichment never mutates raw extracted fields; it only overlays UX fields
 *    onto a copy. therapists_raw.json holds the untouched extraction.
 *  - Polite-first: realistic browser, jittered delays, retry/backoff, sequential
 *    requests. A stealth fallback is documented in the README if PT blocks us.
 *  - Resumable: already-extracted profile_urls are persisted to seen_urls.json
 *    and skipped on rerun.
 *  - Failure-tolerant: a single bad profile is logged and skipped; the run
 *    continues. Card-level data is kept even if the profile fetch fails.
 *  - All CSS selectors live in SELECTORS so they're easy to patch when PT
 *    changes its markup (its DOM is unstable — see README).
 */

import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { makeRecord, addQualityNotes } from "./lib/schema.js";
import { recordsToCsv } from "./lib/csv.js";
import { recordsToInternalTsv, recordsToParentTsv } from "./lib/export.js";
import { createEnricher, DEFAULT_MODELS } from "./lib/enrich.js";

// Load .env (GEMINI_API_KEY, optional GEMINI_MODEL) if present. Node's built-in
// loader — no dependency. Never log the key itself.
try {
  if (existsSync(path.resolve(".env"))) process.loadEnvFile(path.resolve(".env"));
} catch {
  /* loadEnvFile throws if the file is malformed; enrichment will just be skipped */
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOURCE_SEARCH_URL =
  "https://www.psychologytoday.com/us/therapists/ny/new-york-county?category=medicaid&filters=2440";

// A current desktop Chrome UA. Playwright sets its own by default which leaks
// "HeadlessChrome"; overriding with a realistic one is the cheapest first step.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Centralized selectors. Each entry is an ordered list of candidates; the first
// one that matches wins. PT's class names shift, so we keep fallbacks.
const SELECTORS = {
  // A single therapist result on the search page.
  resultCard: [
    ".results-row",
    ".result-row",
    "[data-testid='result-row']",
    "div.profile-listing",
  ],
  // The link to a therapist's profile ("View" / name link) within a card.
  profileLink: [
    "a.profile-title",
    "a[data-testid='profile-link']",
    "a.results-row-link",
    "a[href*='/us/therapists/']",
  ],
  cardName: [".profile-title", "[data-testid='profile-name']", "h2 a", "h2"],
  cardCredentials: [".profile-subtitle-credentials", ".credentials", ".profile-subtitle"],
  cardLocation: [".profile-location", ".location", "[data-testid='location']"],
  cardPhoto: ["img.profile-img", ".profile-photo img", "img[src*='profile']", "img"],
  // NOTE: pagination is NOT selector-based. PT's "next page" markup changes
  // often and silently breaks next-link detection (it once stranded us at 20
  // results). We page by incrementing the `?page=N` URL param instead — see
  // searchUrlForPage() and the main loop.
  // Profile page sections (best-effort; verified/patched against live DOM).
  profileName: ["h1", "[data-testid='profile-name']", ".profile-name"],
  profileCredentials: [".profile-subtitle-credentials", ".credentials", "h1 + div"],
  profilePhoto: [".profile-img img", "img.profile-photo", "img[src*='profile']"],
  profileLocation: [".profile-location", ".location-address", "address"],
  profilePhone: ["a[href^='tel:']", ".profile-phone", "[data-testid='phone']"],
  // NOTE: specialties/issues/treatment/insurance are NOT scraped via simple
  // selectors — PT renders them as Vue `div.attributes-group` blocks keyed by an
  // `h3.attributes-group-title` heading. They're parsed by heading text in
  // `extractAttributes()`, which is robust to PT's frequent class-name churn.
};

// PT profile attribute groups, matched by heading text → our schema fields.
const ATTRIBUTE_GROUP_MAP = {
  specialties: "Top Specialties",
  issues: "Expertise",
  treatment_approaches: "Types of Therapy",
};

// Heuristic phrases for inferring the medicaid / teens booleans from text.
const MEDICAID_RE = /\bmedicaid\b/i;
const TEENS_RE = /\b(teen|teenager|adolescent|age\s*1[3-7])/i;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "max-records": { type: "string", default: "250" },
      "output-dir": { type: "string", default: "./data" },
      headless: { type: "string", default: "true" },
      "delay-ms": { type: "string", default: "3000" },
      "no-resume": { type: "boolean", default: false },
      "no-enrich": { type: "boolean", default: false },
      "spreadsheet-only": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  return {
    dryRun: values["dry-run"],
    maxRecords: values["dry-run"] ? 1 : Math.max(1, parseInt(values["max-records"], 10) || 250),
    outputDir: path.resolve(values["output-dir"]),
    headless: String(values.headless).toLowerCase() !== "false",
    delayMs: Math.max(0, parseInt(values["delay-ms"], 10) || 3000),
    resume: !values["no-resume"],
    enrich: !values["no-enrich"],
    spreadsheetOnly: values["spreadsheet-only"],
  };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the search URL for a given 1-based page number. PT paginates with a
 * `?page=N` query param (page 1 omits it). We drive pagination by incrementing
 * this param rather than scraping a DOM "next" link, because PT's pagination
 * markup changes often and silently breaks selector-based next-link detection.
 */
function searchUrlForPage(baseUrl, pageNum) {
  const u = new URL(baseUrl);
  if (pageNum <= 1) u.searchParams.delete("page");
  else u.searchParams.set("page", String(pageNum));
  return u.toString();
}

/** Jittered delay around `base` ms (±40%) to look less robotic. */
function politeDelay(base) {
  const jitter = base * 0.4;
  const ms = base - jitter + Math.random() * (2 * jitter);
  return sleep(Math.round(ms));
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/** Try each selector in order, return the first matching ElementHandle or null. */
async function firstMatch(scope, selectors) {
  for (const sel of selectors) {
    const el = await scope.$(sel);
    if (el) return el;
  }
  return null;
}

/** Try each selector in order, return trimmed text of first match or null. */
async function firstText(scope, selectors) {
  const el = await firstMatch(scope, selectors);
  if (!el) return null;
  const t = (await el.textContent())?.trim();
  return t || null;
}

/**
 * Run an async fn with exponential backoff. Used around navigation so a transient
 * network hiccup or soft block doesn't kill an otherwise-good run.
 */
async function withRetry(fn, { tries = 3, baseMs = 2000, label = "op" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      log(`  ! ${label} failed (attempt ${attempt}/${tries}): ${err.message}`);
      if (attempt < tries) await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Anti-bot detection
// ---------------------------------------------------------------------------

/** Heuristically detect a Cloudflare/CAPTCHA interstitial. */
async function detectBlock(page) {
  const title = (await page.title().catch(() => "")) || "";
  const body = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) || "";
  const hay = `${title}\n${body}`.toLowerCase();
  const signals = [
    "just a moment",
    "checking your browser",
    "verify you are human",
    "cf-challenge",
    "attention required",
    "access denied",
    "captcha",
  ];
  return signals.find((s) => hay.includes(s)) || null;
}

/**
 * If blocked: in headed mode, pause so a human can solve it; in headless mode,
 * throw so the caller can report the block clearly.
 */
async function handleBlockIfPresent(page, { headless }) {
  const signal = await detectBlock(page);
  if (!signal) return;
  log(`  !! Anti-bot interstitial detected ("${signal}").`);
  if (headless) {
    throw new Error(
      `Blocked by anti-bot ("${signal}"). Retry with --headless false to solve manually, ` +
        `or enable the stealth fallback (see README).`
    );
  }
  log("  >> Headed mode: solve the challenge in the browser window. Waiting up to 120s...");
  // Wait until the interstitial text disappears or timeout.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    if (!(await detectBlock(page))) {
      log("  >> Challenge cleared, continuing.");
      return;
    }
  }
  throw new Error(`Anti-bot challenge not cleared within timeout ("${signal}").`);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Resolve the best image URL from an <img> (handles lazy-loaded data-src). */
async function imgUrl(el) {
  if (!el) return null;
  return await el.evaluate(
    (n) => n.getAttribute("src") || n.getAttribute("data-src") || n.getAttribute("data-lazy") || null
  );
}

/** Extract card-level fields from one result card element. */
async function extractCard(card, page) {
  const raw_card_text = (await card.textContent())?.replace(/\s+/g, " ").trim() || null;

  const linkEl = await firstMatch(card, SELECTORS.profileLink);
  let profile_url = null;
  if (linkEl) {
    const href = await linkEl.getAttribute("href");
    if (href) profile_url = new URL(href, page.url()).toString();
  }

  const name = await firstText(card, SELECTORS.cardName);
  const credentials_or_title = await firstText(card, SELECTORS.cardCredentials);
  const location = await firstText(card, SELECTORS.cardLocation);
  const headshot_url = await imgUrl(await firstMatch(card, SELECTORS.cardPhoto));

  return { raw_card_text, profile_url, name, credentials_or_title, location, headshot_url };
}

/** Collect every result card on the current search page. */
async function extractAllCardsOnPage(page) {
  // Find which card selector actually matches on this page.
  let cards = [];
  for (const sel of SELECTORS.resultCard) {
    cards = await page.$$(sel);
    if (cards.length) break;
  }
  const out = [];
  for (const card of cards) {
    try {
      out.push(await extractCard(card, page));
    } catch (err) {
      log(`  ! card extraction error: ${err.message}`);
    }
  }
  return out;
}

/**
 * Parse PT's attribute groups + insurance + availability in one DOM pass.
 * Groups are matched by their visible heading text (e.g. "Top Specialties") so
 * this survives PT's frequent CSS class renames. Returns lists of chip strings.
 */
async function extractAttributes(page, groupMap) {
  return await page.evaluate((map) => {
    const itemsForGroupTitle = (title) => {
      const groups = [...document.querySelectorAll("div.attributes-group")];
      const g = groups.find((el) => {
        const h = el.querySelector("h3.attributes-group-title, .attributes-group-title");
        return h && h.textContent.trim().toLowerCase() === title.toLowerCase();
      });
      if (!g) return [];
      const items = [...g.querySelectorAll("li")]
        .map((li) => li.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return [...new Set(items)];
    };

    const out = {};
    for (const [field, title] of Object.entries(map)) {
      out[field] = itemsForGroupTitle(title);
    }

    // Insurance: list of accepted plans under div.insurance.
    out.insurance = [
      ...new Set(
        [...document.querySelectorAll("div.insurance ul.section-list li, div.insurance li")]
          .map((li) => li.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      ),
    ];

    // Availability: the "Practice at a Glance" block (in-person/online, address).
    const glance =
      document.querySelector("[class*='at-a-glance']") ||
      document.querySelector(".practice-at-a-glance");
    out.availability = glance ? glance.innerText.replace(/\s+/g, " ").trim() : null;

    return out;
  }, groupMap);
}

/** Visit a profile URL and extract the deeper fields. */
async function extractProfile(context, url, opts) {
  const page = await context.newPage();
  try {
    await withRetry(
      () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }),
      { label: `goto profile` }
    );
    await handleBlockIfPresent(page, opts);
    // Give client-rendered sections a moment.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const raw_profile_text =
      (await page.evaluate(() => document.body?.innerText || ""))?.replace(/\s+/g, " ").trim() ||
      null;

    const name = await firstText(page, SELECTORS.profileName);
    const credentials_or_title = await firstText(page, SELECTORS.profileCredentials);
    const headshot_url = await imgUrl(await firstMatch(page, SELECTORS.profilePhoto));
    const location = await firstText(page, SELECTORS.profileLocation);

    const phoneEl = await firstMatch(page, SELECTORS.profilePhone);
    let phone_or_contact_text = null;
    if (phoneEl) {
      const href = await phoneEl.getAttribute("href");
      phone_or_contact_text = (href?.replace(/^tel:/, "") || (await phoneEl.textContent())?.trim()) || null;
    }

    const attrs = await extractAttributes(page, ATTRIBUTE_GROUP_MAP);
    const specialties = attrs.specialties;
    const issues = attrs.issues;
    const treatment_approaches = attrs.treatment_approaches;
    const insurance_text = attrs.insurance.length ? attrs.insurance.join(", ") : null;
    const availability_text = attrs.availability;

    return {
      name,
      credentials_or_title,
      headshot_url,
      location,
      phone_or_contact_text,
      specialties,
      issues,
      treatment_approaches,
      insurance_text,
      availability_text,
      raw_profile_text,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Merge card + profile data into a complete record and infer booleans. */
function buildRecord(card, profile, runMeta) {
  const merged = makeRecord({
    ...card,
    // profile fields override card fields when present
    ...Object.fromEntries(Object.entries(profile || {}).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))),
    profile_url: card.profile_url, // never let profile override the canonical key
    source_search_url: SOURCE_SEARCH_URL,
    extracted_at: new Date().toISOString(),
  });

  const haystack = `${merged.raw_card_text || ""} ${merged.raw_profile_text || ""} ${merged.insurance_text || ""}`;

  // The source URL is pre-filtered for Medicaid + Teens, so default true, but
  // record whether the text independently confirms it.
  merged.accepts_medicaid = true;
  if (!MEDICAID_RE.test(haystack)) {
    merged.data_quality_notes.push("accepts_medicaid assumed from search filter, not confirmed in text");
  }
  merged.works_with_teens = true;
  if (!TEENS_RE.test(haystack)) {
    merged.data_quality_notes.push("works_with_teens assumed from search filter, not confirmed in text");
  }

  if (!profile) {
    merged.data_quality_notes.push("profile fetch failed or skipped; card-level data only");
  }

  return addQualityNotes(merged);
}

// ---------------------------------------------------------------------------
// Output / resume state
// ---------------------------------------------------------------------------

// Output filenames (centralized so README + code agree).
const FILES = {
  raw: "therapists_raw.json",
  enriched: "therapists_enriched.json",
  enrichedCsv: "therapists_enriched.csv",
  // Two spreadsheet artifacts: a full internal QA sheet and a simplified,
  // parent-shareable sheet for NYC community feedback.
  internalTsv: "therapists_internal.tsv",
  parentShareableTsv: "therapists_parent_shareable.tsv",
  // Backward-compat alias for the old single parent file (same content as internal).
  parentTsvAlias: "therapists_parent_spreadsheet.tsv",
  cardPreview: "therapists_card_preview.json",
  dryRun: "dry_run_enriched.json",
  seen: "seen_urls.json",
};

// Compact, mobile-facing subset the First Session app renders on a therapist card.
const CARD_PREVIEW_FIELDS = [
  "name",
  "credentials_or_title",
  "headshot_url",
  "location",
  "child_fit_signals",
  "parent_concern_signals",
  "communication_style_signals",
  "emotional_tone_summary",
  "parent_friendly_summary",
  "possible_less_ideal_if",
  "parent_question_suggestions",
];

/** Project enriched records down to the parent-readable card-preview shape. */
function buildCardPreviews(enrichedRecords) {
  return enrichedRecords.map((rec) =>
    Object.fromEntries(CARD_PREVIEW_FIELDS.map((f) => [f, rec[f]]))
  );
}

async function readJsonArray(file) {
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Reload prior progress so a resumed run ACCUMULATES rather than overwrites.
 * Loads both the raw and enriched record files (each round-trips itself, and
 * they stay in sync because we flush them together). The seen-set is the union
 * of every profile_url across both files plus seen_urls.json.
 */
async function loadState(outputDir, resume) {
  const rawRecords = [];
  const enrichedRecords = [];
  const seen = new Set();
  if (!resume) return { rawRecords, enrichedRecords, seen };

  const priorEnriched = await readJsonArray(path.join(outputDir, FILES.enriched));
  if (priorEnriched) {
    for (const rec of priorEnriched) {
      if (rec?.profile_url && !seen.has(rec.profile_url)) {
        enrichedRecords.push(rec);
        seen.add(rec.profile_url);
      }
    }
    log(`Resume: reloaded ${enrichedRecords.length} previously-enriched records.`);
  }

  const priorRaw = await readJsonArray(path.join(outputDir, FILES.raw));
  if (priorRaw) {
    const rawByUrl = new Map(priorRaw.filter((r) => r?.profile_url).map((r) => [r.profile_url, r]));
    // Keep rawRecords aligned to the enriched ordering/membership.
    for (const er of enrichedRecords) rawRecords.push(rawByUrl.get(er.profile_url) || er);
    for (const url of rawByUrl.keys()) seen.add(url);
  } else {
    // No raw file: reconstruct raw from enriched (enrichment fields will simply
    // be whatever was stored — acceptable; raw file is regenerated on next flush).
    for (const er of enrichedRecords) rawRecords.push(er);
  }

  const priorSeen = await readJsonArray(path.join(outputDir, FILES.seen));
  if (priorSeen) for (const url of priorSeen) seen.add(url);

  log(`Resume: ${seen.size} profile URL(s) will be skipped.`);
  return { rawRecords, enrichedRecords, seen };
}

/** Write both spreadsheet TSVs (internal + parent-shareable) plus the alias. */
async function writeSpreadsheets(outputDir, enrichedRecords) {
  const internal = recordsToInternalTsv(enrichedRecords);
  const parent = recordsToParentTsv(enrichedRecords);
  await writeFile(path.join(outputDir, FILES.internalTsv), internal);
  await writeFile(path.join(outputDir, FILES.parentShareableTsv), parent);
  // Backward-compat: the old file name keeps the full (internal) column set.
  await writeFile(path.join(outputDir, FILES.parentTsvAlias), internal);
}

/**
 * Write raw + enriched JSON, enriched CSV, both spreadsheet TSVs, the card preview,
 * and the seen-set. The TSVs are the community-feedback artifacts; the JSON files
 * remain the internal source of truth.
 */
async function flush(outputDir, rawRecords, enrichedRecords, seen) {
  await writeFile(path.join(outputDir, FILES.raw), JSON.stringify(rawRecords, null, 2));
  await writeFile(path.join(outputDir, FILES.enriched), JSON.stringify(enrichedRecords, null, 2));
  await writeFile(path.join(outputDir, FILES.enrichedCsv), recordsToCsv(enrichedRecords));
  await writeSpreadsheets(outputDir, enrichedRecords);
  await writeFile(
    path.join(outputDir, FILES.cardPreview),
    JSON.stringify(buildCardPreviews(enrichedRecords), null, 2)
  );
  await writeFile(path.join(outputDir, FILES.seen), JSON.stringify([...seen], null, 2));
}

/**
 * --spreadsheet-only: regenerate both spreadsheet TSVs from an existing
 * therapists_enriched.json without scraping again. Errors clearly if enrichment
 * hasn't been run yet.
 */
async function runSpreadsheetOnly(opts) {
  const enrichedPath = path.join(opts.outputDir, FILES.enriched);
  const records = await readJsonArray(enrichedPath);
  if (!records) {
    log(`ERROR: no enriched data found at ${enrichedPath}.`);
    log("Run extraction + enrichment first, then re-run --spreadsheet-only. For a small test:");
    log("  node pipeline/extract.js --max-records 20 --headless false");
    log("  node pipeline/extract.js --spreadsheet-only");
    process.exitCode = 1;
    return;
  }
  await mkdir(opts.outputDir, { recursive: true });
  await writeSpreadsheets(opts.outputDir, records);
  if (records.length === 0) {
    log(`WARNING: ${enrichedPath} contained 0 records — wrote header-only TSVs.`);
  }
  log(`Wrote spreadsheets (${records.length} record(s)):`);
  log(`  ${path.join(opts.outputDir, FILES.internalTsv)}  <- internal QA (full columns)`);
  log(`  ${path.join(opts.outputDir, FILES.parentShareableTsv)}  <- share with parents (import this)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseCli();

  // Spreadsheet-only mode: no scraping — just rebuild the TSV from enriched JSON.
  if (opts.spreadsheetOnly) {
    log("Spreadsheet-only mode: regenerating parent TSV from existing enriched JSON.");
    await runSpreadsheetOnly(opts);
    return;
  }

  log("First Session extractor starting with options:", opts);
  await mkdir(opts.outputDir, { recursive: true });

  const { rawRecords, enrichedRecords, seen } = await loadState(opts.outputDir, opts.resume);
  const startCount = enrichedRecords.length;

  // Set up Gemini enrichment (unless disabled or no key present).
  let enricher = null;
  if (opts.enrich) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      log("WARNING: GEMINI_API_KEY not found in environment/.env — running extraction WITHOUT enrichment.");
    } else {
      const envModel = process.env.GEMINI_MODEL?.trim();
      const models = envModel ? [envModel, ...DEFAULT_MODELS.filter((m) => m !== envModel)] : DEFAULT_MODELS;
      log(`Enrichment enabled. Model preference: ${models.join(" -> ")}`);
      enricher = createEnricher({ apiKey, models, log });
    }
  } else {
    log("Enrichment disabled via --no-enrich.");
  }

  const browser = await chromium.launch({ headless: opts.headless });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });

  const page = await context.newPage();
  let pageNum = 1;

  try {
    while (enrichedRecords.length < opts.maxRecords) {
      const searchUrl = searchUrlForPage(SOURCE_SEARCH_URL, pageNum);
      log(`Loading search results page ${pageNum}: ${searchUrl}`);
      await withRetry(() => page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }), {
        label: "goto search",
      });
      await handleBlockIfPresent(page, opts);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      const cards = await extractAllCardsOnPage(page);
      log(`  Found ${cards.length} cards on page ${pageNum}.`);
      if (cards.length === 0) {
        log("  No cards found — reached the last page (or selector drift; see README).");
        break;
      }

      // Track new records added from this page. PT serves the last page again
      // (or an empty page) when you request beyond the end, so if a full page
      // contributes zero new therapists we've run out of results.
      let newThisPage = 0;

      for (const card of cards) {
        if (enrichedRecords.length >= opts.maxRecords) break;

        if (!card.profile_url) {
          log("  - skipping card with no resolvable profile_url");
          continue;
        }
        if (seen.has(card.profile_url)) {
          log(`  - skip (already seen): ${card.profile_url}`);
          continue;
        }

        const idx = enrichedRecords.length + 1;
        log(`  + [${idx}/${opts.maxRecords}] ${card.name || "(unknown)"} — fetching profile`);
        let profile = null;
        try {
          profile = await extractProfile(context, card.profile_url, opts);
        } catch (err) {
          log(`  ! profile fetch failed (${card.profile_url}): ${err.message}`);
        }

        // Raw record: extraction only. Preserved exactly, never mutated by Gemini.
        const rawRecord = buildRecord(card, profile, opts);

        // Enriched record: a deep copy with Gemini UX fields overlaid.
        const enrichedRecord = structuredClone(rawRecord);
        if (enricher) {
          log(`    ~ enriching "${card.name || "(unknown)"}" with Gemini...`);
          const { values, model, qualityNotes } = await enricher.enrich(rawRecord);
          Object.assign(enrichedRecord, values); // overlay UX fields only
          if (qualityNotes.length) {
            enrichedRecord.data_quality_notes = [...enrichedRecord.data_quality_notes, ...qualityNotes];
          }
          log(`    ~ enrichment complete for "${card.name || "(unknown)"}" (model: ${model || "n/a"}).`);
        }

        rawRecords.push(rawRecord);
        enrichedRecords.push(enrichedRecord);
        seen.add(card.profile_url);
        newThisPage += 1;

        // Crash-safe: flush every record so a mid-run failure loses nothing.
        await flush(opts.outputDir, rawRecords, enrichedRecords, seen);

        await politeDelay(opts.delayMs); // polite gap between profile fetches
      }

      if (opts.dryRun) {
        log("Dry-run: stopping after first record.");
        break;
      }
      if (enrichedRecords.length >= opts.maxRecords) break;

      // A full page that added no new therapists means we've paged past the end
      // (PT re-serves the last page beyond the final one). Stop to avoid looping.
      if (newThisPage === 0) {
        log("No new therapists on this page — reached the last page.");
        break;
      }

      // Pagination: advance to the next page by incrementing the `page` param.
      pageNum += 1;
      await politeDelay(opts.delayMs); // polite gap between result pages
    }
  } finally {
    await flush(opts.outputDir, rawRecords, enrichedRecords, seen);
    // In dry-run, also write the dedicated dry-run output file.
    if (opts.dryRun) {
      await writeFile(
        path.join(opts.outputDir, FILES.dryRun),
        JSON.stringify(enrichedRecords, null, 2)
      );
    }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const added = enrichedRecords.length - startCount;
  log(`Done. ${enrichedRecords.length} record(s) total (${added} new this run). Wrote:`);
  log(`  ${path.join(opts.outputDir, FILES.raw)}`);
  log(`  ${path.join(opts.outputDir, FILES.enriched)}`);
  log(`  ${path.join(opts.outputDir, FILES.enrichedCsv)}`);
  log(`  ${path.join(opts.outputDir, FILES.internalTsv)}  <- internal QA spreadsheet (full columns)`);
  log(`  ${path.join(opts.outputDir, FILES.parentShareableTsv)}  <- parent-shareable (import into Google Sheets)`);
  log(`  ${path.join(opts.outputDir, FILES.cardPreview)}`);
  if (opts.dryRun) log(`  ${path.join(opts.outputDir, FILES.dryRun)}`);
}

main().catch((err) => {
  log("FATAL:", err.stack || err.message);
  process.exitCode = 1;
});
