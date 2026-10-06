"use client";

import { useState, type ReactNode } from "react";

const KEY = "gold-folded";

function folded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * A sidebar card whose body can be folded away by clicking its title; the choice is remembered in
 * this browser.
 */
export default function Fold({
  id,
  title,
  extra,
  children,
}: {
  id: string;
  title: ReactNode;
  extra?: ReactNode; // small text next to the title, e.g. "PH time"
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? true : !folded().includes(id)));
  const toggle = () => {
    const now = !open;
    setOpen(now);
    try {
      const list = folded().filter((x) => x !== id);
      localStorage.setItem(KEY, JSON.stringify(now ? list : [...list, id]));
    } catch {
      // storage blocked: folding just isn't remembered
    }
  };
  return (
    <section className="side-block fold" data-open={open}>
      <h2>
        <button type="button" className="fold-head" aria-expanded={open} aria-controls={`fold-${id}`} onClick={toggle}>
          <span>
            {title} {extra && <span className="tz-note">{extra}</span>}
          </span>
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {open && (
        <div className="fold-body" id={`fold-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}
