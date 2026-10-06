"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** One saved signal from the permanent journal (the `signals` table). */
export type JournalEntry = {
  event_id: string;
  trade_id: string | null;
  type: "open" | "close";
  side: "BUY" | "SELL";
  strategy: string | null;
  session: string | null;
  symbol: string | null;
  timeframe: string | null;
  price: number;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  lots: number | null;
  risk: number | null;
  pnl: number | null;
  pnl_usd: number | null;
  reason: string | null;
  created_at: string;
  mfe_r?: number | null; // furthest in our favour before closing, in R (after supabase/analysis.sql)
  mae_r?: number | null; // furthest against us, in R
  context?: { weekday?: number; range_atr?: number; trend_pct?: number } | null;
};

// Everything, so newer columns (mfe_r, mae_r) come along once supabase/analysis.sql has added them
const COLUMNS = "*";
const LIMIT = 5000;

/**
 * Every signal the bot has ever recorded, newest first, with new ones arriving live.
 * `ready` is false until the first load; `available` is false if the journal table doesn't exist yet.
 */
export function useJournal() {
  const client = supabase();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!client) return;
    let stopped = false;
    client
      .from("signals")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(LIMIT)
      .then(({ data, error }) => {
        if (stopped) return;
        if (error) setAvailable(false);
        else setEntries((data ?? []) as JournalEntry[]);
        setReady(true);
      });
    const channel = client
      .channel("journal")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "signals" }, (change) => {
        const row = change.new as JournalEntry;
        setEntries((list) => (list.some((e) => e.event_id === row.event_id) ? list : [row, ...list]));
      })
      .subscribe();
    return () => {
      stopped = true;
      client.removeChannel(channel);
    };
  }, [client]);

  return { entries, ready, available };
}

/** The journal as a CSV file for Excel / Google Sheets, with times in the given time zone. */
export function journalCsv(entries: JournalEntry[], tz: string) {
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-CA", { timeZone: tz, hour12: false }).replace(",", "");
  const head = [
    "time", "type", "side", "session", "strategy", "timeframe", "symbol", "price", "entry",
    "stop_loss", "take_profit", "lots", "risk_usd", "result_per_oz", "result_usd", "reason",
  ];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [...entries]
    .reverse() // oldest first reads best in a spreadsheet
    .map((e) =>
      [
        when(e.created_at), e.type, e.side, e.session, e.strategy, e.timeframe, e.symbol, e.price, e.entry,
        e.sl, e.tp, e.lots, e.risk, e.pnl, e.pnl_usd, e.reason,
      ]
        .map(cell)
        .join(","),
    );
  return [head.join(","), ...lines].join("\n");
}
