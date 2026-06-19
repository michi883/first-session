// build-app-fixture.js
//
// Builds the access-path fixture the First Session app consumes.
//
// First Session is a fail-fast navigator: instead of opening 260+ Psychology
// Today profiles one at a time, parents scan a short list of *contact paths*
// (shared practices, public emails, phone-only routes, PT-only routes) and pick
// the most practical one to try next.
//
// This script reads the extraction + contact-discovery outputs and collapses
// 260+ therapists into a much smaller set of access paths, grouping therapists
// who route through the same practice/contact channel.
//
// Reads:
//   data/therapists_internal.tsv        (specialties, location, medicaid/teens)
//   data/therapist_contact_emails.tsv   (email / website / phone per therapist)
//   data/therapist_contact_channels_25.tsv  (OPTIONAL — adds true contact-form
//                                             detection for a 25-row sample)
//
// Writes:
//   apps/web/src/data/accessPaths.json
//
// Nothing here is "verified". Medicaid/teens are *listed* on Psychology Today,
// not confirmed with the practice. Contact info is *found*, not tested. The
// fixture carries that uncertainty through to the UI on purpose.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INTERNAL_TSV = path.join(ROOT, "data", "therapists_internal.tsv");
const EMAILS_TSV = path.join(ROOT, "data", "therapist_contact_emails.tsv");
const CHANNELS_TSV = path.join(
  ROOT,
  "data",
  "therapist_contact_channels_25.tsv",
);
const OUT_FILE = path.join(
  ROOT,
  "apps",
  "web",
  "src",
  "data",
  "accessPaths.json",
);

// Consumer mailbox providers: two people with @gmail.com addresses are not a
// shared organization, so these never form a multi-therapist path on their own.
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "msn.com",
  "live.com",
  "comcast.net",
  "optonline.net",
  "proton.me",
  "protonmail.com",
]);

// ---------------------------------------------------------------------------
// TSV parsing
// ---------------------------------------------------------------------------

