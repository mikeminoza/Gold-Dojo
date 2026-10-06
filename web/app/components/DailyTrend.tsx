"use client";

import { useState } from "react";
import type { MyAccount } from "../lib/account";
import { toast } from "../lib/toast";
import type { DailyTrendState, LiveState } from "../lib/types";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;

type Taken = { taken: Map<string, number>; mark: (id: string, lots: number | null) => Promise<void>; available: boolean };

/**
 * Daily trend mode: two long-only rules on daily candles, forward-tested on paper (trend_daily.py).
 * Shows each rule's open paper trade (with a size for your account and the financing so far) or how
 * far price is from its trigger, its past paper trades, and what a cent account is.
 */
export default function DailyTrend({
  trend,
  account,
  rules,
  bid,
  day,
  myTrades,
}: {
  trend: DailyTrendState;
  account: MyAccount;
  rules: LiveState["account"];
  bid: number;
  day: (t: number) => string;
  myTrades: Taken;
}) {
  const [history, setHistory] = useState(false);
  const riskUsd = (account.balance * account.risk_percent) / 100;
  const trades = trend.rules
    .flatMap((x) => x.trades.map((t) => ({ ...t, rule: x.name })))
    .sort((a, b) => b.closed - a.closed);

  return (
    <div className="daily-trend">
      <p className="note">
        Long-only rules on daily candles, a few trades a year, held for days to weeks. The only rules that made money
        in both periods of the 23-year test, mostly by riding gold&apos;s long rise. Tracked on paper since{" "}
        {trend.started ? day(trend.started) : "today"}.
      </p>
      <ul className="trend-rules">
        {trend.rules.map((x) => {
          const p = x.position;
          const oz = p ? riskUsd / Math.max(p.entry - p.stop, 0.01) : 0;
          const away = x.trigger != null ? x.trigger - bid : null;
          const took = p?.id ? myTrades.taken.get(p.id) : undefined;
          return (
            <li key={x.id} data-open={Boolean(p) || undefined}>
              <div className="trend-head">
                <strong>{x.name}</strong>
                <span className="trend-state">{p ? "In a long" : x.pending ? "Buying at the next open" : "Waiting"}</span>
              </div>
              {p ? (
                <>
                  <p>
                    Bought {money(p.entry)} on {day(p.opened)} · trailing stop {money(p.stop)}
                    {p.r_now != null && (
                      <strong data-tone={p.r_now >= 0 ? "profit" : "loss"}> · {r(p.r_now)} now</strong>
                    )}
                  </p>
                  <p className="trend-size">
                    For {account.risk_percent}% of your {money(account.balance).replace(".00", "")} ({money(riskUsd)} risk):{" "}
                    {oz.toFixed(2)} oz = <strong>{(oz / rules.oz_per_lot).toFixed(4)} lot</strong> standard
                    {oz / rules.oz_per_lot < rules.min_lot && ` (below the ${rules.min_lot} minimum)`}, or{" "}
                    <strong>{oz.toFixed(2)} lot</strong> on a cent account.
                  </p>
                  {p.swap_oz != null && (
                    <p className="trend-swap">
                      Overnight financing so far (estimate, {p.nights} {p.nights === 1 ? "night" : "nights"}):{" "}
                      {money(p.swap_oz)} per oz ≈ {money(p.swap_oz * oz)} at your size.
                    </p>
                  )}
                  {p.id && myTrades.available && (
                    <div className="trade-actions">
                      <button
                        type="button"
                        aria-pressed={took ? "true" : "false"}
                        onClick={() => {
                          void myTrades.mark(p.id!, took ? null : Math.max(oz / rules.oz_per_lot, rules.min_lot));
                          toast(took ? "Unmarked" : "Marked as taken");
                        }}
                      >
                        {took ? `✓ You took this (${took.toFixed(2)} lot)` : "I took this trade"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p>Waiting for {x.waiting ?? "the next daily close"}.</p>
                  {away != null && x.trigger != null && (
                    <div className="trend-gauge" title={`Trigger ${money(x.trigger)}`}>
                      <span>
                        {away > 0
                          ? `${money(away)} (${((100 * away) / bid).toFixed(1)}%) below ${money(x.trigger)}`
                          : `Price is above ${money(x.trigger)}: watching the daily close`}
                      </span>
                      {/* full when price reaches the trigger, empty when it's 15% or more away */}
                      <i style={{ width: `${Math.max(4, 100 * (1 - Math.min(1, Math.max(away, 0) / (0.15 * bid))))}%` }} aria-hidden />
                    </div>
                  )}
                </>
              )}
              {x.count > 0 && (
                <p className="trend-results">
                  {x.count} paper {x.count === 1 ? "trade" : "trades"} ·{" "}
                  <span data-tone={x.total_r >= 0 ? "profit" : "loss"}>{r(x.total_r)}</span>
                  {x.win_rate !== null && ` · ${x.win_rate}% won`}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {trades.length > 0 && (
        <>
          <button type="button" className="link-button trend-toggle" aria-expanded={history} onClick={() => setHistory((v) => !v)}>
            {history ? "Hide" : "Show"} past paper trades ({trades.length})
          </button>
          {history && (
            <table className="results-split perf-years">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Bought</th>
                  <th scope="col">Nights</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id ?? `${t.rule}-${t.opened}`}>
                    <th scope="row">{t.rule}</th>
                    <td>{day(t.opened)}</td>
                    <td>{t.nights}</td>
                    <td data-tone={t.r > 0 ? "profit" : t.r < 0 ? "loss" : undefined}>
                      {r(t.r)}
                      {t.id && myTrades.taken.has(t.id) && " ✓"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <details className="trend-guide">
        <summary>Why a cent account?</summary>
        <p>
          These trades use wide stops (often $40–$100 below the entry). On a standard account the smallest trade is
          0.01 lot = 1 oz, so a $60 stop loses $60, which is 12% of a $500 account in one trade.
        </p>
        <p>
          On a <strong>cent account</strong> your balance is counted in cents, so 0.01 lot moves 100× less in dollars
          and you can size small enough to risk 1–2%. Many brokers offer cent accounts for gold; check the minimum
          size and swap (overnight) costs, since these trades are held for weeks. Try it on demo first.
        </p>
      </details>
    </div>
  );
}
