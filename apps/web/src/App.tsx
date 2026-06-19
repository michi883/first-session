import { useEffect, useMemo, useRef, useState } from "react";
import type { AccessPath, Fixture } from "./types";
import fixtureData from "./data/accessPaths.json";
import { emptyFilters, selectPaths } from "./lib/filter";
import { isRecommendable, summarize, useProgress } from "./lib/progress";
import type { PathStatus } from "./lib/progress";
import { TRACK_EVENTS, pathProps, trackEvent } from "./lib/pendo";
import { WhatIsThis } from "./components/WhatIsThis";
import { DatasetProof } from "./components/DatasetProof";
import { ProgressLine } from "./components/ProgressLine";
import { RecommendationCard } from "./components/RecommendationCard";
import { BrowseAll } from "./components/BrowseAll";

const fixture = fixtureData as unknown as Fixture;

/** Every path ranked by leverage; this single order drives the recommendation. */
const rankedAll = selectPaths(fixture.access_paths, emptyFilters());
const largestId = rankedAll.reduce(
  (best, p) => (p.therapist_count > best.therapist_count ? p : best),
  rankedAll[0],
).path_id;

const CONFIRMATION: Record<Exclude<PathStatus, "none">, string> = {
  contacted: "✓ Saved.",
  skipped: "✓ Skipped.",
  dead_end: "✓ Marked as a dead end.",
};

/** idle = showing a card; leaving = fading it out; finding = brief message. */
type Phase = "idle" | "leaving" | "finding";

export function App() {
  const { statuses, setStatus } = useProgress();
  /** Cursor into the still-recommendable paths — there is always exactly one. */
  const [recIndex, setRecIndex] = useState(0);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  const recommendable = useMemo(
    () => rankedAll.filter((p) => isRecommendable(statuses[p.path_id])),
    [statuses],
  );
  const countRef = useRef(recommendable.length);
  countRef.current = recommendable.length;

  const idx = recommendable.length
    ? Math.min(recIndex, recommendable.length - 1)
    : 0;
  const activeRec: AccessPath | null = recommendable[idx] ?? null;

  const totals = useMemo(() => summarize(statuses), [statuses]);

  // Auto-dismiss the confirmation message.
  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 2000);
    return () => clearTimeout(t);
  }, [confirmation]);

  // Drive the replace transition: fade out → "Finding…" → swap in the next.
  useEffect(() => {
    if (phase === "leaving") {
      const t = setTimeout(() => setPhase("finding"), 220);
      return () => clearTimeout(t);
    }
    if (phase === "finding") {
      const t = setTimeout(() => {
        const n = countRef.current;
        setRecIndex((i) => (Math.min(i, n - 1) + 1) % n);
        setPhase("idle");
      }, 450);
      return () => clearTimeout(t);
    }
  }, [phase]);

  /** Mark the active recommendation and replace it with the next best path. */
  function markActive(status: PathStatus) {
    if (!activeRec || status === "none") return;
    setStatus(activeRec.path_id, status);
    trackEvent(TRACK_EVENTS.ACCESS_PATH_OUTCOME, {
      ...pathProps(activeRec),
      outcome: status,
      source: "recommendation",
    });
    setRecIndex(0); // next render's recommendable[0] is the new best path
    setConfirmation(CONFIRMATION[status]);
  }

  /** Replace the current recommendation with the next one, in the same spot. */
  function tryAnother() {
    if (phase !== "idle" || recommendable.length <= 1) return;
    if (activeRec) {
      trackEvent(TRACK_EVENTS.RECOMMENDATION_REPLACED, {
        ...pathProps(activeRec),
        remaining_options: recommendable.length,
      });
    }
    setConfirmation(null);
    setPhase("leaving");
  }

  /** Marking from the browse directory just persists status. */
  function markFromBrowse(path: AccessPath, status: PathStatus) {
    setStatus(path.path_id, status);
    if (status === "none") return;
    trackEvent(TRACK_EVENTS.ACCESS_PATH_OUTCOME, {
      ...pathProps(path),
      outcome: status,
      source: "browse",
    });
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="hero__brand">First Session</p>
        <h1 className="hero__tagline">Who should I contact first?</h1>
        <p className="hero__message">
          A fail-fast navigator for NYC parents looking for Medicaid teen
          therapy.
        </p>
      </header>

      <DatasetProof totals={fixture.totals} />

      <WhatIsThis />

      <ProgressLine totals={totals} />

      {confirmation && (
        <p className="confirm" role="status">
          {confirmation}
        </p>
      )}

      {phase === "finding" ? (
        <div className="rec rec--finding" role="status" aria-live="polite">
          <p className="rec__finding">Finding another recommendation…</p>
        </div>
      ) : (
        <div className={`rec-fade${phase === "leaving" ? " rec-fade--out" : ""}`}>
          <RecommendationCard
            key={activeRec?.path_id ?? "done"}
            path={activeRec}
            label="Recommended first"
            isLargest={activeRec?.path_id === largestId}
            onMark={markActive}
          />
        </div>
      )}

      {recommendable.length > 1 && (
        <div className="another">
          <button
            type="button"
            className="another__btn"
            onClick={tryAnother}
            disabled={phase !== "idle"}
          >
            Try another option
          </button>
        </div>
      )}

      <BrowseAll
        paths={rankedAll}
        filterOptions={fixture.filters}
        statuses={statuses}
        onMark={markFromBrowse}
      />

      <footer className="app__footer">
        <p>
          Medicaid and teen support are listed on Psychology Today, not
          verified — always confirm directly with the practice.
        </p>
      </footer>
    </div>
  );
}
