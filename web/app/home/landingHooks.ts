"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

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
