"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The signals you marked "I took this trade" (trade id -> lots), saved on your account.
 * `available` is false until supabase/my-trades.sql has been run.
 */
export function useMyTrades() {
  const [taken, setTaken] = useState<Map<string, number>>(new Map());
  const [available, setAvailable] = useState(true);

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
        setTaken(new Map((d.trades as { trade_id: string; lots: number }[]).map((t) => [t.trade_id, t.lots])));
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

  return { taken, mark, available };
}
