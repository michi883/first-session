#!/usr/bin/env node
/**
 * First Session — provider contact-channel discovery.
 *
 * Reads the first N therapists from data/therapists_internal.tsv, visits each
 * Psychology Today profile, follows the practice-website link if present, and
 * looks for a PROVIDER-APPROVED way to make contact: a public email, a contact /
 * intake / appointment page, or a phone number. It writes one row per therapist to
 * a contact-channels TSV.
 *
 * READ-ONLY / POLITE BY DESIGN. This script discovers channels; it never reaches
 * out. Specifically it:
 *   - never submits any form (it only detects that a <form> exists),
 *   - never automates Psychology Today's "Email Me" form,
 *   - never attempts to solve or bypass a CAPTCHA / anti-bot interstitial,
 *   - browses sequentially with jittered delays, one therapist at a time.
 *
 * Usage:
 *   node pipeline/discover-contacts.js [--max-records 25] [--dry-run]
 *                                     [--headless true|false] [--output PATH]
 *                                     [--input PATH] [--delay-ms N] [--email-only]
 *
 *   --dry-run     process ONLY the first therapist and print the row that WOULD be
 *                 written (writes nothing to disk).
 *
 *   --email-only  FAST mode. Only keep a public email visible on the practice
 *                 homepage: caps the website-redirect wait at 8s and SKIPS the
 *                 contact-page hop. Therapists without an easy homepage email are
 *                 flagged "no easy email — manual follow-up" instead of being
 *                 crawled deeper. ~2-3x faster; trades away contact-form discovery.
 *
 * Mirrors the polite-browsing + anti-bot conventions of pipeline/extract.js
 * (realistic UA, jittered delays, retry/backoff, headed-mode manual-solve pause).
 * extract.js is intentionally left unchanged; the small overlap (UA string, delay
 * helpers, block detection) is duplicated here to keep this script self-contained.
 */

import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Output columns, in order. These are the deliverable's required columns.
const COLUMNS = [
  "Name",
  "Psychology Today Profile",
  "Practice Website",
  "Contact Email",
  "Contact Form URL",
  "Phone",
  "Preferred Contact Method",
  "Contact Source URL",
  "Confidence",
  "Notes",
];

// Hosts that are never a therapist's own practice website (PT itself, social,
// CDNs, map/booking widgets that aren't a practice homepage). Used to decide
// which outbound link on a PT profile is the real practice site.
// Hosts that are never a therapist's own practice site: PT itself, social, CDNs,
// AND third-party infrastructure that shows up as outbound links (cookie-consent
// banners, "powered by" website-builder badges, analytics). Without this, a
// CookieYes / OneTrust / Wix footer link gets mistaken for the practice site.
const NON_PRACTICE_HOST_RE =
  /(^|\.)(psychologytoday\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|google\.com|goo\.gl|maps\.app\.goo\.gl|yelp\.com|apple\.com|pinterest\.com|cookieyes\.com|onetrust\.com|cookiebot\.com|termly\.io|iubenda\.com|wix\.com|wixsite\.com|squarespace\.com|godaddy\.com|wordpress\.com|weebly\.com|wpengine\.com|cloudflare\.com|gstatic\.com|googletagmanager\.com|doubleclick\.net|headway\.co|zencare\.co|helloalma\.com|sondermind\.com|growtherapy\.com|betterhelp\.com|talkspace\.com|therapyden\.com|goodtherapy\.org|latinxtherapy\.com|zocdoc\.com|healthgrades\.com|wellness\.com|theravive\.com|openpathcollective\.org)$/i;

// Email addresses that are infrastructure noise, not a real contact address.
const JUNK_EMAIL_RE =
  /(sentry|wixpress|example\.com|\.png$|\.jpe?g$|\.gif$|\.svg$|godaddy|squarespace\.com$|cloudflare|domain\.com$|cookieyes|onetrust|cookiebot|@sentry|noreply@|no-reply@|partnerships?@|@headway\.co|@zencare|@helloalma|@sondermind|@growtherapy)/i;

