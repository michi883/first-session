import type { StatusTotals } from "../lib/progress";

/** Compact progress, shown only once at least one action has been taken. */
export function ProgressLine({ totals }: { totals: StatusTotals }) {
  if (totals.handled === 0) return null;
  return (
    <p className="progressline">
      <span className="progressline__lead">Progress:</span> {totals.contacted}{" "}
      contacted · {totals.skipped} skipped · {totals.deadEnds} dead end
      {totals.deadEnds === 1 ? "" : "s"}
    </p>
  );
}
