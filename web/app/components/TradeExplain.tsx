"use client";

import { useEffect, useState } from "react";
import { TF_SECONDS, fetchCandles } from "../lib/market";
import type { Candle } from "../lib/types";

/** One trend trade to explain: a closed one, or the open position (no exit yet). */
export type ExplainTrade = {
  rule: string; // rule id: "breakout", "pullback", "h4breakout"
  entry: number;
  opened: number;
  sl?: number; // the starting stop
  trigger?: number | null;
  best?: number;
  // closed trades
  exit?: number;
  closed?: number;
  reason?: string;
  r?: number;
  // the open position
  stop?: number; // the trailing stop now
  rNow?: number;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtR = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;

// Candles shown before the entry and after the exit
const BEFORE = { D1: 20, H4: 30 } as const;
const AFTER = { D1: 5, H4: 8 } as const;

/** The plain-words story of a trade, from the rule and the levels the bot saved. */
function story(t: ExplainTrade, best: number | undefined) {
  const at = t.trigger != null ? ` (${money(t.trigger)})` : "";
  const why =
    t.rule === "pullback"
      ? `after gold dipped to its 20-day average${at} and closed back above it`
      : t.rule === "h4breakout"
        ? `after a 4-hour candle closed above the highest price of the previous 100 four-hour candles${at}`
        : t.rule === "breakout"
          ? `after gold closed above its 100-day high${at}`
          : "after the rule's signal";
  const lines = [`Bought at ${money(t.entry)}, the next open ${why}.`];

  const open = t.exit == null;
  // How far the stop trailed: the open trade's stop now, or a trailing stop's exit price
  const trailedTo = open ? t.stop : t.reason?.toLowerCase().startsWith("trailing") ? t.exit : undefined;
  const rose = best != null ? ` as gold rose to ${money(best)}` : "";
  if (t.sl != null) {
    if (trailedTo != null && trailedTo > t.sl) {
      lines.push(`The stop started at ${money(t.sl)} and ${open ? "has trailed" : "trailed"} up to ${money(trailedTo)}${rose}.`);
    } else {
      lines.push(`The stop started at ${money(t.sl)}${best != null ? `; the highest gold reached was ${money(best)}` : ""}.`);
    }
  } else if (best != null) {
    lines.push(`The highest gold reached while it was held was ${money(best)}.`);
  }

  if (!open) lines.push(`Closed at ${money(t.exit!)} (${(t.reason ?? "closed").toLowerCase()}): ${fmtR(t.r ?? 0)}.`);
  else lines.push(`Still open${t.rNow != null ? `: ${fmtR(t.rNow)} now` : ""}${t.stop != null ? `, stop at ${money(t.stop)}` : ""}.`);
  return lines.join(" ");
}

type Loaded = { candles: Candle[] } | { failed: true } | null;

/**
 * Price candles around a trade (Binance PAXG, the chart's source), shifted so the entry candle's open
 * sits on the trade's entry price; null while loading, failed when Binance can't be reached.
 */
function useTradeCandles(tf: "D1" | "H4", opened: number, closed: number | undefined): Loaded {
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let stopped = false;
    const step = TF_SECONDS[tf];
    const from = opened - BEFORE[tf] * step;
    const end = closed != null ? closed + AFTER[tf] * step : undefined;
    const until = end ?? Date.now() / 1000;
    const count = Math.min(1000, Math.ceil((until - from) / step) + 2);
    const before = end != null && end < Date.now() / 1000 ? end : undefined;
    fetchCandles(tf, count, 0, before)
      .then((all) => {
        if (!stopped) setLoaded({ candles: all.filter((k) => k.t >= from) });
      })
      .catch(() => {
        if (!stopped) setLoaded({ failed: true });
      });
    return () => {
      stopped = true;
    };
  }, [tf, opened, closed]);
  return loaded;
}

type Level = { key: string; label: string; price: number };

const W = 640;
const H = 220;
const PAD = { top: 10, right: 78, bottom: 10, left: 6 };

