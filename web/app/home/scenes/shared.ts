import * as THREE from "three";

// The brand colours, matching the .landing tokens in landing.css
export const INK = "#0E1B2B";
export const LACQUER = "#16283D";
export const GOLD = "#D9A84E";
export const PALE_GOLD = "#F2D894";
export const MIST = "#8FA3BA";
export const VERMILION = "#B5402F";

/** A soft round blob drawn on a small canvas: used for mist and glows, so nothing is downloaded. */
export function mistTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.45, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A small seeded random number generator, so every visitor sees the same candles. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
