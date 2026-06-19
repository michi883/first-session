import type { AccessPath } from "../types";
import type { PathStatus } from "../lib/progress";
import { STATUS_LABELS, STATUS_TONE } from "../lib/progress";
import { channelHint, reachLabel } from "../lib/labels";
import { ActionRow } from "./ActionRow";
import { CompletionButtons } from "./CompletionButtons";

interface BrowseItemProps {
  path: AccessPath;
  status: PathStatus;
  open: boolean;
  onToggle: () => void;
  onMark: (status: PathStatus) => void;
}

/**
 * A directory row inside Browse all. Expands inline (no scroll jump) to the
 * same real action set as the recommendation. Solo paths are never headlined
 * "Reach 1 therapist" — that would weaken the shared-intake insight.
 */
export function BrowseItem({ path, status, open, onToggle, onMark }: BrowseItemProps) {
  const hint = channelHint(path);
  const lead =
    path.therapist_count >= 2 ? reachLabel(path.therapist_count) : "Individual therapist";

  return (
    <li className={`bitem${open ? " bitem--open" : ""}`}>
      <button
        type="button"
        className="bitem__head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="bitem__text">
          <span className="bitem__name">{path.organization_display_name}</span>
          <span className="bitem__sub">
            {lead}
            {hint ? ` · ${hint}` : ""}
          </span>
        </span>
        {status !== "none" && (
          <span className={`pstatus pstatus--${STATUS_TONE[status]}`}>
            {STATUS_LABELS[status]}
          </span>
        )}
        <span className="bitem__chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="bitem__body">
          <ActionRow path={path} source="browse" />
          <CompletionButtons onMark={onMark} />
        </div>
      )}
    </li>
  );
}
