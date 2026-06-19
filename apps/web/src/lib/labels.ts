import type { AccessPath } from "../types";

export function formatPhone(phone: string): string {
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

/** "Reach 15 therapists" / "Reach 1 therapist". */
export function reachLabel(count: number): string {
  return `Reach ${count} therapist${count === 1 ? "" : "s"}`;
}

/**
 * A copy-ready outreach message that names the specific path, so it's worth
 * copying rather than a generic template. Shared-intake paths get the
 * organization version; a single therapist gets the individual version.
 */
export function outreachMessageFor(path: AccessPath): string {
  if (path.is_shared_intake) {
    return (
      `Hi, I’m looking for a therapist for my [age]-year-old and found your ` +
      `intake path through First Session. I saw that ${path.organization_display_name} ` +
      `has therapists listed for teens and Medicaid. Are any therapists ` +
      `accepting new clients on [specific Medicaid plan] within the next month? ` +
      `If not, is there a waitlist or someone you’d recommend?`
    );
  }
  return (
    `Hi, I’m looking for a therapist for my [age]-year-old and found your ` +
    `profile through First Session. Are you accepting new clients on ` +
    `[specific Medicaid plan] within the next month? If not, is there a ` +
    `waitlist or someone you’d recommend?`
  );
}

export interface PathAction {
  id: string;
  label: string;
  /** "copy" copies `value` to the clipboard; "link" opens `value` in a new tab. */
  type: "copy" | "link";
  value: string;
}

/**
 * The single most useful action for a path, by a fixed priority:
 * contact form → public email → website → Psychology Today → phone.
 * Returns null only if a path somehow has no channel at all.
 */
export function primaryAction(path: AccessPath): PathAction | null {
  const ch = path.contact_channels;
  if (ch.contact_form_url)
    return { id: "form", label: "Open contact form", type: "link", value: ch.contact_form_url };
  if (ch.email)
    return { id: "email", label: "Copy email address", type: "copy", value: ch.email };
  if (ch.website)
    return { id: "website", label: "Open website", type: "link", value: ch.website };
  if (ch.psychology_today_url)
    return { id: "pt", label: "Open Psychology Today", type: "link", value: ch.psychology_today_url };
  if (ch.phone)
    return { id: "phone", label: "Copy phone number", type: "copy", value: formatPhone(ch.phone) };
  return null;
}

/** The always-available secondary action: copy the path-specific outreach note. */
export function outreachAction(path: AccessPath): PathAction {
  return {
    id: "message",
    label: "Copy message",
    type: "copy",
    value: outreachMessageFor(path),
  };
}

/** Remaining real actions for "More actions" — every channel except the one
 *  already used as the primary action. */
export function moreActions(path: AccessPath): PathAction[] {
  const ch = path.contact_channels;
  const pid = primaryAction(path)?.id;
  const out: PathAction[] = [];
  if (ch.contact_form_url && pid !== "form")
    out.push({ id: "form", label: "Open contact form", type: "link", value: ch.contact_form_url });
  if (ch.email && pid !== "email")
    out.push({ id: "email", label: "Copy email address", type: "copy", value: ch.email });
  if (ch.website && pid !== "website")
    out.push({ id: "website", label: "Open website", type: "link", value: ch.website });
  if (ch.psychology_today_url && pid !== "pt")
    out.push({ id: "pt", label: "Open Psychology Today", type: "link", value: ch.psychology_today_url });
  if (ch.phone && pid !== "phone")
    out.push({ id: "phone", label: "Copy phone number", type: "copy", value: formatPhone(ch.phone) });
  return out;
}

/** A one-line availability hint from the primary channel, e.g. "Public email". */
export function channelHint(path: AccessPath): string {
  switch (primaryAction(path)?.id) {
    case "form":
      return "Contact form available";
    case "email":
      return "Public email available";
    case "website":
      return "Website available";
    case "pt":
      return "Psychology Today only";
    case "phone":
      return "Phone only";
    default:
      return "";
  }
}

/**
 * 2–3 short, factual "why start here" bullets generated from the path's own
 * data — never a generic summary. Reach and leverage for shared paths; an
 * honest framing for individual therapists.
 */
export function recommendationReasons(
  path: AccessPath,
  isLargest: boolean,
): string[] {
  const ch = path.contact_channels;

  if (path.therapist_count < 2) {
    const hasContact =
      ch.email || ch.contact_form_url || ch.website || ch.phone || ch.psychology_today_url;
    return [
      hasContact
        ? "Individual therapist with public contact information."
        : "Individual therapist.",
      "No shared intake path available.",
    ];
  }

  const out: string[] = [`One outreach may reach ${path.therapist_count} therapists.`];

  if (ch.email) out.push("Public email available.");
  else if (ch.contact_form_url) out.push("Contact form available.");
  else if (ch.website) out.push("Website available.");
  else if (ch.psychology_today_url) out.push("Psychology Today profile available.");
  else if (ch.phone) out.push("Phone number available.");

  if (isLargest) out.push("Largest shared intake path in this dataset.");
  else if (out.length < 2) out.push("One outreach reaches multiple therapists.");

  return out.slice(0, 3);
}
