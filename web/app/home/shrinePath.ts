/**
 * The shrine walk's timeline, shared by the 3D scene (where the camera is) and the page (which panel
 * shows). No three.js in here, so the page can use it without loading the 3D code.
 *
 * Scroll progress 0..1 is split into six equal stretches: the opening view (stop 0), one stop just
 * past each of the five gates (stops 1 to 5), and the walk out into the light at the end (6).
 */
export const SEGMENTS = 6;

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
const smooth = (t: number) => t * t * (3 - 2 * t);

// The share of each stretch spent standing still at either end, so the walk pauses at every stop
const HOLD = 0.2;

/** Where along the path the walker is, in stops (0..6): it lingers at each stop, then walks on. */
export function walkAt(p: number) {
  const x = clamp01(p) * SEGMENTS;
  const seg = Math.min(Math.floor(x), SEGMENTS - 1);
  return seg + smooth(clamp01((x - seg - HOLD) / (1 - 2 * HOLD)));
}

/**
 * How visible stop k's words are (0..1), and how far the reader is from that stop in stretches
 * (negative before it). The opening words leave as the walk begins; the others arrive just after
 * their gate is passed and leave well before the next one.
 */
export function stopLook(k: number, p: number) {
  const d = clamp01(p) * SEGMENTS - k;
  if (k === 0) return { opacity: 1 - clamp01((d - 0.1) / 0.2), d };
  const fadeIn = clamp01((d + 0.34) / 0.14);
  const fadeOut = k === SEGMENTS - 1 ? clamp01((d - 0.32) / 0.2) : clamp01((d - 0.22) / 0.14);
  return { opacity: fadeIn * (1 - fadeOut), d };
}

/** The night closing in over the stage at the very end, so it hands over to the next section. */
export const exitVeil = (p: number) => clamp01((clamp01(p) * SEGMENTS - 5.72) / 0.24);
