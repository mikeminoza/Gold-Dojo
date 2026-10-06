"use client";

import { useRef, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";

/**
 * Lets a floating button be dragged anywhere on screen; on release it snaps to the nearer side and the
 * spot is remembered in this browser. A short press still works as a click.
 */
type Spot = { x: number; y: number }; // px from the left / top of the window
const MARGIN = 16;
const listeners = new Set<() => void>();
const cache: Record<string, { raw: string | null; spot: Spot | null }> = {};

function read(key: string): Spot | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return cache[key]?.spot ?? null;
  }
  if (cache[key]?.raw !== raw) {
    let spot: Spot | null = null;
    try {
      const v = raw ? JSON.parse(raw) : null;
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) spot = { x: v.x, y: v.y };
    } catch {
      spot = null;
    }
    cache[key] = { raw, spot };
  }
  return cache[key].spot;
}

function write(key: string, spot: Spot | null) {
  try {
    if (spot) localStorage.setItem(key, JSON.stringify(spot));
    else localStorage.removeItem(key);
  } catch {
    cache[key] = { raw: spot ? JSON.stringify(spot) : null, spot };
  }
  listeners.forEach((l) => l());
}

/**
 * Where to put a panel that belongs to the button (the chat box, its pop-ups): on the button's side of
 * the screen, above it when the button is low and below it when it's high. Null = the default spot
 * (also on phones, where the chat fills the screen).
 */
export function anchorNear(spot: Spot | null, size: number, gap = 12): CSSProperties | undefined {
  if (!spot || typeof window === "undefined" || window.innerWidth <= 520) return undefined;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const left = spot.x + size / 2 < w / 2;
  const low = spot.y + size / 2 > h / 2;
  return {
    left: left ? spot.x : "auto",
    right: left ? "auto" : w - spot.x - size,
    top: low ? "auto" : spot.y + size + gap,
    bottom: low ? h - spot.y + gap : "auto",
    maxHeight: low ? spot.y - gap - MARGIN : h - (spot.y + size + gap) - MARGIN,
  };
}

export function useDraggable(key: string, size: number) {
  const spot = useSyncExternalStore(
    (on) => {
      listeners.add(on);
      window.addEventListener("resize", on);
      return () => {
        listeners.delete(on);
        window.removeEventListener("resize", on);
      };
    },
    () => read(key),
    () => null,
  );
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const clamp = (x: number, y: number): Spot => ({
    x: Math.min(Math.max(x, MARGIN), window.innerWidth - size - MARGIN),
    y: Math.min(Math.max(y, MARGIN), window.innerHeight - size - MARGIN),
  });

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    d.moved = true;
    const p = clamp(e.clientX - d.dx, e.clientY - d.dy);
    const el = e.currentTarget;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.dataset.dragging = "true";
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    justDragged.current = true; // the click that follows the release isn't a tap
    delete e.currentTarget.dataset.dragging;
    const box = e.currentTarget.getBoundingClientRect();
    const toLeft = box.left + size / 2 < window.innerWidth / 2;
    write(key, clamp(toLeft ? MARGIN : window.innerWidth, box.top));
  };

  /** Wrap the button's onClick: ignores the click that ends a drag. */
  const guardClick = (handler: () => void) => () => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    handler();
  };

  const style =
    spot && typeof window !== "undefined"
      ? { ...clamp(spot.x, spot.y), right: "auto", bottom: "auto" }
      : undefined;
  return {
    spot: style ? { x: style.x, y: style.y } : null, // where the button is (null = its default corner)
    style: style && { left: style.x, top: style.y, right: style.right, bottom: style.bottom },
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    guardClick,
    reset: () => write(key, null),
  };
}
