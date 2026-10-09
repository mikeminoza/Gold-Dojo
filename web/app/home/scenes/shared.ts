import * as THREE from "three";

// The brand colours, matching the .landing tokens in landing.css
export const INK = "#0E1B2B";
export const LACQUER = "#16283D";
export const GOLD = "#D9A84E";
export const PALE_GOLD = "#F2D894";
export const MIST = "#8FA3BA";
export const VERMILION = "#B5402F";

/** 0..1 clamp, and the gentle ease-out used by every scroll-driven move. */
export const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** A small canvas turned into a texture: everything is drawn in code, so nothing is downloaded. */
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round blob: used for mist and glows. */
export function mistTexture() {
  const size = 128;
  return canvasTexture(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.45, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

/** A crisp round dot, so map points draw as circles instead of squares. */
export function dotTexture() {
  const size = 32;
  return canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Fine streaks along one direction, used as a roughness map: brushed metal catches the light
 * unevenly, which is most of what makes gold read as metal rather than plastic.
 */
export function brushedTexture() {
  const rand = seeded(11);
  const t = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = "rgb(150,150,150)";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 520; i++) {
        const v = 95 + Math.floor(rand() * 120);
        ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
        ctx.lineWidth = 0.5 + rand() * 1.4;
        const y = rand() * 256;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y + (rand() - 0.5) * 2);
        ctx.stroke();
      }
    },
    false,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The stamp on top of the gold bar, drawn twice: a height map (raised letters and rim, used as a
 * bump map) and a roughness map (the stamped parts slightly more satin than the polished field).
 */
export function ingotStampTextures() {
  const W = 1024;
  const H = 512;
  const draw = (ctx: CanvasRenderingContext2D, field: string, raised: string) => {
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = raised;
    ctx.fillStyle = raised;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.roundRect(70, 64, W - 140, H - 128, 36);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const font = "'Helvetica Neue', Arial, sans-serif";
    ctx.font = `700 64px ${font}`;
    ctx.fillText("GOLD DOJO", W / 2, 150);
    ctx.font = `700 140px ${font}`;
    ctx.fillText("999.9", W / 2, 262);
    ctx.font = `600 58px ${font}`;
    ctx.fillText("FINE GOLD", W / 2, 370);
  };
  const bump = canvasTexture(W, H, (ctx) => draw(ctx, "#000", "#fff"), false);
  const rough = canvasTexture(W, H, (ctx) => draw(ctx, "#5a5a5a", "#b4b4b4"), false);
  for (const t of [bump, rough]) {
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { bump, rough };
}

/** A small seeded random number generator, so every visitor sees the same candles. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
