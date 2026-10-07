"use client";

import { useCallback, useEffect, useState } from "react";

type Row = { trade_id: string; lots: number; broker_price?: number | null };

/**
 * The signals you marked "I took this trade" (trade id -> lots), saved on your account, and the price
 * your broker filled you at, if you entered one (trade id -> price).
 * `available` is false until supabase/my-trades.sql has been run; `fillsAvailable` until supabase/push.sql has.
 */
export function useMyTrades() {
  const [taken, setTaken] = useState<Map<string, number>>(new Map());
  const [fills, setFills] = useState<Map<string, number>>(new Map());
  const [available, setAvailable] = useState(true);
  const [fillsAvailable, setFillsAvailable] = useState(true);

  useEffect(() => {
    let stopped = false;
    fetch("/api/my-trades")
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (stopped) return;
        if (!ok) {
          setAvailable(d?.error !== "not_set_up");
          return;
        }
        const rows = d.trades as Row[];
        setTaken(new Map(rows.map((t) => [t.trade_id, t.lots])));
        setFills(new Map(rows.flatMap((t) => (t.broker_price ? [[t.trade_id, t.broker_price] as const] : []))));
        setFillsAvailable(d.fills !== false);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);

  /** Mark (lots > 0) or unmark (null) a trade; shown straight away, undone if saving fails. */
  const mark = useCallback(async (tradeId: string, lots: number | null) => {
    let before: number | undefined;
    setTaken((m) => {
      before = m.get(tradeId);
      const next = new Map(m);
      if (lots) next.set(tradeId, lots);
      else next.delete(tradeId);
      return next;
    });
    const res = await (lots
      ? fetch("/api/my-trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tradeId, lots }),
        })
      : fetch(`/api/my-trades?tradeId=${encodeURIComponent(tradeId)}`, { method: "DELETE" })
    ).catch(() => null);
    if (!res?.ok) {
      setTaken((m) => {
        const next = new Map(m);
        if (before) next.set(tradeId, before);
        else next.delete(tradeId);
        return next;
      });
    }
  }, []);

  /**
   * Save the price your broker filled you at (null clears it) on a trade you took.
   * Resolves to "saved", "not_set_up" (the column isn't there yet) or "failed".
   */
  const setFill = useCallback(
    async (tradeId: string, price: number | null): Promise<"saved" | "not_set_up" | "failed"> => {
      const lots = taken.get(tradeId);
      if (!lots) return "failed";
      const res = await fetch("/api/my-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, lots, brokerPrice: price }),
      }).catch(() => null);
      const d = res?.ok ? await res.json().catch(() => null) : null;
      if (!d?.ok) return "failed";
      if (d.fills === false) {
        setFillsAvailable(false);
        return "not_set_up";
      }
      setFills((m) => {
        const next = new Map(m);
        if (price) next.set(tradeId, price);
        else next.delete(tradeId);
        return next;
      });
      return "saved";
    },
    [taken],
  );

  return { taken, mark, available, fills, setFill, fillsAvailable };
}
