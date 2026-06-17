// Pendo Track Event helpers for First Session
// Centralizes event names and provides a safe wrapper around pendo.track()

const TRACK_EVENTS = {
  THERAPIST_SEARCH_EXECUTED: "therapist_search_executed",
  CONTACT_PATH_INITIATED: "contact_path_initiated",
  SEARCH_FILTERS_APPLIED: "search_filters_applied",
  CONTACT_PATH_COPIED: "contact_path_copied",
  SEARCH_NO_RESULTS: "search_no_results",
  INTAKE_ORGANIZATION_SELECTED: "intake_organization_selected",
};

function trackEvent(eventName, properties) {
  try {
    if (typeof pendo !== "undefined" && typeof pendo.track === "function") {
      pendo.track(eventName, properties);
    }
  } catch (e) {
    console.error("Pendo track error:", e);
  }
}

export { TRACK_EVENTS, trackEvent };
