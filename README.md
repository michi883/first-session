# First Session — a fail-fast access navigator

First Session helps NYC parents **fail fast** when searching for **Medicaid teen
therapists**. Instead of opening 260+ Psychology Today profiles one by one, a
parent scans a short list of **contact paths** and picks the most practical one
to try next.

> **Primary message:** "Find the next realistic contact path, not the perfect
> therapist."

It is **not** a therapist matching app and **not** a clinical recommendation
engine. There is no quality ranking, no match score, and no "best therapist."

## Why it exists

Finding a therapist who (a) takes Medicaid, (b) works with teens, and (c) is
actually accepting new clients is a brutal funnel. Public directories list
hundreds of names but hide the thing that matters most to an overwhelmed
parent: **how do I reach a real person, and what do I ask?**

First Session reframes the problem around *access*. Many therapists share an
intake organization, a practice site, or a phone line — so a single email can
reach 15 therapists at once. Surfacing those shared paths first lets a parent
spend their limited energy on outreach that's likely to get a reply, and abandon
dead ends quickly.

## The big idea: access paths, not cards

Results are organized around **contact paths**, each of which may be:

- a **shared intake organization** (one contact reaches many therapists)
- a **public email**
- a **contact form**
- a **phone-only** route
- a **Psychology Today–only** contact route

Each path shows: how many therapists route through it, which channels exist,
whether it looks easy or manual, whether Medicaid/teens are **listed** (not
verified), and **what to ask first**.

## Features

The app is a single, mobile-first page built around one question — **"Who should
I contact first?"** It runs entirely client-side on a static fixture (~266 NYC
profiles collapsed into 210 contact paths); there is no backend, login, or
network call at runtime.

### Guided "contact first" recommendation

- Surfaces **one recommended contact path at a time** ("Recommended first"),
  picked by a leverage heuristic (see below) — never a quality score.
- The card leads with **reach** ("Reach 15 therapists") for shared-intake paths,
  or the practice name + "Individual therapist" for solo paths.
