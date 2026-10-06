"use client";

import { useEffect, useRef, useState } from "react";
import { BINANCE, goldMarketOpen, PAXG } from "./market";

/**
 * Live XAUUSD price in the browser, several times a second:
 * - Binance's live stream for PAXG (a gold-backed token) gives the tick-by-tick movement,
 * - Swissquote's real XAUUSD spot quote (via /api/spot every 15 s) gives the true level and spread.
 * Price shown = PAXG - measured gap, so it moves live and sits on the real spot price.
 * When gold's market is closed (weekends) the last spot quote is shown as-is.
 */
export type LivePrice = {
  bid: number;
  ask: number;
  time: number; // UTC seconds
  gap: number; // how far PAXG is above spot; the chart candles are shifted by this
  gapReady: boolean; // the gap has been measured (or remembered), so candles can be shifted
  live: boolean; // the live stream is connected
};

const GAP_KEY = "gold-paxg-gap"; // last measured gap, for weekends when it can't be measured

function savedGap(): number | null {
  try {
    const v = Number(localStorage.getItem(GAP_KEY));
    return Number.isFinite(v) && v !== 0 ? v : null;
  } catch {
    return null;
  }
}

const STREAM = `wss://data-stream.binance.vision/ws/${PAXG.toLowerCase()}@bookTicker`;
const SPOT_EVERY_MS = 10_000; // real XAUUSD level and spread (shared via Vercel's 5 s cache)
const UI_EVERY_MS = 250; // at most 4 screen updates a second
const GAP_SMOOTHING = 0.2;
const GAP_STEP = 0.25; // only move the chart's shift when the gap drifts this far

export function useLivePrice(): LivePrice | null {
  const [price, setPrice] = useState<LivePrice | null>(null);
  const paxg = useRef<{ mid: number; at: number } | null>(null);
  const spot = useRef<{ bid: number; ask: number; at: number } | null>(null);
  const gap = useRef<{ measured: number | null; applied: number; ready: boolean }>({
    measured: null,
    applied: 0,
    ready: false,
  });
  const connected = useRef(false);

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    const remembered = savedGap();
    if (remembered !== null) gap.current = { measured: null, applied: remembered, ready: true };
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      ws = new WebSocket(STREAM);
      ws.onopen = () => (connected.current = true);
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data as string);
        paxg.current = { mid: (Number(d.b) + Number(d.a)) / 2, at: Date.now() / 1000 };
      };
      ws.onclose = () => {
        connected.current = false;
        if (!stopped) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };

    // The live stream only sends when PAXG's price changes, which can take a while in quiet markets,
    // so read the current price directly whenever there isn't one yet
    const loadPaxg = async () => {
      try {
        const res = await fetch(`${BINANCE}/api/v3/ticker/bookTicker?symbol=${PAXG}`, { cache: "no-store" });
        const d = await res.json();
        if (!paxg.current) paxg.current = { mid: (Number(d.bidPrice) + Number(d.askPrice)) / 2, at: Date.now() / 1000 };
      } catch {
        // the live stream will fill it in
      }
    };

    const loadSpot = async () => {
      if (!paxg.current) await loadPaxg();
      try {
        const res = await fetch("/api/spot", { cache: "no-store" });
        if (!res.ok) return;
        const q = await res.json();
        spot.current = { bid: q.bid, ask: q.ask, at: Date.now() / 1000 };
        const p = paxg.current;
        if (p && goldMarketOpen(Date.now() / 1000)) {
          const measured = p.mid - (q.bid + q.ask) / 2;
          const g = gap.current;
          g.measured = g.measured === null ? measured : g.measured + GAP_SMOOTHING * (measured - g.measured);
          if (!g.ready || Math.abs(g.measured - g.applied) >= GAP_STEP) {
            g.applied = Math.round(g.measured * 100) / 100;
            g.ready = true;
            try {
              localStorage.setItem(GAP_KEY, String(g.applied));
            } catch {
              // storage unavailable - it'll just be measured again next time
            }
          }
        }
      } catch {
        // keep the last quote; the next attempt comes in 15 s
      }
    };

    const render = () => {
      const s = spot.current;
      const p = paxg.current;
      const now = Date.now() / 1000;
      if (!s) return;
      const half = (s.ask - s.bid) / 2;
      const g = gap.current;
      if (p && g.measured !== null && goldMarketOpen(now)) {
        const mid = p.mid - g.measured;
        setPrice((old) => {
          const bid = Math.round((mid - half) * 100) / 100;
          const ask = Math.round((mid + half) * 100) / 100;
          if (old && old.bid === bid && old.ask === ask && old.gap === g.applied && old.live === connected.current) {
            return old;
          }
          return { bid, ask, time: now, gap: g.applied, gapReady: g.ready, live: connected.current };
        });
      } else {
        setPrice((old) =>
          old && old.bid === s.bid && old.ask === s.ask && old.time === s.at && old.live === connected.current &&
          old.gapReady === (g.ready || !goldMarketOpen(now))
            ? old
            : { bid: s.bid, ask: s.ask, time: s.at, gap: g.applied, gapReady: g.ready || !goldMarketOpen(now), live: connected.current },
        );
      }
    };

    connect();
    loadSpot();
    const spotTimer = setInterval(loadSpot, SPOT_EVERY_MS);
    const uiTimer = setInterval(render, UI_EVERY_MS);
    // The first gap needs a PAXG tick; measure again as soon as the stream has one
    const firstGap = setTimeout(loadSpot, 1500);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(firstGap);
      clearInterval(spotTimer);
      clearInterval(uiTimer);
      ws?.close();
    };
  }, []);

  return price;
}
