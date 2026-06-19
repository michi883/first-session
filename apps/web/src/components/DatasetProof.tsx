import type { Fixture } from "../types";

/** One compact line of proof, above the recommendation. Credibility, not focus. */
export function DatasetProof({ totals }: { totals: Fixture["totals"] }) {
  return (
    <p className="proof" aria-label="Dataset">
      <span className="proof__lead">Built from</span>{" "}
      <strong>{totals.therapists}</strong> profiles ·{" "}
      <strong>{totals.access_paths}</strong> paths ·{" "}
      <strong>{totals.public_email_contacts}</strong> emails
    </p>
  );
}