- **"Why start here?"** shows 2–3 factual, data-derived bullets (e.g. "One
  outreach may reach 15 therapists.", "Public email available."). The single
  largest shared path is badged *"Largest shared intake path in this dataset."*
- **"Try another option"** swaps in the next-best path with a brief "Finding
  another recommendation…" transition, keeping you in the same spot.
- Once every lead is handled, the card becomes a **done state** ("You've worked
  through every lead") that points to the full directory.

### Real, working actions on every path

The recommendation and every directory row expose the same action set — no
placeholders and no `mailto:`:

- **One primary action**, chosen by channel priority: open contact form → copy
  email → open website → open Psychology Today → copy phone.
- **"Copy outreach message"** — a path-specific draft (different wording for
  shared-intake vs. individual paths) with `[age]` and `[specific Medicaid plan]`
  placeholders to fill in, so it's worth copying instead of a generic template.
- **"More actions"** reveals every other channel the path has.
- **Copy buttons** use the Clipboard API with specific confirmation ("✓ Email
  address copied"), reset if the underlying value changes, and fail quietly when
  clipboard access is blocked; links open in a new tab. Phone numbers are
  formatted for reading — `(212) 555-0123`.

### Outreach progress tracking (local-only)

- Mark any path **Contacted**, **Skip for now**, or **Mark dead end**; a short
  toast confirms the change ("✓ Saved.").
- A **progress line** ("3 contacted · 2 skipped · 1 dead end") appears once at
  least one action has been taken.
- Marked paths **drop out of the recommendation rotation**, so you always move
  forward — only untouched paths are recommendable.
- State persists to **localStorage** (`firstsession.progress.v1`): it survives
  reloads but **never leaves the device** and needs no account.

### Browse all contact paths

- A directory that is **collapsed by default** so it never competes with the
  single recommendation; open it to explore all 210 paths.
- **Search** by name, area, or focus area, plus **filter chips** for contact
  method (email / contact form / phone / Psychology Today) and focus area — the
  options come straight from the fixture.
- Results are **grouped** into "Shared intake paths (N)" and "Individual
  therapist paths (M)".
- Each row **expands inline** to the same actions and mark buttons, and shows a
  status pill once it has been marked.

### Leverage ordering — *not* a quality ranking

Paths are ordered for "where do I start tonight?", strictly by reach/effort:

1. shared intake + email found
2. shared intake + contact form
3. single therapist + email found
4. contact form / phone
5. website-only (manual follow-up) / Psychology Today–only

Ties break by **therapist count**, then listed **confidence**, then name. There
is no "best", no match score, and no clinical ranking anywhere in the product.

### Honest, calm framing

- A one-line **dataset proof** — "Built from 266 therapist profiles · 210 contact
  paths · 79 public email addresses" — for credibility without overclaiming.
- A collapsible **"What is this?"** explainer that frames the tool in two plain
  paragraphs, then stays out of the way.
- The UI consistently uses **"listed", "found", "not verified", "manual
  follow-up"** and tells parents to confirm Medicaid/availability directly.
- Mobile-first and accessibility-leaning: semantic landmarks, `aria-expanded`
  toggles, and polite live regions for the confirmation/progress messages.

## Repo layout

```
apps/web/                     Vite + React mobile-first app
  src/data/accessPaths.json   GENERATED fixture the app consumes
pipeline/                     data pipeline
  extract.js                  scrape a filtered PT search → therapist records
  discover-contacts.js        find email / website / form / phone per therapist
  build-app-fixture.js        group therapists into access paths for the app
  lib/                        shared extraction/enrichment/export helpers
data/                         pipeline outputs (TSV / CSV / JSON)
deploy/                       deploy scripts + nginx template (see deploy/README.md)
Dockerfile, firebase.json     Cloud Run + Firebase Hosting config (first-session-ux)
```

## How the data pipeline works

```
PT search ──extract.js──▶ therapists_raw/enriched.json ──▶ therapists_internal.tsv
                                                              │
                       discover-contacts.js ─────────────────┤──▶ therapist_contact_emails.tsv
                                                              │      therapist_contact_channels_25.tsv
                                                              ▼
                       build-app-fixture.js ──▶ apps/web/src/data/accessPaths.json
```

1. **Extract** — `pipeline/extract.js` scrapes a pre-filtered Psychology Today
   search (New York County · Medicaid · Teens), fetches each full profile, and
   (optionally) enriches it with Gemini into parent-readable summary fields.
   Outputs `data/therapists_internal.tsv` plus raw/enriched JSON.
2. **Discover contacts** — `pipeline/discover-contacts.js` visits each profile /
   linked practice site and records the best contact channel found (public
   email, contact form, phone, or a Psychology Today "Email Me" fallback) into
   `data/therapist_contact_emails.tsv`. A richer 25-row sample with true
   `<form>` detection lives in `data/therapist_contact_channels_25.tsv`.
3. **Build the app fixture** — `pipeline/build-app-fixture.js` groups therapists
   by shared contact path and writes `apps/web/src/data/accessPaths.json`.

### Building the app fixture

```bash
npm run fixture        # node pipeline/build-app-fixture.js
```

Reads `data/therapists_internal.tsv` + `data/therapist_contact_emails.tsv`
(and `data/therapist_contact_channels_25.tsv` if present), and writes
`apps/web/src/data/accessPaths.json`.

**Grouping key**, in priority order: practice website host → non-generic email
domain → phone number → Psychology Today profile (singleton). Therapists sharing
a key collapse into one access path. The script prints a summary, e.g.:

```
266 therapists -> 210 access paths (21 shared intake)
paths by status:  116 Phone only · 44 Email found · 42 Manual follow-up · 5 PT only · 3 Contact form
largest shared paths: 15 liberationbasedtherapy.com · 10 nextlevelmhc.com · 9 sparkmywellness.org
```

Each access path carries: `path_id`, `path_type`, `organization_or_practice`,
`area`, `primary_contact`, `contact_method`, `contact_channels`,
`contact_source_url`, `confidence`, `status_label`, `is_shared_intake`,
`therapist_count`, `session_format`, `top_focus_areas[]`, `listed_medicaid`,
`listed_teens`, `verification_status`, `last_checked`,
`suggested_first_question`, `suggested_script`, and the `therapists[]` under it.

## Running the app

```bash
npm run fixture        # 1. (re)generate apps/web/src/data/accessPaths.json
npm run web:install    # 2. first time only (installs apps/web deps)
npm run web:dev        # 3. http://localhost:5173
```

`npm run web:build` type-checks and produces a production build. The app is fully
static — it reads only `accessPaths.json`, with **no backend, auth, runtime AI,
scheduling, payments, or scraping**.

## Deploy

One static build ships to two targets on GCP project **`first-session-ux`**:

```bash
npm run deploy:hosting     # Firebase Hosting — serves apps/web/dist
npm run deploy:cloudrun    # Cloud Run — nginx container of the same build
```

See [`deploy/README.md`](deploy/README.md) for prerequisites (`firebase login` /
`gcloud auth login`), local container testing, and configuration. No secrets are
bundled into either target.

## Product analytics — Pendo (Novus) integration

The app is instrumented with **Pendo** for product analytics. The integration
was bootstrapped by **Novus** (Pendo's AI agent, `novus.pendo.io`), which opens
pull requests against this repo to install the SDK and instrument events:

| Novus PR | What it does |
|----------|--------------|
| **#1 · Install Novus** (`novus/install-pendo-sdk`, merged) | Adds the Pendo agent loader (web install). |
| **#2 · Instrument Pendo Track Events** (`novus/instrument-pendo-track-events`) | Novus's proposed track-event set. |

This branch adapts that integration to the **real access-path app**: every event
is mapped to a *contact path* (not an individual "therapist card"), and the event
properties stay consistent with the product's honest framing — no quality score,
no "best therapist", and Medicaid/teens remain **listed, not verified**.

> ⚠️ **Demo-only data.** This is a hackathon demo with **no real users**: the
> dataset is a public, Psychology Today–derived snapshot, and `top_focus_areas`
> on an event describe a *path's listed focus*, not any real person's diagnosis.
> Before putting this in front of real parents, the event payloads should be
> reviewed — searches about a minor's mental health tied to a Medicaid plan are
> sensitive, and Pendo features like Session Replay should stay off.

### How it's wired

```
apps/web/index.html        Pendo agent loader (<script> in <head>)
apps/web/src/main.tsx       initPendo() before first render
apps/web/src/lib/pendo.ts   init + visitor id + TRACK_EVENTS + trackEvent() + pathProps()
```

- **Agent loader** (`index.html`) — the standard Pendo snippet. Its agent key,
  `9485a805-79d2-49bb-b5e4-789900187948`, is a **public client-side key** (it
  ships to every browser by design), so it is committed, not a secret.
- **Initialization** (`src/lib/pendo.ts → initPendo`) — called once from
  `main.tsx`. Visitor id is an **anonymous, non-PII** value (`anon-<uuid>`)
  persisted in `localStorage` (`fs_pendo_visitor_id`) so a single session's
  events stitch together; account id is the constant `first-session-demo`.
- **Safe wrapper** (`trackEvent`) — all tracking goes through one wrapper that
  no-ops if the agent is absent and swallows any error, so analytics can never
  throw into the UI. Event names live in one `TRACK_EVENTS` catalog.
- **Surface tag** — actions carry a `source` of `"recommendation"` or
  `"browse"`, so the single recommendation flow and the directory can be told
  apart in funnels.

### Event catalog

Most events also carry the shared **path properties** from `pathProps()` (see
below). Surface-specific properties are listed here:

| Event | Fires when | Notable properties |
|-------|-----------|--------------------|
| `recommendation_viewed` | a recommendation card is surfaced (once per path) | `label`, `is_largest` |
| `recommendation_replaced` | "Try another option" is clicked | `remaining_options` |
| `access_path_outcome` | a path is marked **Contacted / Skip / Dead end** | `outcome` (`contacted`\|`skipped`\|`dead_end`), `source` |
| `contact_path_initiated` | a link action opens (contact form / website / Psychology Today) | `source`, `action_id`, `action_label` |
| `contact_path_copied` | a copy action runs (email / phone / outreach message) | `source`, `action_id`, `action_label` |
| `browse_all_opened` | the "Browse all contact paths" directory is opened | `total_paths` |
| `browse_search_executed` | a search/filter settles in Browse (debounced 400 ms; only when criteria are set) | `query_present`, `methods`, `focus_areas`, `results_count`, `shared_count`, `individual_count` |
| `browse_no_results` | a Browse search/filter yields zero paths | `query_present`, `methods`, `focus_areas` |
| `browse_filters_applied` | a filter chip is toggled | `filter_type` (`contact_method`\|`focus_area`), `filter_value`, `enabled`, `active_*_count` |

> Free-text search keystrokes are **not** sent. `browse_search_executed` is
> debounced and records *intent* (`query_present` boolean + the active filters +
> result counts), never the raw query string.

### Shared path properties (`pathProps`)

Attached to recommendation, outcome, and contact events so one contact path is
described identically across the funnel:

`path_id`, `path_type`, `organization`, `area`, `contact_method`,
`is_shared_intake`, `therapist_count`, `session_format`, `top_focus_areas`
(comma-joined), `listed_medicaid`, `listed_teens`, `confidence`,
`verification_status` (always `not_verified`).

### Verifying & disabling

- **Verify locally:** run `npm run web:dev`, open the console, and confirm
  `window.pendo` exists; interactions enqueue/send `pendo.track(...)` calls.
  Use Pendo's own debugger to watch events land. (A blocked CDN or ad-blocker
  simply makes tracking a silent no-op — the app still works.)
- **Disable tracking:** remove the agent `<script>` from `apps/web/index.html`
  (and optionally the `initPendo()` call in `main.tsx`). `trackEvent()` then
  no-ops everywhere, so no component changes are needed.

## Verified vs not verified

This is a hard product rule. The app uses the words **"listed", "found", "not
verified", "manual follow-up"** — never "verified", "best", or "match".

| Found / listed (shown as-is) | **Not** verified |
|---|---|
| Contact channels (email, form, phone, website, PT "Email Me") | Whether the channel actually works / gets a reply |
| Medicaid + "works with teens" flags **as listed on Psychology Today** | Whether the practice takes the parent's specific Medicaid plan |
| Specialties, location, session format | Current availability / accepting new clients |

`verification_status` is `not_verified` for every path today.

## Current limitations

- **Nothing is verified.** All Medicaid/teen/availability signals are *listed*,
  not confirmed. The whole point of the suggested questions is to get the parent
  to verify directly.
- **Contact discovery is heuristic.** "Email found" means a public email was
  located on a practice site; it was not tested. True `<form>` detection only
  ran on the 25-row sample.
- **Organization names** for shared web paths are shown as the bare domain
  (e.g. `liberationbasedtherapy.com`) — we don't fabricate a prettier name.
- **Dataset is a snapshot** (~266 NYC profiles, `last_checked` carried in the
  fixture). It is not live.
- **No accessibility / i18n pass yet**, and the app is English-only.

## Hackathon scope

Demonstrate the fail-fast access-path UX clearly on the current dataset before
expanding data or adding verification. **Out of scope for now:** real
Medicaid/availability verification, automated outreach, login, and any quality
ranking.

---

## Pipeline reference (extraction & contact discovery)

The scraping scripts are kept for regenerating and expanding the dataset. They
require Playwright; the app itself does not.

### Setup

Requires Node.js ≥ 18 (tested on v24).

```bash
npm install
npm run install-browser    # downloads Chromium for Playwright
cp .env.example .env        # then add your GEMINI_API_KEY (enrichment only)
```

### Environment (`.env`)

Auto-loaded from the project root. The API key is sent only in the request
header and is never logged.

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | For enrichment | Gemini API key. If absent, extraction still runs but enrichment UX fields stay empty. |
| `GEMINI_MODEL` | No | Overrides the model. Default: `gemini-3.1-flash-lite` → falls back to `gemini-3-flash-preview`. |

> ⚠️ Gemini enrichment is parent-readable **summarization only** — not medical
> advice or a clinical recommendation. It uses only public profile text and
> cautious wording, and is never told to call a therapist "best" or "guaranteed".

### Common commands

```bash
node pipeline/extract.js --dry-run --headless false   # first record end-to-end
node pipeline/extract.js --max-records 300            # capture all ~261 results
node pipeline/extract.js --spreadsheet-only           # rebuild TSVs from enriched JSON, no scraping
node pipeline/discover-contacts.js                    # discover contact channels
node pipeline/discover-contacts.js --email-only --max-records 1000
```

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | off | Extract only the first record + profile + enrichment, then stop. |
| `--max-records N` | `250` | Stop after N records (the source search returns ~261, so raise this to capture all). |
| `--headless true\|false` | `true` | Run the browser headless or visible (use `false` to solve challenges). |
| `--delay-ms N` | `3000` | Base polite delay between requests (jittered ±40%). |
| `--no-resume` | off | Ignore URLs recorded in a previous run's `seen_urls.json`. |
| `--no-enrich` | off | Skip Gemini enrichment; raw extraction only. |
| `--spreadsheet-only` | off | Rebuild TSVs from an existing `therapists_enriched.json` without scraping. |

### Key outputs in `data/`

| File | Role |
|------|------|
| `therapists_internal.tsv` | Full internal record (specialties, issues, tone, location). Fixture input. |
| `therapist_contact_emails.tsv` | Best contact channel per therapist (266 rows). Fixture input. |
| `therapist_contact_channels_25.tsv` | Richer 25-row sample with true contact-form detection. Optional fixture enrichment. |
| `therapists_raw.json` / `therapists_enriched.json` | Internal source of truth (raw vs Gemini-enriched). |
| `therapists_parent_shareable.tsv` | Simplified community-verification sheet for parents. |
| `therapists_card_preview.json` | **Legacy** fixture from the old emotional-matching prototype — kept for reference, not used by the app. |

### Anti-bot notes

Psychology Today may serve interstitial challenges. Run with `--headless false`
to solve them manually; keep `--delay-ms` polite; the run resumes from
`data/seen_urls.json` so an interrupted scrape can continue. Selectors are
centralized in `pipeline/lib/` and may drift if the site changes.
