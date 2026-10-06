"use client";

import { useEffect, useState } from "react";
import { fetchCandles } from "../lib/market";
import type { Candle, SignalEvent } from "../lib/types";

const STEP = 300; // 5-minute candles
const PAD = 12; // candles shown before the entry and after the exit
const cache = new Map<string, Candle[]>();

/**
 * A small chart of one trade: price from a little before the entry to a little after the exit, with
 * the entry, stop and target lines. Loaded only when a trade card is opened.
 */
export default function TradeSpark({
  open,
  close,
  gap,
}: {
  open: SignalEvent;
  close?: SignalEvent;
  gap: number; // PAXG-above-spot shift, so candles line up with the signal's prices
}) {
  const key = `${open.id}|${close?.id ?? "open"}`;
  const [candles, setCandles] = useState<Candle[] | null>(() => cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  const closeTime = close?.time ?? null;
  useEffect(() => {
    if (cache.has(key)) return;
    let stopped = false;
    const end = (closeTime ?? Date.now() / 1000) + PAD * STEP;
    const count = Math.min(Math.ceil((end - open.time) / STEP) + PAD, 900);
    fetchCandles("M5", count, gap, Math.min(end, Date.now() / 1000 + STEP))
      .then((list) => {
        if (stopped) return;
        if (closeTime !== null) cache.set(key, list); // a finished trade's chart never changes
        setCandles(list);
      })
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
    };
  }, [key, open.time, closeTime, gap]);

  if (failed) return null;
  if (!candles || candles.length < 3 || open.sl == null || open.tp == null) {
    return <div className="spark spark-loading" aria-hidden />;
  }

  const W = 300;
  const H = 90;
  const levels = [open.sl, open.tp, open.price, ...candles.flatMap((k) => [k.h, k.l])];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const t0 = candles[0].t;
  const t1 = candles[candles.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(t1 - t0, 1)) * W;
  const y = (p: number) => H - 4 - ((p - lo) / Math.max(hi - lo, 0.01)) * (H - 8);
  const path = candles.map((k, i) => `${i ? "L" : "M"}${x(k.t).toFixed(1)},${y(k.c).toFixed(1)}`).join("");
  const line = (p: number, cls: string) => (
    <line className={cls} x1="0" x2={W} y1={y(p)} y2={y(p)} vectorEffect="non-scaling-stroke" />
  );
  const won = close ? (close.pnl ?? 0) >= 0 : null;

  return (
    <figure className="spark" data-won={won ?? undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price during the trade">
        {line(open.tp, "spark-tp")}
        {line(open.sl, "spark-sl")}
        {line(open.price, "spark-entry")}
        <rect className="spark-span" x={x(open.time)} width={Math.max(x(close?.time ?? t1) - x(open.time), 1)} y="0" height={H} />
        <path d={path} className="spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span className="spark-key spark-key-tp">Target</span>
        <span className="spark-key spark-key-entry">Entry</span>
        <span className="spark-key spark-key-sl">Stop</span>
      </figcaption>
    </figure>
  );
}
