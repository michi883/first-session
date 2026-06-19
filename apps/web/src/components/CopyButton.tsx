import { useEffect, useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  /** Confirmation shown for ~2s after copying, e.g. "✓ Email address copied". */
  copiedLabel?: string;
  className?: string;
  /** Fired after a successful copy (used for analytics). */
  onCopy?: () => void;
}

/** Copies `text` to the clipboard with brief, specific confirmation feedback. */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "✓ Copied",
  className,
  onCopy,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // Reset feedback if the text changes underneath us (e.g. the active path
  // advanced) so a stale "Copied ✓" never sits on a different value.
  useEffect(() => {
    setCopied(false);
  }, [text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.();
    } catch {
      // Clipboard API can be blocked (e.g. insecure context); fail quietly.
    }
  }

  return (
    <button
      type="button"
      className={`copy-btn${className ? ` ${className}` : ""}${
        copied ? " copy-btn--done" : ""
      }`}
      onClick={copy}
      aria-live="polite"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
