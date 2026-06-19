import { useEffect, useMemo, useState } from "react";
import type { AccessPath, ContactMethod, Fixture } from "../types";
import type { PathStatus } from "../lib/progress";
import { matchesQuery } from "../lib/filter";
import { TRACK_EVENTS, trackEvent } from "../lib/pendo";
import { BrowseItem } from "./BrowseItem";

interface BrowseAllProps {
  paths: AccessPath[];
  filterOptions: Fixture["filters"];
  statuses: Record<string, PathStatus>;
  onMark: (path: AccessPath, status: PathStatus) => void;
}

const METHOD_LABELS: Record<ContactMethod, string> = {
  email: "Email",
  form: "Contact form",
  phone: "Phone",
  website: "Website",
  psychology_today: "Psychology Today",
};

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  next.has(v) ? next.delete(v) : next.add(v);
  return next;
}

/**
 * The full directory — collapsed by default so it never competes with the
 * single recommendation. Opened on demand for search/filter, grouped by
 * leverage (shared intake first, then individual therapist paths).
 */
export function BrowseAll({ paths, filterOptions, statuses, onMark }: BrowseAllProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [methods, setMethods] = useState<Set<ContactMethod>>(new Set());
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const [openItem, setOpenItem] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      paths.filter((p) => {
        if (!matchesQuery(p, query)) return false;
        if (methods.size > 0 && !methods.has(p.contact_method)) return false;
        if (focus.size > 0 && !p.top_focus_areas.some((a) => focus.has(a)))
          return false;
        return true;
      }),
    [paths, query, methods, focus],
  );

  const shared = filtered.filter((p) => p.therapist_count >= 2);
  const individual = filtered.filter((p) => p.therapist_count < 2);

  /** Open/close the directory; record the open so it can anchor a funnel. */
  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next) trackEvent(TRACK_EVENTS.BROWSE_ALL_OPENED, { total_paths: paths.length });
      return next;
    });
  }

  /** Toggle a chip and record which filter was applied (current closure = pre-toggle). */
  function applyMethod(m: ContactMethod) {
    const enabled = !methods.has(m);
    setMethods((s) => toggle(s, m));
    trackEvent(TRACK_EVENTS.BROWSE_FILTERS_APPLIED, {
      filter_type: "contact_method",
      filter_value: m,
      enabled,
      active_method_count: enabled ? methods.size + 1 : methods.size - 1,
    });
  }

  function applyFocus(f: string) {
    const enabled = !focus.has(f);
    setFocus((s) => toggle(s, f));
    trackEvent(TRACK_EVENTS.BROWSE_FILTERS_APPLIED, {
      filter_type: "focus_area",
      filter_value: f,
      enabled,
      active_focus_count: enabled ? focus.size + 1 : focus.size - 1,
    });
  }

  // Record an executed search once the parent settles on a query/filter set
  // (debounced so we capture intent, not every keystroke). Only fires when
  // there is actual search criteria — a bare open is BROWSE_ALL_OPENED instead.
  useEffect(() => {
    if (!open) return;
    const queryPresent = query.trim() !== "";
    if (!queryPresent && methods.size === 0 && focus.size === 0) return;
    const t = setTimeout(() => {
      trackEvent(TRACK_EVENTS.BROWSE_SEARCH_EXECUTED, {
        query_present: queryPresent,
        methods: [...methods].join(","),
        focus_areas: [...focus].join(","),
        results_count: filtered.length,
        shared_count: shared.length,
        individual_count: individual.length,
      });
      if (filtered.length === 0) {
        trackEvent(TRACK_EVENTS.BROWSE_NO_RESULTS, {
          query_present: queryPresent,
          methods: [...methods].join(","),
          focus_areas: [...focus].join(","),
        });
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, methods, focus, filtered.length]);

  const renderItem = (p: AccessPath) => (
    <BrowseItem
      key={p.path_id}
      path={p}
      status={statuses[p.path_id] ?? "none"}
      open={openItem === p.path_id}
      onToggle={() => setOpenItem((id) => (id === p.path_id ? null : p.path_id))}
      onMark={(s) => onMark(p, s)}
    />
  );

  return (
    <section className="browse" aria-label="Browse all contact paths">
      <button
        type="button"
        className="browse__toggle"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className="browse__toggle-main">
          <span className="browse__toggle-title">Browse all contact paths</span>
          <span className="browse__toggle-sub">
            Search all {paths.length} paths beyond this recommendation.
          </span>
        </span>
        <span className="browse__toggle-cue">{open ? "Close" : "Open"}</span>
      </button>

      {open && (
        <div className="browse__body">
          <input
            type="search"
            className="browse__search"
            placeholder="Search by name, area, or focus…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="browse__filters">
            <div className="chiprow">
              {filterOptions.contact_methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip${methods.has(m) ? " chip--on" : ""}`}
                  onClick={() => applyMethod(m)}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="chiprow">
              {filterOptions.focus_areas.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip${focus.has(f) ? " chip--on" : ""}`}
                  onClick={() => applyFocus(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="browse__empty">No contact paths match those filters.</p>
          ) : (
            <>
              {shared.length > 0 && (
                <div className="browse__group">
                  <h3 className="browse__grouptitle">
                    Shared intake paths ({shared.length})
                  </h3>
                  <ul className="browse__list">{shared.map(renderItem)}</ul>
                </div>
              )}
              {individual.length > 0 && (
                <div className="browse__group">
                  <h3 className="browse__grouptitle">
                    Individual therapist paths ({individual.length})
                  </h3>
                  <ul className="browse__list">{individual.map(renderItem)}</ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
