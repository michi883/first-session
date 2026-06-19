import { useState } from "react";

/**
 * Lightweight, collapsible "What is this?" panel that sits right under the hero.
 * Not an About page — four plain sentences that frame the product before the
 * parent acts, and stay out of the way once they get it.
 */
export function WhatIsThis() {
  const [open, setOpen] = useState(false);

  return (
    <section className="whatis">
      <button
        type="button"
        className="whatis__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="whatis__icon" aria-hidden="true">
          ?
        </span>
        <span className="whatis__q">What is this?</span>
        <span className="whatis__cue">{open ? "Hide" : "Read"}</span>
      </button>

      {open && (
        <div className="whatis__body">
          <p>
            First Session groups NYC Medicaid teen therapist profiles by{" "}
            <strong>contact path</strong>. One intake organization may represent
            several therapists, so one outreach attempt can reach multiple
            possible options.
          </p>
          <p>
            This is not a ranking, recommendation engine, or live availability
            marketplace. It helps parents try the highest-leverage contact paths
            first and move on faster when a path is a dead end.
          </p>
        </div>
      )}
    </section>
  );
}
