/** Chart indicators, computed in the browser from candles so they work on every timeframe. */
import type { Candle } from "./types";

export type Point = { t: number; value: number };

export function ema(candles: Candle[], period: number): Point[] {
  const k = 2 / (period + 1);
  let prev: number | null = null;
  return candles.map((c) => {
    prev = prev === null ? c.c : c.c * k + prev * (1 - k);
    return { t: c.t, value: prev };
  });
}

export function sma(candles: Candle[], period: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ t: c.t, value: sum / period });
  });
  return out;
}

/** Bollinger Bands: middle = SMA, upper/lower = +/- `width` standard deviations. */
export function bollinger(candles: Candle[], period = 20, width = 2) {
  const upper: Point[] = [];
  const middle: Point[] = [];
  const lower: Point[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1).map((c) => c.c);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    const t = candles[i].t;
    upper.push({ t, value: mean + width * sd });
    middle.push({ t, value: mean });
    lower.push({ t, value: mean - width * sd });
  }
  return { upper, middle, lower };
}

/** Wilder's RSI, same as MetaTrader's. */
export function rsi(candles: Candle[], period = 14): Point[] {
  const out: Point[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].c - candles[i - 1].c;
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
      if (i < period) continue;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    out.push({ t: candles[i].t, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
  }
  return out;
}
