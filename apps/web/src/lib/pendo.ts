// Pendo (Novus) product-analytics integration.
//
// The agent loader lives in index.html; this module owns initialization and a
// single safe wrapper around pendo.track(). Every interaction in the app routes
// through trackEvent() with event names from TRACK_EVENTS, so the instrumented
// surface is defined in one place and stays consistent with the access-path UX.
//
// Mapped to *access paths*, not therapist cards: we record which contact route a
// parent acted on and how they got there, never a "best therapist" ranking.

import type { AccessPath } from "../types";

interface PendoAgent {
  initialize: (config: Record<string, unknown>) => void;
  track: (name: string, properties?: Record<string, unknown>) => void;
  updateOptions: (config: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    pendo?: PendoAgent;
  }
}

/** Event names emitted to Pendo. One catalog so names never drift. */
export const TRACK_EVENTS = {
  RECOMMENDATION_VIEWED: "recommendation_viewed",
  RECOMMENDATION_REPLACED: "recommendation_replaced",
  ACCESS_PATH_OUTCOME: "access_path_outcome",
  CONTACT_PATH_INITIATED: "contact_path_initiated",
  CONTACT_PATH_COPIED: "contact_path_copied",
  BROWSE_ALL_OPENED: "browse_all_opened",
  BROWSE_SEARCH_EXECUTED: "browse_search_executed",
  BROWSE_NO_RESULTS: "browse_no_results",
  BROWSE_FILTERS_APPLIED: "browse_filters_applied",
} as const;

export type TrackEvent = (typeof TRACK_EVENTS)[keyof typeof TRACK_EVENTS];

/** Where in the app an action originated, so funnels can separate the two surfaces. */
export type EventSource = "recommendation" | "browse";

/**
 * Stable, non-identifying visitor id for the demo. Pendo wants a consistent id
 * per visitor; we generate a random one and persist it locally — no PII, just
 * enough to stitch a single session's events together.
 */
function getOrCreateVisitorId(): string {
  const key = "fs_pendo_visitor_id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `anon-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    // Storage can be blocked (private mode); fall back to an ephemeral id.
    return `anon-${Math.random().toString(36).slice(2)}`;
  }
}

/** Initialize the Pendo agent. Safe to call once on app startup. */
export function initPendo(): void {
  if (typeof window === "undefined" || !window.pendo) return;
  try {
    window.pendo.initialize({
      visitor: { id: getOrCreateVisitorId() },
      account: { id: "first-session-demo" },
    });
  } catch {
    // Never let analytics initialization break the app.
  }
}

/** Safe wrapper: queues/sends a track event, swallowing any agent errors. */
export function trackEvent(
  event: TrackEvent,
  properties: Record<string, unknown> = {},
): void {
  try {
    window.pendo?.track(event, properties);
  } catch {
    // Analytics must never throw into the UI.
  }
}

/**
 * The common access-path fields attached to most events, so a single contact
 * path is described consistently across the funnel. Focus areas are the path's
 * *listed* areas from Psychology Today — not a clinical claim about any person.
 */
export function pathProps(path: AccessPath): Record<string, unknown> {
  return {
    path_id: path.path_id,
    path_type: path.path_type,
    organization: path.organization_display_name,
    area: path.area,
    contact_method: path.contact_method,
    is_shared_intake: path.is_shared_intake,
    therapist_count: path.therapist_count,
    session_format: path.session_format,
    top_focus_areas: path.top_focus_areas.join(","),
    listed_medicaid: path.listed_medicaid,
    listed_teens: path.listed_teens,
    confidence: path.confidence,
    verification_status: path.verification_status,
  };
}
