"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { sizeEvents, useMyAccount } from "../lib/account";
import { useBotState } from "../lib/useBotState";
import { useJournal } from "../lib/useJournal";
import { useMyTrades } from "../lib/useMyTrades";
import type { LiveState } from "../lib/types";
import { fromJournal, useMe } from "../components/Dashboard";
import Performance from "../components/Performance";
import { Skeleton } from "../components/EmptyState";

const DEFAULT_RULES: LiveState["account"] = { balance: 500, risk_percent: 1, max_risk_percent: 2, oz_per_lot: 100, min_lot: 0.01 };

/** Performance as its own page: live results, your trades, analysis, Daily trend and backtests. */
export default function PerformancePage() {
  const { state } = useBotState();
  const rules = state?.account ?? DEFAULT_RULES;
  const my = useMyAccount(rules);
  const journal = useJournal();
  const myTrades = useMyTrades();
  const me = useMe();
  const router = useRouter();
  const back = useCallback(() => router.push("/"), [router]);

  const signals = useMemo(() => {
    if (!state?.account) return [];
    const usingJournal = journal.available && journal.entries.length > 0;
    const all = usingJournal ? journal.entries.map((e) => fromJournal(e, state.account)) : (state.history ?? []);
    return sizeEvents(all, my.account, state.account);
  }, [journal.available, journal.entries, state, my.account]);

  if (!state) {
    return (
      <main className="perf-page">
        <div className="perf">
          <Skeleton lines={3} height={140} />
        </div>
      </main>
    );
  }
  return (
    <Performance
      page
      events={signals}
      my={my}
      rules={state.account}
      tz={state.display.tz}
      onClose={back}
      taken={myTrades.taken}
      swing={me?.role === "admin" ? (state.swing_paper ?? null) : undefined}
    />
  );
}
