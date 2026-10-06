"use client";

import { useEffect, useState } from "react";

const KEY = "gold-tour-done";
export const TOUR_EVENT = "gold-tour"; // window event that restarts the tour (from the profile menu)

const STEPS: { target: string; title: string; text: string }[] = [
  {
    target: ".signal-card",
    title: "The signal",
    text: "Buy, Sell or Wait for gold, with the entry, stop and target when a trade is open, and when the next New York session starts.",
  },
  {
    target: ".chart-panel",
    title: "The live chart",
    text: "Real XAUUSD prices, updated as they move. Switch timeframes on top; on D1 you'll also see the Daily trend lines.",
  },
  {
    target: ".side-tabs",
    title: "Trades, Daily trend and tools",
    text: "Past signals and your results, the long-only Daily trend test, price alerts and the lot size calculator.",
  },
  {
    target: ".profile-trigger",
    title: "Practice first",
    text: "These signals are for learning and demo trading. Set your account size on your profile so every lot size fits you.",
  },
];

/** A four-step welcome on the first visit; can be replayed from the profile menu. */
export default function Tour() {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // First visit: start after the page has drawn. Also start whenever the profile menu asks.
  useEffect(() => {
    let done = true;
    try {
      done = localStorage.getItem(KEY) === "1";
    } catch {
      // storage blocked: skip the automatic tour
    }
    const id = done ? undefined : setTimeout(() => setStep(0), 1200);
    const start = () => setStep(0);
    window.addEventListener(TOUR_EVENT, start);
    return () => {
      if (id) clearTimeout(id);
      window.removeEventListener(TOUR_EVENT, start);
    };
  }, []);

  // Follow the highlighted element (scrolls, resizes)
  useEffect(() => {
    if (step === null) return;
    const el = document.querySelector(STEPS[step].target);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    const id = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    const first = setTimeout(measure, 50);
    return () => {
      clearInterval(id);
      clearTimeout(first);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function finish() {
    setStep(null);
    setRect(null);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // not remembered
    }
  }

  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  // Popover below the target when there's room, otherwise above; kept on screen
  const w = Math.min(320, typeof window === "undefined" ? 320 : window.innerWidth - 24);
  const below = rect ? rect.bottom + 180 < window.innerHeight : true;
  const top = rect ? (below ? rect.bottom + 12 : Math.max(12, rect.top - 172)) : 80;
  const left = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - w - 12) : 12;

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {rect && (
        <div
          className="tour-ring"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
          aria-hidden
        />
      )}
      <div className="tour-pop" style={{ top, left, width: w }}>
        <p className="tour-step">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title">{s.title}</h2>
        <p>{s.text}</p>
        <div className="tour-actions">
          <button type="button" className="link-button" onClick={finish}>
            Skip
          </button>
          <span>
            {step > 0 && (
              <button type="button" className="journal-csv" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button type="button" className="account-save" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Done" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