// These TSVs are one physical line per record (verified: line count == rows+1),
// with no embedded tabs or newlines in cells, so a plain split is safe and
// avoids pulling in a parser dependency.
function parseTsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((l) => l.length > 0);
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normalizeHost(url) {
  if (!url) return "";
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

function emailDomain(email) {
  const at = email.indexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function splitList(value) {
  if (!value) return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// "New York, NY 10018 · In-person & online" -> { area, format }
function parseLocation(value) {
  const raw = value || "";
  const [placePart] = raw.split("·");
  const place = (placePart || "").trim();
  const cityState = place.match(/([A-Za-z .'\-]+,\s*[A-Z]{2})/);
  const area = cityState ? cityState[1].trim() : place || "";

  const lower = raw.toLowerCase();
  const online = lower.includes("online");
  const inPerson = lower.includes("in-person") || lower.includes("in person");
  let format = "unknown";
  if (online && inPerson) format = "both";
  else if (online) format = "online";
  else if (inPerson) format = "in_person";

  return { area, format };
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function topByFrequency(values, limit) {
  const counts = new Map();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([v]) => v);
}

function combineFormats(formats) {
  const set = new Set(formats.filter((f) => f && f !== "unknown"));
  if (set.has("both") || (set.has("online") && set.has("in_person"))) {
    return "both";
  }
  if (set.size === 1) return [...set][0];
  return "unknown";
}

// ---------------------------------------------------------------------------
// Per-path question + script wording (honest, practical, no verification claim)
// ---------------------------------------------------------------------------

function firstQuestionFor(method) {
  switch (method) {
    case "email":
      return "Email and ask: do you have openings for a teen on Medicaid in the next month, and which Medicaid plans do you take?";
    case "form":
      return "Use the contact form to ask: are you taking new teen clients on Medicaid in the next month, and which plans?";
    case "phone":
      return "Call and ask: are you accepting new teen clients on Medicaid right now, and which Medicaid plans do you take?";
    case "psychology_today":
      return "Through the Psychology Today “Email Me” form, ask: are you accepting new teen Medicaid clients in the next month, and which plans?";
    default:
      return "Ask first: do you have openings for a teen on Medicaid in the next month, and which Medicaid plans do you take?";
  }
}

// Templated script for the detail drawer — brackets are placeholders the parent
// fills in (their teen's age, their specific Medicaid plan).
const SUGGESTED_SCRIPT =
  "Hi, I’m looking for a therapist for my [age]-year-old. Are you accepting new clients on [specific Medicaid plan] within the next month? If not, is there a waitlist or someone you’d recommend?";

// Readable display names for shared-practice domains. The domain already encodes
// the practice name; this is purely a formatting nicety (we can't reliably split
// a concatenated domain into words automatically). Unknown hosts fall back to the
// bare domain, so nothing is ever invented — only reformatted.
const DISPLAY_NAMES = {
  "liberationbasedtherapy.com": "Liberation Based Therapy",
  "nextlevelmhc.com": "Next Level MHC",
  "sparkmywellness.org": "Spark My Wellness",
  "feyahealth.io": "Feya Health",
  "northeastpsychological.com": "Northeast Psychological",
  "talknytherapy.com": "Talk NY Therapy",
  "thedeepseededtruth.com": "The Deep Seeded Truth",
  "theroom4therapy.com": "The Room 4 Therapy",
  "mindfulmomentosmft.com": "Mindful Momentos MFT",
  "brownwilliamspsychotherapy.com": "Brown Williams Psychotherapy",
  "cheriebrowntherapy.com": "Cherie Brown Therapy",
  "fireislandpinespsychotherapy.com": "Fire Island Pines Psychotherapy",
  "footprintsmentalhealthcounseling.com": "Footprints Mental Health Counseling",
  "minettepsychotherapy.com": "Minette Psychotherapy",
  "phoenixmft.com": "Phoenix MFT",
  "psychotherapyandcounselingservices.com": "Psychotherapy and Counseling Services",
  "reframedmentalhealth.com": "Reframed Mental Health",
  "lestersmentalhealthcounseling.com": "Lesters Mental Health Counseling",
  "the-room-for-therapy.ueniweb.com": "The Room For Therapy",
  "whatbringsyouintoday.com": "What Brings You In Today",
};

function displayNameFor(host) {
  return DISPLAY_NAMES[host] || host;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function build() {
  if (!fs.existsSync(INTERNAL_TSV)) {
    throw new Error(`Missing required input: ${INTERNAL_TSV}`);
  }
  if (!fs.existsSync(EMAILS_TSV)) {
    throw new Error(`Missing required input: ${EMAILS_TSV}`);
  }

  const internal = parseTsv(INTERNAL_TSV);
  const emails = parseTsv(EMAILS_TSV);

  // last_checked reflects when contact discovery last ran for this dataset.
  const lastChecked = fs
    .statSync(EMAILS_TSV)
    .mtime.toISOString()
    .slice(0, 10);

  // Optional enrichment: real <form> detection for a 25-row sample.
  const formByName = new Map();
  if (fs.existsSync(CHANNELS_TSV)) {
    for (const row of parseTsv(CHANNELS_TSV)) {
      const method = (row["Preferred Contact Method"] || "").toLowerCase();
      if (method.includes("contact form") && row["Contact Form URL"]) {
        formByName.set(row["Name"], row["Contact Form URL"]);
      }
    }
  }

  // Index contact info by therapist name.
  const contactByName = new Map();
  for (const row of emails) {
    if (!contactByName.has(row["Name"])) contactByName.set(row["Name"], row);
  }

  // Join + derive a per-therapist view.
  const therapists = internal.map((row) => {
    const c = contactByName.get(row["Name"]) || {};
    const { area, format } = parseLocation(row["Location / Online"]);
    const formUrl = formByName.get(row["Name"]) || ""; // verified <form> only
    const specialties = splitList(row["Specialties"]);
    const issues = splitList(row["Issues"]);
    return {
      name: row["Name"],
      credentials: row["Credentials"] || "",
      profile_url: row["Psychology Today Profile"] || c["Psychology Today Profile"] || "",
      location: (row["Location / Online"] || "").split("·")[0].trim(),
      area,
      session_format: format,
      listed_medicaid: (row["Medicaid Listed"] || "").toLowerCase() === "yes",
      listed_teens: (row["Works With Teens"] || "").toLowerCase() === "yes",
      focus_areas: specialties.length ? specialties : issues,
      website: c["Practice Website"] || "",
      email: c["Contact Email"] || "",
      contact_form_url: formUrl,
      phone: c["Phone"] || "",
      confidence: (c["Confidence"] || "").toLowerCase(), // high | low
    };
  });

  // ----- Choose a grouping key (organization identity) per therapist --------
  // Priority:
  //   1. practice website host (real shared-practice signal; email always
  //      implies a website in this dataset, so this also covers email orgs)
  //   2. non-generic email domain (rare fallback)
  //   3. phone number (phone-only routes that share a line)
  //   4. Psychology Today profile (PT-only — each is its own singleton path)
  function groupKeyFor(t) {
    const host = normalizeHost(t.website);
    if (host && !host.includes("psychologytoday.com")) return `web:${host}`;

    const dom = emailDomain(t.email);
    if (dom && !GENERIC_EMAIL_DOMAINS.has(dom)) return `web:${dom}`;
    if (dom) return `email:${t.email.toLowerCase()}`;

    if (t.phone) return `phone:${t.phone.replace(/[^\d+]/g, "")}`;
    return `pt:${slugify(t.name)}`;
  }

  const groups = new Map();
  for (const t of therapists) {
    const key = groupKeyFor(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  // ----- Build an access path per group ------------------------------------
  const paths = [];
  for (const [key, members] of groups) {
    const count = members.length;
    const isShared = count > 1;

    const anyEmail = members.find((m) => m.email)?.email || "";
    const anyForm = members.find((m) => m.contact_form_url)?.contact_form_url || "";
    const anyWebsite = members.find((m) => m.website)?.website || "";
    const anyPhone = members.find((m) => m.phone)?.phone || "";
    const anyProfile = members.find((m) => m.profile_url)?.profile_url || "";

    // Best contact method available for this path.
    let contactMethod;
    let statusLabel;
    let primaryContact;
    let contactSourceUrl;
    let confidence;

    if (anyEmail) {
      contactMethod = "email";
      statusLabel = "Email found";
      primaryContact = anyEmail;
      contactSourceUrl = anyWebsite || anyProfile;
      confidence = "high";
    } else if (anyForm) {
      contactMethod = "form";
      statusLabel = "Contact form";
      primaryContact = anyForm;
      contactSourceUrl = anyForm;
      confidence = "medium";
    } else if (anyWebsite) {
      contactMethod = "website";
      statusLabel = "Manual follow-up";
      primaryContact = anyWebsite;
      contactSourceUrl = anyWebsite;
      confidence = "low";
    } else if (anyPhone) {
      contactMethod = "phone";
      statusLabel = "Phone only";
      primaryContact = anyPhone;
      contactSourceUrl = anyProfile;
      confidence = "low";
    } else {
      contactMethod = "psychology_today";
      statusLabel = "PT only";
      primaryContact = anyProfile;
      contactSourceUrl = anyProfile;
      confidence = "low";
    }

    // path_type maps to the access-path categories: a multi-therapist route is a
    // shared intake path; singletons are typed by their channel.
    const pathType = isShared ? "shared_intake" : contactMethod === "form"
      ? "contact_form"
      : contactMethod === "email"
        ? "email"
        : contactMethod === "phone"
          ? "phone"
          : contactMethod === "website"
            ? "website"
            : "psychology_today";

    // Organization label: bare website host for shared practices (we don't
    // fabricate a pretty name); the therapist's name for singletons.
    const host = key.startsWith("web:") ? key.slice(4) : "";
    const organization = isShared && host ? host : members[0].name;
    const organizationDisplay =
      isShared && host ? displayNameFor(host) : organization;

    const focusPool = members.flatMap((m) => m.focus_areas);
    const topFocus = topByFrequency(focusPool, 5);

    // Prefer a real "City, ST" area for display; fall back to whatever's most
    // common (e.g. "Online Only") only when no member lists a physical place.
    const cityAreas = members
      .map((m) => m.area)
      .filter((a) => /,\s*[A-Z]{2}$/.test(a));
    const area =
      mostCommon(cityAreas) || mostCommon(members.map((m) => m.area)) || "";
    const sessionFormat = combineFormats(members.map((m) => m.session_format));

    paths.push({
      path_id: slugify(key.replace(/^[a-z]+:/, "")) || slugify(organization),
      path_type: pathType,
      organization_or_practice: organization,
      organization_display_name: organizationDisplay,
      area,
      primary_contact: primaryContact,
      contact_method: contactMethod,
      contact_channels: {
        email: anyEmail || null,
        contact_form_url: anyForm || null,
        website: anyWebsite || null,
        phone: anyPhone || null,
        psychology_today_url: anyProfile || null,
      },
      contact_source_url: contactSourceUrl || null,
      confidence,
      status_label: statusLabel,
      is_shared_intake: isShared,
      therapist_count: count,
      session_format: sessionFormat,
      top_focus_areas: topFocus,
      listed_medicaid: members.some((m) => m.listed_medicaid),
      listed_teens: members.some((m) => m.listed_teens),
      verification_status: "not_verified",
      last_checked: lastChecked,
      suggested_first_question: firstQuestionFor(contactMethod),
      suggested_script: SUGGESTED_SCRIPT,
      therapists: members.map((m) => ({
        name: m.name,
        credentials: m.credentials,
        location: m.location,
        session_format: m.session_format,
        profile_url: m.profile_url || null,
        email: m.email || null,
        phone: m.phone || null,
        focus_areas: m.focus_areas.slice(0, 6),
      })),
    });
  }

  // Default ordering = the fail-fast order: shared intake routes first (one
  // message reaches the most teens), then by how many therapists they cover,
  // then by how easy the contact looks.
  const confRank = { high: 0, medium: 1, low: 2 };
  paths.sort((a, b) => {
    if (a.is_shared_intake !== b.is_shared_intake) {
      return a.is_shared_intake ? -1 : 1;
    }
    if (b.therapist_count !== a.therapist_count) {
      return b.therapist_count - a.therapist_count;
    }
    const cr = (confRank[a.confidence] ?? 3) - (confRank[b.confidence] ?? 3);
    if (cr !== 0) return cr;
    return a.organization_or_practice.localeCompare(b.organization_or_practice);
  });

  // Filter option vocabularies, derived so the app never offers an empty filter.
  const focusAreas = topByFrequency(
    paths.flatMap((p) => p.top_focus_areas),
    24,
  ).sort((a, b) => a.localeCompare(b));

  const fixture = {
    generated_at: new Date().toISOString(),
    source: {
      internal_tsv: "data/therapists_internal.tsv",
      emails_tsv: "data/therapist_contact_emails.tsv",
      channels_tsv: fs.existsSync(CHANNELS_TSV)
        ? "data/therapist_contact_channels_25.tsv"
        : null,
      last_checked: lastChecked,
    },
    notes:
      "Medicaid and teen support are LISTED on Psychology Today, not verified with the practice. Contact info was found, not tested. Nothing here is ranked by quality.",
    totals: {
      therapists: therapists.length,
      access_paths: paths.length,
      shared_intake_paths: paths.filter((p) => p.is_shared_intake).length,
      // therapist-level counts for the "where do I start?" insight summary
      public_email_contacts: therapists.filter((t) => t.email).length,
      therapists_without_website: therapists.filter((t) => !t.website).length,
    },
    // One global outreach script — the same question works for every path, so we
    // surface it once at the top instead of repeating it on every card.
    outreach: {
      short_question:
        "Are you accepting new [age]-year-old clients on [specific Medicaid plan] within the next month?",
      long_message: SUGGESTED_SCRIPT,
    },
    filters: {
      focus_areas: focusAreas,
      contact_methods: ["email", "form", "phone", "psychology_today"],
      session_formats: ["online", "in_person", "both"],
    },
    access_paths: paths,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(fixture, null, 2) + "\n");

  // Console summary.
  const byLabel = new Map();
  for (const p of paths) byLabel.set(p.status_label, (byLabel.get(p.status_label) || 0) + 1);
  console.log(`Built ${OUT_FILE.replace(ROOT + "/", "")}`);
  console.log(
    `  ${therapists.length} therapists -> ${paths.length} access paths ` +
      `(${fixture.totals.shared_intake_paths} shared intake)`,
  );
  console.log("  paths by status:");
  for (const [label, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}  ${label}`);
  }
  const topShared = paths.filter((p) => p.is_shared_intake).slice(0, 5);
  if (topShared.length) {
    console.log("  largest shared paths:");
    for (const p of topShared) {
      console.log(
        `    ${String(p.therapist_count).padStart(3)}  ${p.organization_or_practice} (${p.status_label})`,
      );
    }
  }
  console.log(`  contact channels last checked: ${lastChecked}`);
}

build();
