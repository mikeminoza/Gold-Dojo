"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Candle } from "./types";

/**
 * Real XAUUSD prices the bot records every minute (supabase/market-data.sql), for the chart: loads the
 * last two weeks, then picks up new minutes every 30 s. Each minute is the mid price (bid + half the
 * spread), keyed by its start in UTC seconds.
 */
export type RealMinutes = Map<number, [number, number, number, number]>;

const DAYS = 14;
const POLL_MS = 30_000;
const PAGE = 1000;

type Row = { minute: string; bid_open: number; bid_high: number; bid_low: number; bid_close: number; spread_avg: number };

export function useRealMinutes(): RealMinutes {
  const client = supabase();
  const [minutes, setMinutes] = useState<RealMinutes>(() => new Map());

  useEffect(() => {
    if (!client) return;
    let stopped = false;
    let since = new Date(Date.now() - DAYS * 86400_000).toISOString();

    const add = (rows: Row[]) => {
      if (rows.length === 0) return;
      setMinutes((old) => {
        const next = new Map(old);
        for (const r of rows) {
          const half = (r.spread_avg ?? 0) / 2;
          next.set(Date.parse(r.minute) / 1000, [r.bid_open + half, r.bid_high + half, r.bid_low + half, r.bid_close + half]);
        }
        return next;
      });
      since = rows[rows.length - 1].minute;
    };

    // Pages of newer minutes until caught up (`since` moves forward with each page)
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        while (!stopped) {
          const { data, error } = await client
            .from("market_minutes")
            .select("minute, bid_open, bid_high, bid_low, bid_close, spread_avg")
            .gt("minute", since)
            .order("minute")
            .limit(PAGE);
          if (stopped || error || !data) return; // no table yet, or not allowed: the chart keeps PAXG
          add(data as Row[]);
          if (data.length < PAGE) return;
        }
      } finally {
        busy = false;
      }
    };

    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [client]);

  return minutes;
}

/**
 * Candles with every well-covered one (80% of its minutes recorded) replaced by the real prices, the
 * same rule the bot uses for its signals. Daily candles are left as they are.
 */
export function withRealPrices(candles: Candle[], minutes: RealMinutes, stepSeconds: number): Candle[] {
  if (minutes.size === 0 || stepSeconds >= 86400) return candles;
  const need = 0.8 * (stepSeconds / 60);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return candles.map((k) => {
    const bars: [number, number, number, number][] = [];
    for (let m = k.t; m < k.t + stepSeconds; m += 60) {
      const b = minutes.get(m);
      if (b) bars.push(b);
    }
    if (bars.length < need) return k;
    return {
      ...k,
      o: r2(bars[0][0]),
      h: r2(Math.max(...bars.map((b) => b[1]))),
      l: r2(Math.min(...bars.map((b) => b[2]))),
      c: r2(bars[bars.length - 1][3]),
    };
  });
}
