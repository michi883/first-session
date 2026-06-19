import type { PathStatus } from "../lib/progress";

interface CompletionButtonsProps {
  onMark: (status: PathStatus) => void;
}

/**
 * The three explicit outcome buttons that replace the old ambiguous checkbox.
 * Each one persists a real status and advances the flow.
 */
export function CompletionButtons({ onMark }: CompletionButtonsProps) {
  return (
    <div className="complete">
      <button
        type="button"
        className="complete__btn complete__btn--done"
        onClick={() => onMark("contacted")}
      >
        Contacted
      </button>
      <button
        type="button"
        className="complete__btn"
        onClick={() => onMark("skipped")}
      >
        Skip
      </button>
      <button
        type="button"
        className="complete__btn complete__btn--dead"
        onClick={() => onMark("dead_end")}
      >
        Dead end
      </button>
    </div>
  );
}
