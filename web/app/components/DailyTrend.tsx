"use client";

import type { MyAccount } from "../lib/account";
import type { DailyTrendState, LiveState } from "../lib/types";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;

/**
 * Daily trend mode: two long-only rules on daily candles, forward-tested on paper (trend_daily.py).
 * Shows each rule's open paper trade (with a size for your account) or what it's waiting for.
 */
export default function DailyTrend({
  trend,
  account,
  rules,
  day,
}: {
  trend: DailyTrendState;
  account: MyAccount;
  rules: LiveState["account"];
  day: (t: number) => string;
}) {
  return (
    <section className="side-block daily-trend" aria-label="Daily trend">
      <h2>
        Daily trend <span className="tz-note">forward test (paper)</span>
      </h2>
      <p className="note">
        Long-only rules on daily candles, a few trades a year, held for days to weeks. The only rules that made money
        in both periods of the 23-year test, mostly by riding gold&apos;s long rise. Tracked on paper since{" "}
        {trend.started ? day(trend.started) : "today"}.
      </p>
      <ul className="trend-rules">
        {trend.rules.map((x) => {
          const p = x.position;
          const riskUsd = (account.balance * account.risk_percent) / 100;
          const oz = p ? riskUsd / Math.max(p.entry - p.stop, 0.01) : 0;
          return (
            <li key={x.id} data-open={Boolean(p) || undefined}>
              <div className="trend-head">
                <strong>{x.name}</strong>
                <span className="trend-state">{p ? "In a long" : x.pending ? "Buying at the next open" : "Waiting"}</span>
              </div>
              {p ? (
                <>
                  <p>
                    Bought {money(p.entry)} on {day(p.opened)} · stop {money(p.stop)}
                    {p.r_now != null && (
                      <strong data-tone={p.r_now >= 0 ? "profit" : "loss"}> · {r(p.r_now)} now</strong>
                    )}
                  </p>
                  <p className="trend-size">
                    For {account.risk_percent}% of your {money(account.balance).replace(".00", "")} ({money(riskUsd)} risk):{" "}
                    {oz.toFixed(2)} oz ={" "}
                    <strong>{(oz / rules.oz_per_lot).toFixed(4)} lot</strong> on a standard account
                    {oz / rules.oz_per_lot < rules.min_lot && ` (below the ${rules.min_lot} minimum)`}, or{" "}
                    <strong>{oz.toFixed(2)} lot</strong> on a cent account (1 lot = 1 oz).
                  </p>
                </>
              ) : (
                <p>Waiting for {x.waiting ?? "the next daily close"}.</p>
              )}
              {x.count > 0 && (
                <p className="trend-results">
                  {x.count} paper {x.count === 1 ? "trade" : "trades"} · <span data-tone={x.total_r >= 0 ? "profit" : "loss"}>{r(x.total_r)}</span>
                  {x.win_rate !== null && ` · ${x.win_rate}% won`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
