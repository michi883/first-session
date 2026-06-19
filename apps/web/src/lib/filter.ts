import type {
  AccessPath,
  ContactMethod,
  Filters,
  SessionFormat,
} from "../types";

/** A fresh, empty filter set. */
export function emptyFilters(): Filters {
  return {
    focusAreas: new Set<string>(),
    methods: new Set<ContactMethod>(),
    formats: new Set<SessionFormat>(),
  };
}

/** Does this path offer the requested session format? "both" satisfies either. */
function providesFormat(path: AccessPath, wanted: SessionFormat): boolean {
  if (wanted === "both") return path.session_format === "both";
  return path.session_format === wanted || path.session_format === "both";
}

function matchesFilters(path: AccessPath, f: Filters): boolean {
  if (f.focusAreas.size > 0) {
    const hit = path.top_focus_areas.some((a) => f.focusAreas.has(a));
    if (!hit) return false;
  }
  if (f.methods.size > 0 && !f.methods.has(path.contact_method)) {
    return false;
  }
  if (f.formats.size > 0) {
    const hit = [...f.formats].some((fmt) => providesFormat(path, fmt));
    if (!hit) return false;
  }
  return true;
}

/**
 * Practical "where should I start tonight?" ordering — NOT a quality ranking:
 *   0  shared intake + email found
 *   1  shared intake + contact form
 *   2  single therapist + email found
 *   3  contact form / phone (single form, or any phone)
 *   4  Psychology Today-only / manual follow-up (website, no email)
 */
function priorityTier(p: AccessPath): number {
  const shared = p.is_shared_intake;
  const m = p.contact_method;
  if (shared && m === "email") return 0;
  if (shared && m === "form") return 1;
  if (m === "email") return 2;
  if (m === "form" || m === "phone") return 3;
  return 4; // website (manual follow-up) + psychology_today
}

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Filter, then order access paths by practical usefulness. */
export function selectPaths(paths: AccessPath[], f: Filters): AccessPath[] {
  const filtered = paths.filter((p) => matchesFilters(p, f));

  return filtered.sort((a, b) => {
    const ta = priorityTier(a);
    const tb = priorityTier(b);
    if (ta !== tb) return ta - tb;
    // Within a tier, a single contact that reaches more therapists comes first.
    if (b.therapist_count !== a.therapist_count) {
      return b.therapist_count - a.therapist_count;
    }
    const cr =
      (CONFIDENCE_RANK[a.confidence] ?? 3) - (CONFIDENCE_RANK[b.confidence] ?? 3);
    if (cr !== 0) return cr;
    return a.organization_or_practice.localeCompare(b.organization_or_practice);
  });
}

/** Free-text match for the individual-therapist search box: name, area, focus. */
export function matchesQuery(path: AccessPath, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    path.organization_display_name.toLowerCase().includes(q) ||
    path.area.toLowerCase().includes(q) ||
    path.top_focus_areas.some((a) => a.toLowerCase().includes(q))
  );
}
