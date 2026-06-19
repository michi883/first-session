import { useCallback, useState } from "react";

/**
 * Local-only outreach tracking. The guided flow sets one of three explicit
 * states per path; everything else is the absence of a record. Stored in
 * localStorage so it survives reloads but never leaves the device.
 */
export type PathStatus = "none" | "contacted" | "skipped" | "dead_end";

export const STATUS_LABELS: Record<PathStatus, string> = {
  none: "Not contacted",
  contacted: "Contacted",
  skipped: "Skipped",
  dead_end: "Dead end",
};

/** CSS modifier for each status pill (calm tones, not a quality signal). */
export const STATUS_TONE: Record<PathStatus, string> = {
  none: "none",
  contacted: "contacted",
  skipped: "skipped",
  dead_end: "dead",
};

/** A path is recommendable only while untouched. */
export function isRecommendable(status: PathStatus | undefined): boolean {
  return (status ?? "none") === "none";
}

export interface StatusTotals {
  contacted: number;
  skipped: number;
  deadEnds: number;
  /** Anything moved off "Not contacted". */
  handled: number;
}

export function summarize(statuses: Record<string, PathStatus>): StatusTotals {
  const t: StatusTotals = { contacted: 0, skipped: 0, deadEnds: 0, handled: 0 };
  for (const s of Object.values(statuses)) {
    if (s === "none") continue;
    t.handled += 1;
    if (s === "contacted") t.contacted += 1;
    else if (s === "skipped") t.skipped += 1;
    else if (s === "dead_end") t.deadEnds += 1;
  }
  return t;
}

const KEY = "firstsession.progress.v1";

function load(): Record<string, PathStatus> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, PathStatus>) : {};
  } catch {
    return {};
  }
}

/**
 * Reads/writes per-path outreach status. `none` is the absence of a record, so
 * setting it back to `none` clears the entry to keep storage tidy.
 */
export function useProgress() {
  const [statuses, setStatuses] = useState<Record<string, PathStatus>>(load);

  const setStatus = useCallback((pathId: string, status: PathStatus) => {
    setStatuses((prev) => {
      const next = { ...prev };
      if (status === "none") delete next[pathId];
      else next[pathId] = status;
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode / storage disabled — keep working in-memory only.
      }
      return next;
    });
  }, []);

  return { statuses, setStatus };
}
