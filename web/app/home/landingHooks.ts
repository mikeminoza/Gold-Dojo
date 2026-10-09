"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/** Subscribes to a media query; false on the server. */
function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

/** The visitor asked their system for less motion. */
export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/** Phone-sized screens get fewer particles and simpler shapes. */
export const useSmallScreen = () => useMedia("(max-width: 760px)");

/** False while the tab is in the background, so the 3D scenes stop drawing. */
export function usePageVisible() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

// Checked once per page load: making a test context is not free
let webgl: boolean | undefined;
function hasWebGL() {
  if (webgl === undefined) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** Whether this browser can draw WebGL; "unknown" on the server and before hydration. */
export function useWebGL(): boolean | "unknown" {
  return useSyncExternalStore<boolean | "unknown">(
    () => () => {},
    hasWebGL,
    () => "unknown",
  );
}

/** True while the element is on screen (or near it). */
export function useInView(ref: RefObject<Element | null>, margin = "120px") {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return inView;
}

/**
 * How far the page has scrolled through an element, as a ref (0..1) kept current without any React
 * state, so the 3D scenes can read it every frame. `measure` turns the element's box into progress;
 * `onChange` hears every new value (for cheap DOM updates). Off when `enabled` is false.
 */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  measure: (box: DOMRect, viewport: number) => number,
  { enabled = true, onChange }: { enabled?: boolean; onChange?: (p: number) => void } = {},
) {
  const progress = useRef(0);
  const listener = useRef(onChange);
  useEffect(() => {
    listener.current = onChange;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const p = Math.min(Math.max(measure(el.getBoundingClientRect(), innerHeight), 0), 1);
      progress.current = p;
      listener.current?.(p);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref, measure, enabled]);
  return progress;
}
