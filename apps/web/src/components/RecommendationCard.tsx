import { useEffect } from "react";
import type { AccessPath } from "../types";
import type { PathStatus } from "../lib/progress";
import { reachLabel, recommendationReasons } from "../lib/labels";
import { TRACK_EVENTS, pathProps, trackEvent } from "../lib/pendo";
import { ActionRow } from "./ActionRow";
import { CompletionButtons } from "./CompletionButtons";

interface RecommendationCardProps {
  path: AccessPath | null;
  /** "Recommended first" for the top pick, "Another option" for revealed ones. */
  label: string;
  isLargest: boolean;
  onMark: (status: PathStatus) => void;
}

/**
 * One recommendation. Visual order is reach → organization → why → actions, so
 * the leverage catches the eye first and the reasons answer "why this one"
 * before the parent acts. Several can stack so a parent compares the best few.
 */
export function RecommendationCard({
  path,
  label,
  isLargest,
  onMark,
}: RecommendationCardProps) {
  // One view event per recommendation surfaced. Keyed on path_id by the parent,
  // so each newly recommended path fires exactly once.
  useEffect(() => {
    if (!path) return;
    trackEvent(TRACK_EVENTS.RECOMMENDATION_VIEWED, {
      ...pathProps(path),
      label,
      is_largest: isLargest,
    });
  }, [path, label, isLargest]);

  if (!path) {
    return (
      <section className="rec rec--done" aria-label="Recommended first">
        <h2 className="rec__heading">You’ve worked through every lead</h2>
        <p className="rec__donenote">
          Open “Browse all contact paths” below to revisit a skipped path or
          explore the full dataset.
        </p>
      </section>
    );
  }

  const shared = path.therapist_count >= 2;
  const reasons = recommendationReasons(path, isLargest);
  const alt = label !== "Recommended first";

  return (
    <section className={`rec${alt ? " rec--alt" : ""}`} aria-label={label}>
      <p className={`rec__eyebrow${alt ? " rec__eyebrow--alt" : ""}`}>{label}</p>

      {shared ? (
        <>
          <p className="rec__reach">{reachLabel(path.therapist_count)}</p>
          <p className="rec__name">{path.organization_display_name}</p>
        </>
      ) : (
        <>
          <p className="rec__reach rec__reach--name">
            {path.organization_display_name}
          </p>
          <p className="rec__name">Individual therapist</p>
        </>
      )}

      <div className="rec__why">
        <p className="rec__whytitle">Why start here?</p>
        <ul className="rec__bullets">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <ActionRow path={path} source="recommendation" />
      <CompletionButtons onMark={onMark} />
    </section>
  );
}
