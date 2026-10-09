"use client";

import dynamic from "next/dynamic";
import { Component, useRef, useState, type ReactNode } from "react";
import {
  useInView,
  usePageVisible,
  useReducedMotion,
  useScrollProgress,
  useSmallScreen,
  useWebGL,
} from "./landingHooks";

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

// How far through each section the reader is, from its box on screen (0..1)
const heroProgress = (r: DOMRect, vh: number) => -r.top / Math.max(r.height - vh, 1);
const storyProgress = (r: DOMRect, vh: number) => (vh * 0.4 - r.top) / Math.max(r.height - vh * 0.6, 1);
const globeProgress = (r: DOMRect, vh: number) => (vh - r.top) / (vh + r.height);

/**
 * The hero: a tall section with a sticky stage. Scrolling the first screen flies the camera through
 * the gate, and the headline (passed in as children) drifts up and fades via the --p variable.
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const { box, active, still, small, webgl } = useScene();
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress(section, heroProgress, {
    enabled: !still,
    onChange: (p) => stage.current?.style.setProperty("--p", p.toFixed(4)),
  });
  return (
    <section ref={section} className="landing-hero" aria-labelledby="hero-title">
      <div ref={stage} className="landing-hero-stage">
        <div ref={box} className="landing-hero-art" aria-hidden>
          {webgl === false ? (
            <StillIngot />
          ) : webgl === true ? (
            <SceneBoundary fallback={<StillIngot />}>
              <HeroScene progress={progress} active={active} still={still} small={small} />
            </SceneBoundary>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}

/** The globe beside the alerts: turns as the section scrolls past, and its routes light up. */
export function GlobeArt() {
  const { box, active, still, small, webgl } = useScene();
  const progress = useScrollProgress(box, globeProgress, { enabled: !still });
  return (
    <div ref={box} className="landing-globe" aria-hidden>
      {webgl === true && (
        <SceneBoundary fallback={<div className="landing-globe-still" />}>
          <GlobeScene progress={progress} active={active} still={still} small={small} />
        </SceneBoundary>
      )}
      {webgl === false && <div className="landing-globe-still" />}
    </div>
  );
}

const STEPS = [
  {
    title: "A day closes above the 100-day high.",
    body: "Gold spends months under a ceiling. The rule waits for a daily close above the highest price of the previous 100 days. A brief touch is not enough.",
  },
  {
    title: "Buy at the next open, with the stop 2 × ATR below.",
    body: "The paper trade opens at the next day's open. The stop sits two average daily ranges (ATR) under the entry, sized so 1% of the account is at risk.",
  },
  {
    title: "The stop trails up until a dip hits it.",
    body: "There is no profit target. As gold makes new highs the stop follows 2 × ATR beneath them and never moves down. A deep enough dip ends the trade.",
  },
];

// Where in the scroll each step takes over, matching the candle timing in CandleScene
const stepFor = (p: number) => (p < 0.36 ? 0 : p < 0.62 ? 1 : 2);

/** "How a breakout becomes a trade": the scroll position plays the candle scene and picks the step. */
export function BreakoutStory() {
  const { box, active, still, small, webgl } = useScene();
  const section = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  // the step only changes three times per pass, so this state update is rare
  const progress = useScrollProgress(section, storyProgress, { onChange: (p) => setStep(stepFor(p)) });

  return (
    <div ref={section} className="landing-story">
      <div className="landing-story-art">
        <div ref={box} className="landing-story-canvas" aria-hidden>
          {webgl === true && (
            <SceneBoundary fallback={null}>
              <CandleScene progress={progress} active={active} still={still} small={small} />
            </SceneBoundary>
          )}
        </div>
      </div>
      <ol className="landing-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="landing-step" data-active={still || i === step || undefined}>
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
