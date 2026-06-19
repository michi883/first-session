import { useState } from "react";
import type { AccessPath } from "../types";
import type { PathAction } from "../lib/labels";
import { moreActions, outreachAction, primaryAction } from "../lib/labels";
import type { EventSource } from "../lib/pendo";
import { TRACK_EVENTS, pathProps, trackEvent } from "../lib/pendo";
import { CopyButton } from "./CopyButton";

/** Specific copy confirmations, keyed by action id. */
const COPIED_LABELS: Record<string, string> = {
  email: "✓ Email address copied",
  message: "✓ Message copied",
  phone: "✓ Phone number copied",
};

/** Render one PathAction as the right control: copy button or external link. */
function ActionControl({
  action,
  primary,
  onActivate,
}: {
  action: PathAction;
  primary?: boolean;
  /** Called when the action is actually taken (copied, or link opened). */
  onActivate: (action: PathAction) => void;
}) {
  if (action.type === "copy") {
    return (
      <CopyButton
        text={action.value}
        label={action.label}
        copiedLabel={COPIED_LABELS[action.id] ?? "✓ Copied"}
        className={primary ? "copy-btn--primary" : ""}
        onCopy={() => onActivate(action)}
      />
    );
  }
  return (
    <a
      className={`cta${primary ? " cta--primary" : ""}`}
      href={action.value}
      target="_blank"
      rel="noreferrer"
      onClick={() => onActivate(action)}
    >
      {action.label}
    </a>
  );
}

/**
 * The real, working actions for a path: one primary action, the path-specific
 * outreach message as the secondary, and every other channel tucked under
 * "More actions". Nothing here is a placeholder — each control copies a value
 * or opens a real URL in a new tab. No mailto.
 */
export function ActionRow({
  path,
  source = "recommendation",
}: {
  path: AccessPath;
  /** Which surface this action row is rendered on, for funnel separation. */
  source?: EventSource;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = primaryAction(path);
  const more = moreActions(path);

  /** A "copy" action is a copied contact; everything else opens a real URL. */
  function onActivate(action: PathAction): void {
    const event =
      action.type === "copy"
        ? TRACK_EVENTS.CONTACT_PATH_COPIED
        : TRACK_EVENTS.CONTACT_PATH_INITIATED;
    trackEvent(event, {
      ...pathProps(path),
      source,
      action_id: action.id,
      action_label: action.label,
    });
  }

  return (
    <div className="actions">
      {primary ? (
        <div className="actions__primary">
          <ActionControl action={primary} primary onActivate={onActivate} />
        </div>
      ) : (
        <p className="actions__none">No public contact channel found.</p>
      )}

      <div className="actions__secondary">
        <ActionControl action={outreachAction(path)} onActivate={onActivate} />
      </div>

      {more.length > 0 && (
        <div className="actions__more">
          <button
            type="button"
            className="actions__morebtn"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            More actions {moreOpen ? "▾" : "▸"}
          </button>
          {moreOpen && (
            <div className="actions__morelist">
              {more.map((a) => (
                <ActionControl key={a.id} action={a} onActivate={onActivate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
