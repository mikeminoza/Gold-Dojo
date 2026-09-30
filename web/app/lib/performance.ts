"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Backtest } from "./types";

/** A finished trade: when it closed (UTC seconds) and its result in account money. */
export type Result = { t: number; usd: number };

export type Stats = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100
  profitFactor: number | null; // null when nothing was lost
  net: number;
  netPercent: number;
  worstDrop: number; // money, negative
  worstDropPercent: number; // from the highest the account had been, negative
  avgWin: number;
  avgLoss: number;
  best: number;
  worst: number;
  losingStreak: number;
  perWeek: number;
  equity: { t: number; v: number }[]; // the balance after each trade, starting from `balance`
  years: { year: number; trades: number; winRate: number; net: number; profitFactor: number | null }[];
};

const pf = (list: Result[]) => {
  const won = list.filter((r) => r.usd > 0).reduce((a, r) => a + r.usd, 0);
  const lost = -list.filter((r) => r.usd < 0).reduce((a, r) => a + r.usd, 0);
  return lost > 0 ? won / lost : null;
};

/**
 * Results on a fixed account: every trade is sized from the same starting balance (as the bot's
 * suggested sizes are), so the curve is the plain running total, not compounded.
 */
export function stats(results: Result[], balance: number, from?: number): Stats | null {
  if (results.length === 0) return null;
  const list = [...results].sort((a, b) => a.t - b.t);
  const wins = list.filter((r) => r.usd > 0);
  const losses = list.filter((r) => r.usd < 0);
  const net = list.reduce((a, r) => a + r.usd, 0);

  const start = from ?? list[0].t;
  const equity = [{ t: start, v: balance }];
  let v = balance;
  let peak = balance;
  let drop = 0;
  let dropPercent = 0;
  let streak = 0;
  let longest = 0;
  for (const r of list) {
    v += r.usd;
    equity.push({ t: r.t, v });
    peak = Math.max(peak, v);
    drop = Math.min(drop, v - peak);
    dropPercent = Math.min(dropPercent, (100 * (v - peak)) / peak);
    streak = r.usd < 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }

  const byYear = new Map<number, Result[]>();
  for (const r of list) {
    const y = new Date(r.t * 1000).getUTCFullYear();
    byYear.set(y, [...(byYear.get(y) ?? []), r]);
  }
  const weeks = Math.max((list[list.length - 1].t - start) / (7 * 86400), 1);

  return {
    trades: list.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (100 * wins.length) / list.length,
    profitFactor: pf(list),
    net,
    netPercent: (100 * net) / balance,
    worstDrop: drop,
    worstDropPercent: dropPercent,
    avgWin: wins.length ? wins.reduce((a, r) => a + r.usd, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, r) => a + r.usd, 0) / losses.length : 0,
    best: Math.max(...list.map((r) => r.usd)),
    worst: Math.min(...list.map((r) => r.usd)),
    losingStreak: longest,
    perWeek: list.length / weeks,
    equity,
    years: [...byYear].map(([year, rs]) => ({
      year,
      trades: rs.length,
      winRate: (100 * rs.filter((r) => r.usd > 0).length) / rs.length,
      net: rs.reduce((a, r) => a + r.usd, 0),
      profitFactor: pf(rs),
    })),
  };
}

/** The replayed history from publish_backtest.py (loaded once, when first needed). */
export function useBacktest(enabled: boolean) {
  const client = supabase();
  const [result, setResult] = useState<{ backtest: Backtest | null; ready: boolean }>({ backtest: null, ready: false });

  useEffect(() => {
    if (!client || !enabled || result.ready) return;
    let stopped = false;
    client
      .from("bot_state")
      .select("data")
      .eq("id", "backtest")
      .maybeSingle()
      .then(({ data }) => {
        if (!stopped) setResult({ backtest: (data?.data as Backtest | undefined) ?? null, ready: true });
      });
    return () => {
      stopped = true;
    };
  }, [client, enabled, result.ready]);

  return result;
}