// Anchor text / href fragments that signal a contact / intake / booking page.
const CONTACT_LINK_RE =
  /\b(contact|intake|appointment|request|book|schedule|get[\s-]?started|new[\s-]?client|consult|reach[\s-]?out|connect|inquir)/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli() {
  const { values } = parseArgs({
    options: {
      "max-records": { type: "string", default: "25" },
      "dry-run": { type: "boolean", default: false },
      headless: { type: "string", default: "true" },
      output: { type: "string" }, // default chosen below (depends on --email-only)
      input: { type: "string", default: "./data/therapists_internal.tsv" },
      "delay-ms": { type: "string" }, // default chosen below (faster in email-only)
      "email-only": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const dryRun = values["dry-run"];
  const emailOnly = values["email-only"];
  // In email-only mode the polite delay is the dominant cost, so default it lower
  // (still sequential, one tab — not aggressive crawling).
  const delayMs = values["delay-ms"] != null
    ? Math.max(0, parseInt(values["delay-ms"], 10) || 0)
    : emailOnly ? 2000 : 3500;
  const defaultOutput = emailOnly
    ? "./data/therapist_contact_emails.tsv"
    : "./data/therapist_contact_channels_25.tsv";

  return {
    dryRun,
    emailOnly,
    // Dry-run forces exactly one therapist regardless of --max-records.
    maxRecords: dryRun ? 1 : Math.max(1, parseInt(values["max-records"], 10) || 25),
    headless: String(values.headless).toLowerCase() !== "false",
    output: path.resolve(values.output || defaultOutput),
    input: path.resolve(values.input),
    delayMs,
  };
}

// ---------------------------------------------------------------------------
// Small utilities (mirrors extract.js conventions)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Jittered delay around `base` ms (±40%) to look less robotic. */
function politeDelay(base) {
  const jitter = base * 0.4;
  const ms = base - jitter + Math.random() * (2 * jitter);
  return sleep(Math.round(ms));
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/** Run an async fn with exponential backoff. */
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

/** Flatten a value to a single safe TSV cell. */
function tsvCell(value) {
  if (value == null) return "";
  const s = Array.isArray(value) ? value.filter((v) => v != null && v !== "").join("; ") : String(value);
  return s.replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function rowToTsv(row) {
  return COLUMNS.map((c) => tsvCell(row[c])).join("\t");
}

// ---------------------------------------------------------------------------
// Anti-bot detection (read-only: we never solve/bypass)
// ---------------------------------------------------------------------------

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
 * If blocked: headed mode pauses so a human can solve it manually; headless mode
 * throws so the caller records the block in Notes. We NEVER attempt to bypass it.
 */
async function handleBlockIfPresent(page, { headless }) {
  const signal = await detectBlock(page);
  if (!signal) return;
  log(`  !! Anti-bot interstitial detected ("${signal}").`);
  if (headless) {
    throw new Error(`anti-bot interstitial ("${signal}") — not bypassed; rerun with --headless false to solve manually`);
  }
  log("  >> Headed mode: solve the challenge in the browser window. Waiting up to 120s...");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    if (!(await detectBlock(page))) {
      log("  >> Challenge cleared, continuing.");
      return;
    }
  }
  throw new Error(`anti-bot challenge not cleared within timeout ("${signal}")`);
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/** Minimal TSV reader → array of row objects keyed by header. */
async function readTsv(file) {
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Normalize a phone string to digits-with-plus for comparison/output. */
function cleanPhone(raw) {
  if (!raw) return "";
  const m = String(raw).replace(/[^\d+]/g, "");
  return m.length >= 10 ? m : "";
}

/**
 * On a Psychology Today profile page, find the therapist's own practice-website
 * URL (if listed) and any tel: phone. PT renders a "Visit Website" outbound link;
 * we pick the first outbound anchor whose host is not PT/social/CDN.
 */
async function scrapePtProfile(page) {
  return await page.evaluate(
    ({ nonPracticeSrc }) => {
      const nonPractice = new RegExp(nonPracticeSrc, "i");
      const anchors = [...document.querySelectorAll("a[href]")];

      // Practice website: ONLY trust an anchor PT explicitly labels as the
      // therapist's website (text like "My website" / "Visit Website" / "Website",
      // or a website-flagged data-event attr / href). We do NOT fall back to "first
      // outbound link" — that grabs cookie-banner / "powered by" footer links.
      //
      // PT usually hides the real practice URL behind a redirect endpoint
      // (e.g. /us/profile/<id>/website). We return that link (resolved to absolute)
      // and let the caller navigate it to discover the real destination host.
      let websiteLink = "";
      const isWebsiteLabel = (a) => {
        const txt = `${a.textContent || ""} ${a.getAttribute("aria-label") || ""} ${a.getAttribute("title") || ""}`
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const href = (a.getAttribute("href") || "").toLowerCase();
        const ev = `${a.getAttribute("data-event-label") || ""} ${a.getAttribute("data-event-action") || ""}`.toLowerCase();
        return /\bwebsite\b/.test(txt) || /\/website\b/.test(href) || /website/.test(ev);
      };
      for (const a of anchors) {
        if (!isWebsiteLabel(a)) continue;
        const href = a.getAttribute("href") || "";
        if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
        try {
          const abs = new URL(href, document.baseURI).toString();
          // If it's already an absolute external (non-PT/non-social) URL, prefer
          // it directly; otherwise keep the PT redirect link to follow later.
          const host = new URL(abs).hostname;
          if (!nonPractice.test(host)) {
            websiteLink = abs; // real external URL, no redirect needed
            break;
          }
          if (/psychologytoday\.com$/i.test(host) && /\/website\b/i.test(abs)) {
            websiteLink = abs; // PT redirect endpoint — resolve by navigating
            break;
          }
        } catch {
          continue;
        }
      }

      // Phone: first tel: link.
      let phone = "";
      const tel = anchors.find((a) => /^tel:/i.test(a.getAttribute("href") || ""));
      if (tel) phone = tel.getAttribute("href").replace(/^tel:/i, "");

      // Does PT expose its own "Email Me" contact path? (We record it, never use it.)
      const hasPtEmail = anchors.some((a) => /email/i.test((a.textContent || "").trim())) ||
        !!document.querySelector("[data-event-action*='email'], [href*='/email/']");

      return { websiteLink, phone, hasPtEmail };
    },
    { nonPracticeSrc: NON_PRACTICE_HOST_RE.source }
  );
}

/**
 * On a practice website page, collect mailto emails, tel phones, candidate
 * contact/intake/booking links, and whether a <form> is present. Best-effort and
 * read-only — no form interaction.
 */
async function scrapePracticeSite(page) {
  const data = await page.evaluate(
    ({ contactSrc, emailSrc }) => {
      const contactRe = new RegExp(contactSrc, "i");
      const emailRe = new RegExp(emailSrc, "gi");
      const anchors = [...document.querySelectorAll("a[href]")];

      const mailtos = anchors
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => /^mailto:/i.test(h))
        .map((h) => h.replace(/^mailto:/i, "").split("?")[0].trim())
        .filter(Boolean);

      const tels = anchors
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => /^tel:/i.test(h))
        .map((h) => h.replace(/^tel:/i, "").trim())
        .filter(Boolean);

      // Candidate contact/intake/booking pages (resolve to absolute URLs).
      const contactLinks = [];
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const text = (a.textContent || "").trim();
        if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
        if (contactRe.test(text) || contactRe.test(href)) {
          try {
            contactLinks.push(new URL(href, document.baseURI).toString());
          } catch {
            /* skip unparseable */
          }
        }
      }

      // Plain-text emails as a fallback (e.g. "intake@practice.com" in body text).
      const bodyText = document.body?.innerText || "";
      const textEmails = bodyText.match(emailRe) || [];

      const hasForm = !!document.querySelector("form");

      return {
        mailtos: [...new Set(mailtos)],
        tels: [...new Set(tels)],
        contactLinks: [...new Set(contactLinks)],
        textEmails: [...new Set(textEmails)],
        hasForm,
      };
    },
    { contactSrc: CONTACT_LINK_RE.source, emailSrc: EMAIL_RE.source }
  );
  return data;
}

/** Decode %xx, strip surrounding junk/whitespace, lowercase. */
function normalizeEmail(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* leave as-is if it isn't valid percent-encoding */
  }
  // Strip leading/trailing punctuation, brackets, and stray whitespace.
  s = s.replace(/^[\s<"'(]+/, "").replace(/[\s>"'),.;:]+$/, "").trim();
  return s.toLowerCase();
}

const EMAIL_SHAPE_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

function pickEmail(candidates) {
  for (const e of candidates) {
    const norm = normalizeEmail(e);
    if (norm && EMAIL_SHAPE_RE.test(norm) && !JUNK_EMAIL_RE.test(norm)) return norm;
  }
  return "";
}

/**
 * Process a single therapist: PT profile → practice site → contact channels.
 * Returns a row object keyed by COLUMNS plus an internal `_notes` array.
 */
async function discoverForTherapist(context, t, opts) {
  const name = t["Name"] || "(unknown)";
  const ptUrl = t["Psychology Today Profile"] || "";
  const notes = [];

  const row = {
    Name: name,
    "Psychology Today Profile": ptUrl,
    "Practice Website": "",
    "Contact Email": "",
    "Contact Form URL": "",
    Phone: cleanPhone(t["Contact"]),
    "Preferred Contact Method": "",
    "Contact Source URL": "",
    Confidence: "Low",
    Notes: "",
  };

  if (!ptUrl) {
    notes.push("no Psychology Today profile URL in input row");
    row.Notes = notes.join("; ");
    return row;
  }

  // --- Psychology Today profile ---
  const ptPage = await context.newPage();
  let pt = { websiteLink: "", phone: "", hasPtEmail: false };
  let practiceWebsite = "";
  try {
    await withRetry(() => ptPage.goto(ptUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }), {
      label: "goto PT profile",
    });
    await handleBlockIfPresent(ptPage, opts);
    await ptPage.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    pt = await scrapePtProfile(ptPage);

    // Resolve PT's website redirect (/us/profile/<id>/website) to the real host by
    // navigating it on the SAME page and reading where it lands. This is a normal
    // outbound click PT serves to the public — not a form submission or bypass.
    if (pt.websiteLink && /psychologytoday\.com/i.test(pt.websiteLink)) {
      try {
        await withRetry(() => ptPage.goto(pt.websiteLink, { waitUntil: "domcontentloaded", timeout: 45_000 }), {
          label: "resolve website redirect",
        });
        // PT serves a JS interstitial ("You're off to <name>'s website!") that
        // window.location-redirects after a few seconds. Wait for the main frame
        // to leave the PT domain rather than reading the URL immediately. In
        // email-only (fast) mode we cap this lower — the interstitial usually
        // fires in 5-9s, and 8s keeps the per-therapist cost down.
        const redirectTimeout = opts.emailOnly ? 8_000 : 15_000;
        await ptPage
          .waitForURL((u) => !/psychologytoday\.com$/i.test(u.hostname), { timeout: redirectTimeout })
          .catch(() => {});
        const landed = ptPage.url();
        const landedHost = new URL(landed).hostname;
        if (/psychologytoday\.com$/i.test(landedHost)) {
          notes.push(`PT 'website' link did not redirect off Psychology Today within ${redirectTimeout / 1000}s`);
        } else if (NON_PRACTICE_HOST_RE.test(landedHost)) {
          // Lands on a directory/platform (Headway, Zencare, Latinx Therapy, etc.),
          // not the therapist's own site. Treat as no independent practice website.
          notes.push(`PT 'website' link points to a directory/platform (${landedHost}), not an independent practice site`);
        } else {
          practiceWebsite = landed;
        }
      } catch (err) {
        notes.push(`website redirect resolve issue: ${err.message}`);
      }
    } else if (pt.websiteLink) {
      practiceWebsite = pt.websiteLink; // already an absolute external URL
    }
  } catch (err) {
    notes.push(`PT profile fetch issue: ${err.message}`);
  } finally {
    await ptPage.close().catch(() => {});
  }

  if (pt.phone && !row.Phone) row.Phone = cleanPhone(pt.phone);
  row["Practice Website"] = practiceWebsite || "";

  // --- Practice website (one homepage + at most one contact page) ---
  let email = "";
  let contactFormUrl = "";
  let formConfirmed = false;
  let contactSourceUrl = "";

  if (practiceWebsite) {
    const sitePage = await context.newPage();
    try {
      await withRetry(() => sitePage.goto(practiceWebsite, { waitUntil: "domcontentloaded", timeout: 45_000 }), {
        label: "goto practice site",
      });
      await handleBlockIfPresent(sitePage, opts);
      await sitePage.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});

      const home = await scrapePracticeSite(sitePage);
      email = pickEmail([...home.mailtos, ...home.textEmails]);
      if (email) contactSourceUrl = sitePage.url();
      if (!row.Phone && home.tels.length) row.Phone = cleanPhone(home.tels[0]);

      // Pick a contact/intake page candidate.
      const contactCandidate = home.contactLinks[0];
      if (home.hasForm) {
        contactFormUrl = sitePage.url();
        formConfirmed = true;
      }

      // Email-only (fast) mode: take the homepage email if present and stop.
      // We do NOT hop to a contact page — that's the expensive step we're cutting.
      if (opts.emailOnly) {
        if (!email) notes.push("no public email on practice homepage (email-only mode: contact-page hop skipped)");
      } else if ((!email || !formConfirmed) && contactCandidate) {
        // Thorough mode: if no email yet, or no confirmed form, visit one contact page.
        await politeDelay(opts.delayMs);
        const cPage = await context.newPage();
        try {
          await withRetry(() => cPage.goto(contactCandidate, { waitUntil: "domcontentloaded", timeout: 45_000 }), {
            label: "goto contact page",
          });
          await handleBlockIfPresent(cPage, opts);
          await cPage.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
          const contact = await scrapePracticeSite(cPage);

          if (!email) {
            email = pickEmail([...contact.mailtos, ...contact.textEmails]);
            if (email) contactSourceUrl = cPage.url();
          }
          if (!row.Phone && contact.tels.length) row.Phone = cleanPhone(contact.tels[0]);
          if (contact.hasForm) {
            contactFormUrl = cPage.url();
            formConfirmed = true;
          } else if (!contactFormUrl) {
            // No form detected, but it's still the practice's contact page.
            contactFormUrl = cPage.url();
            notes.push("contact page found but no <form> element detected (may use email/embed)");
          }
        } catch (err) {
          notes.push(`contact page fetch issue: ${err.message}`);
        } finally {
          await cPage.close().catch(() => {});
        }
      } else if (!contactCandidate && !formConfirmed) {
        notes.push("no contact/intake link found on practice homepage");
      }
    } catch (err) {
      notes.push(`practice site fetch issue: ${err.message}`);
    } finally {
      await sitePage.close().catch(() => {});
    }
  } else {
    notes.push("no practice website linked on PT profile");
  }

  row["Contact Email"] = email;
  row["Contact Form URL"] = contactFormUrl;

  // --- Confidence + preferred method + source ---
  // High:   direct email OR a confirmed <form> on the provider/practice site.
  // Medium: only a PT contact path, or a general intake/contact page w/o form.
  // Low:    nothing useful / ambiguous.
  if (email) {
    row.Confidence = "High";
    row["Preferred Contact Method"] = "Email";
    row["Contact Source URL"] = contactSourceUrl || practiceWebsite;
    notes.push("public email found on practice site");
  } else if (opts.emailOnly) {
    // Fast mode: anything without an easy homepage email is left for a human to
    // chase. We still surface what little we know (phone / PT path) in Notes.
    row.Confidence = "Low";
    row["Preferred Contact Method"] = "No easy email — manual follow-up";
    row["Contact Source URL"] = practiceWebsite || ptUrl;
    if (pt.hasPtEmail) notes.push("Psychology Today 'Email Me' path available (not automated)");
    if (row.Phone) notes.push("phone available as fallback channel");
  } else if (formConfirmed) {
    row.Confidence = "High";
    row["Preferred Contact Method"] = "Contact Form";
    row["Contact Source URL"] = contactFormUrl;
    notes.push("contact form (<form>) found on practice site");
  } else if (contactFormUrl) {
    row.Confidence = "Medium";
    row["Preferred Contact Method"] = "Contact Form";
    row["Contact Source URL"] = contactFormUrl;
    notes.push("practice contact/intake page found (form not confirmed)");
  } else if (pt.hasPtEmail) {
    row.Confidence = "Medium";
    row["Preferred Contact Method"] = "Psychology Today contact (Email Me) — not automated";
    row["Contact Source URL"] = ptUrl;
    notes.push("only Psychology Today contact path available; PT 'Email Me' form NOT submitted");
  } else if (row.Phone) {
    row.Confidence = "Medium";
    row["Preferred Contact Method"] = "Phone";
    row["Contact Source URL"] = practiceWebsite || ptUrl;
    notes.push("no email/form found; phone is best available channel");
  } else {
    row.Confidence = "Low";
    row["Preferred Contact Method"] = "Unknown";
    row["Contact Source URL"] = practiceWebsite || ptUrl;
    notes.push("no clear contact channel discovered");
  }

  // If we have a strong email/form but also a phone, still record phone; preferred
  // already reflects the best channel.
  row.Notes = notes.join("; ");
  return row;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseCli();
  log("Contact-discovery starting with options:", opts);

  if (!existsSync(opts.input)) {
    log(`FATAL: input not found: ${opts.input}`);
    process.exitCode = 1;
    return;
  }

  const allRows = await readTsv(opts.input);
  const therapists = allRows.slice(0, opts.maxRecords);
  log(`Read ${allRows.length} therapist row(s); processing first ${therapists.length}.`);

  const browser = await chromium.launch({ headless: opts.headless });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });

  const results = [];
  try {
    for (let i = 0; i < therapists.length; i++) {
      const t = therapists[i];
      log(`+ [${i + 1}/${therapists.length}] ${t["Name"] || "(unknown)"}`);
      const row = await discoverForTherapist(context, t, opts);
      results.push(row);
      log(`    => ${row.Confidence} | ${row["Preferred Contact Method"]} | email=${row["Contact Email"] || "-"} | form=${row["Contact Form URL"] ? "yes" : "-"} | phone=${row.Phone || "-"}`);

      // Polite gap between therapists (skip after the last one).
      if (i < therapists.length - 1) await politeDelay(opts.delayMs);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const tsv = [COLUMNS.join("\t"), ...results.map(rowToTsv)].join("\n") + "\n";

  if (opts.dryRun) {
    log("DRY-RUN: nothing written to disk. The row that WOULD be written:");
    console.log("\n" + COLUMNS.join("\t"));
    console.log(results.map(rowToTsv).join("\n") + "\n");
    log("DRY-RUN: as key/value for readability:");
    for (const row of results) {
      for (const col of COLUMNS) console.log(`    ${col}: ${tsvCell(row[col]) || "(empty)"}`);
    }
    return;
  }

  await mkdir(path.dirname(opts.output), { recursive: true });
  await writeFile(opts.output, tsv);
  log(`Done. Wrote ${results.length} row(s) to ${opts.output}`);

  // Quick self-check summary.
  const byConf = results.reduce((acc, r) => ((acc[r.Confidence] = (acc[r.Confidence] || 0) + 1), acc), {});
  log(`Confidence breakdown: ${JSON.stringify(byConf)}`);
  const noWebsite = results.filter((r) => !r["Practice Website"]).length;
  if (noWebsite) log(`Note: ${noWebsite} therapist(s) had no linked practice website.`);
}

main().catch((err) => {
  log("FATAL:", err.stack || err.message);
  process.exitCode = 1;
});