/** Candles plus the trade's levels as horizontal lines, in an SVG that scales to its box. */
function TradeChart({ candles, levels, opened, closed }: { candles: Candle[]; levels: Level[]; opened: number; closed?: number }) {
  const prices = [...candles.flatMap((k) => [k.h, k.l]), ...levels.map((l) => l.price)];
  const hi = Math.max(...prices);
  const lo = Math.min(...prices);
  const span = hi - lo || 1;
  const y = (p: number) => PAD.top + ((hi - p) / span) * (H - PAD.top - PAD.bottom);
  const n = Math.max(candles.length, 1);
  const slot = (W - PAD.left - PAD.right) / n;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  // Candle index at or before a time
  const at = (t: number) => {
    let hit = -1;
    for (let i = 0; i < candles.length && candles[i].t <= t; i++) hit = i;
    return hit;
  };
  const inAt = at(opened);
  const outAt = closed != null ? at(closed) : -1;
  // Nudge labels apart so close levels don't print on top of each other
  const placed: { key: string; y: number }[] = [];
  for (const l of [...levels].sort((a, b) => b.price - a.price)) {
    let ly = y(l.price);
    const prev = placed[placed.length - 1];
    if (prev && ly - prev.y < 12) ly = prev.y + 12;
    placed.push({ key: l.key, y: Math.min(ly, H - 2) });
  }
  const labelY = new Map(placed.map((p) => [p.key, p.y]));

  return (
    <svg className="explain-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price around the trade, with its levels">
      {inAt >= 0 && <rect className="explain-held" x={x(inAt) - slot / 2} y={0} width={((outAt >= 0 ? outAt : n - 1) - inAt + 1) * slot} height={H} />}
      {candles.map((k, i) => {
        const up = k.c >= k.o;
        const top = y(Math.max(k.o, k.c));
        return (
          <g key={k.t} className={up ? "explain-up" : "explain-down"}>
            <line x1={x(i)} x2={x(i)} y1={y(k.h)} y2={y(k.l)} />
            <rect x={x(i) - slot * 0.32} y={top} width={Math.max(1, slot * 0.64)} height={Math.max(1, y(Math.min(k.o, k.c)) - top)} />
          </g>
        );
      })}
      {levels.map((l) => (
        <g key={l.key} className={`explain-level explain-${l.key}`}>
          <line x1={PAD.left} x2={W - PAD.right + 4} y1={y(l.price)} y2={y(l.price)} />
          <text x={W - PAD.right + 8} y={(labelY.get(l.key) ?? y(l.price)) + 4}>
            {l.label} {Math.round(l.price)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** The "Explain" panel for one trade: a mini chart of price around it and what happened, in words. */
export default function TradeExplain({ trade }: { trade: ExplainTrade }) {
  const tf = trade.rule === "h4breakout" ? "H4" : "D1";
  const loaded = useTradeCandles(tf, trade.opened, trade.closed);
  const raw = loaded && "candles" in loaded ? loaded.candles : null;

  // Line PAXG up with the broker's price: the entry candle's open should equal the entry
  let candles: Candle[] | null = null;
  if (raw && raw.length) {
    const entryCandle = raw.filter((k) => k.t <= trade.opened).pop();
    const shift = entryCandle ? entryCandle.o - trade.entry : 0;
    const ok = Math.abs(shift) < trade.entry * 0.03 ? shift : 0;
    candles = raw.map((k) => ({ ...k, o: k.o - ok, h: k.h - ok, l: k.l - ok, c: k.c - ok }));
  }

  // The open trade has no saved best price yet: take the highest candle since the entry
  const held = candles?.filter((k) => k.t >= trade.opened && (trade.closed == null || k.t <= trade.closed));
  const best = trade.best ?? (trade.exit == null && held?.length ? Math.max(...held.map((k) => k.h)) : undefined);

  const levels: Level[] = [
    trade.trigger != null && { key: "trigger", label: "Trigger", price: trade.trigger },
    { key: "entry", label: "Entry", price: trade.entry },
    trade.sl != null && { key: "sl", label: "Stop", price: trade.sl },
    trade.exit != null && { key: "exit", label: "Exit", price: trade.exit },
    trade.exit == null && trade.stop != null && trade.stop !== trade.sl && { key: "exit", label: "Stop now", price: trade.stop },
    best != null && { key: "best", label: "Best", price: best },
  ].filter((l): l is Level => Boolean(l));

  return (
    <div className="explain">
      {candles && candles.length ? (
        <TradeChart candles={candles} levels={levels} opened={trade.opened} closed={trade.closed} />
      ) : loaded === null ? (
        <p className="explain-wait">Loading the price…</p>
      ) : (
        <>
          <TradeChart candles={[]} levels={levels} opened={trade.opened} closed={trade.closed} />
          <p className="explain-wait">Couldn&apos;t load the candles right now; the levels are still shown.</p>
        </>
      )}
      <p className="explain-story">{story(trade, best)}</p>
    </div>
  );
}
