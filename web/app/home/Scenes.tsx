"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useInView, usePageVisible, useReducedMotion, useSmallScreen, useWebGL } from "./landingHooks";

// three.js only loads on this page, in the browser, after the text is already on screen
const HeroScene = dynamic(() => import("./scenes/HeroScene"), { ssr: false });
const CandleScene = dynamic(() => import("./scenes/CandleScene"), { ssr: false });
const GlobeScene = dynamic(() => import("./scenes/GlobeScene"), { ssr: false });

/** If a scene fails to start (lost or blocked WebGL), show the still picture instead of a broken page. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The still picture used without WebGL: a gold bar drawn with CSS. */
function StillIngot() {
  return (
    <div className="landing-still" aria-hidden>
      <span className="landing-still-ingot" />
    </div>
  );
}

/** Shared by the three scenes: draws only while on screen, in a visible tab, with WebGL. */
function useScene() {
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box);
  const visible = usePageVisible();
  const still = useReducedMotion();
  const small = useSmallScreen();
  const webgl = useWebGL();
  return { box, active: inView && visible, still, small, webgl };
}

export function HeroArt() {
  const { box, active, still, small, webgl } = useScene();
  return (
    <div ref={box} className="landing-hero-art" aria-hidden>
      {webgl === false ? (
        <StillIngot />
      ) : webgl === true ? (
        <SceneBoundary fallback={<StillIngot />}>
          <HeroScene active={active} still={still} small={small} />
        </SceneBoundary>
      ) : null}
    </div>
  );
}

export function GlobeArt() {
  const { box, active, still, small, webgl } = useScene();
  return (
    <div ref={box} className="landing-globe" aria-hidden>
      {webgl === true && (
        <SceneBoundary fallback={<div className="landing-globe-still" />}>
          <GlobeScene active={active} still={still} small={small} />
        </SceneBoundary>
      )}
      {webgl === false && <div className="landing-globe-still" />}
    </div>
  );
}

const STEPS = [
  {
    title: "A day closes above the 100-day high.",
    body: "Gold has spent months under a ceiling. The rule waits for a daily close above the highest price of the previous 100 days, not just a touch.",
  },
  {
    title: "Buy at the next open, stop 2 × ATR below.",
    body: "The paper trade starts at the next day's open. The stop sits two average daily ranges (ATR) under the entry, so 1% of the account is at risk.",
  },
  {
    title: "The stop trails up under the highest price; the trade ends when it's hit.",
    body: "There is no profit target. As gold makes new highs the stop follows 2 × ATR beneath them and never moves down. A deep enough dip closes the trade.",
  },
];

// Where in the scroll each step takes over, matching the candle timing in CandleScene
const stepFor = (p: number) => (p < 0.36 ? 0 : p < 0.62 ? 1 : 2);

/** "How a breakout becomes a trade": the scroll position plays the candle scene and picks the step. */
export function BreakoutStory() {
  const { box, active, still, small, webgl } = useScene();
  const section = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const run = Math.max(r.height - innerHeight * 0.6, 1);
      const p = Math.min(Math.max((innerHeight * 0.4 - r.top) / run, 0), 1);
      progress.current = p;
      setStep(stepFor(p));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={section} className="landing-story">
      <div ref={box} className="landing-story-art" aria-hidden>
        {webgl === true && (
          <SceneBoundary fallback={null}>
            <CandleScene progress={progress} active={active} still={still} small={small} />
          </SceneBoundary>
        )}
      </div>
      <ol className="landing-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="landing-step" data-active={i === step || undefined}>
            <span className="landing-step-n" aria-hidden>
              {i + 1}
            </span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
