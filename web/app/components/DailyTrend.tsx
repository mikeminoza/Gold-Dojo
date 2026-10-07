"use client";

import { useState } from "react";
import type { MyAccount } from "../lib/account";
import { brokerSize, lotDecimals, ozPerLotInDollars, useBroker } from "../lib/broker";
import { toast } from "../lib/toast";
import type { DailyTrendState, LiveState } from "../lib/types";
import BrokerForm from "./BrokerForm";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;

type Taken = { taken: Map<string, number>; mark: (id: string, lots: number | null) => Promise<void>; available: boolean };

/** Which candles a trend strategy reads: Daily trend's or 4-hour trend's. */
export type Candle = "daily" | "4-hour";

type Rule = DailyTrendState["rules"][number];

/** How far (%) price is below a breakout trigger, when it's close enough for "Signal coming?" (else null). */
export function nearTrigger(trend: DailyTrendState, x: Rule) {
  const near = trend.near_pct ?? 1;
  const gap = x.gap_pct;
  return !x.position && !x.pending && gap != null && gap > 0 && gap <= near ? gap : null;
}

function NearBadge({ gap }: { gap: number }) {
  return (
    <span className="trend-near">
      <i aria-hidden /> Close to the trigger: {gap.toFixed(2)}% below
    </span>
  );
}

const ordinal = (n: number) => {
  const k = Math.round(n);
  const end = k % 100 >= 11 && k % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][k % 10] ?? "th");
  return `${k}${end}`;
};

/** Paper trades so far against the number needed before going live, and what the backtest check says. */
function Readiness({
  count,
  target,
  drift,
}: {
  count: number;
  target: number;
  drift?: { percentile: number; alarm: boolean };
}) {
  const done = count >= target;
  const status = !done
    ? "Building a track record"
    : drift
      ? drift.alarm
        ? "Below the backtest's normal range — don't go live"
        : `On track (live results at the ${ordinal(drift.percentile)} percentile of the backtest)`
      : "Enough trades: the backtest check shows after the bot's next update";
  const tone = done && drift ? (drift.alarm ? "loss" : "profit") : undefined;
  return (
    <div className="trend-ready" data-tone={tone}>
      <div className="trend-ready-head">
        <span>
          Paper trades: {count} / {target}
        </span>
        <span>{status}</span>
      </div>
      <div
        className="trend-ready-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(count, target)}
        aria-label={`Paper trades: ${count} of ${target}`}
      >
        <i style={{ width: `${Math.min(100, (100 * count) / target)}%` }} />
      </div>
    </div>
  );
}

/**
 * A trend strategy's panel (Daily trend or 4-hour trend): long-only rules, forward-tested on paper.
 * Shows each rule's open paper trade (with a size for your account and the financing so far) or how
 * far price is from its trigger, its past paper trades, and what a cent account is.
 */
export default function DailyTrend({
  trend,
  account,
  bid,
  day,
  myTrades,
  candle = "daily",
  drift,
  minTrades = 20,
}: {
  candle?: Candle;
  drift?: LiveState["drift"];
  minTrades?: number; // paper trades a rule needs before the backtest check (state.drift_min_trades)
  trend: DailyTrendState;
  account: MyAccount;
  bid: number;
  day: (t: number) => string;
  myTrades: Taken;
}) {
  const riskUsd = (account.balance * account.risk_percent) / 100;
  const broker = useBroker();
  const [brokerOpen, setBrokerOpen] = useState<string | null>(null); // the rule whose broker settings are open
  const dp = lotDecimals(broker);
  const cent = broker.type === "cent";

  return (
    <div className="daily-trend">
      <p className="note">
        {candle === "daily"
          ? "Long-only rules on daily candles, a few trades a year, held for days to weeks. The only rules that made money in both periods of the 23-year test, mostly by riding gold's long rise."
          : "A long-only rule on 4-hour candles, about 14 trades a year, held for days. Roughly break-even in 2003–2018 and profitable in 2019–2026: most of its profit came from gold's recent rise."}{" "}
        Tracked on paper since {trend.started ? day(trend.started) : "today"}.
      </p>
      <ul className="trend-rules">
        {trend.rules.map((x) => {
          const p = x.position;
          const oz = p ? riskUsd / Math.max(p.entry - p.stop, 0.01) : 0;
          const away = x.trigger != null ? x.trigger - bid : null;
          const took = p?.id ? myTrades.taken.get(p.id) : undefined;
          // Lots on the visitor's broker, rounded down to its lot step
          const size = p ? brokerSize(riskUsd, account.balance, p.entry - p.stop, broker) : null;
          const gap = nearTrigger(trend, x);
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
                  {size && (
                    <div className="trend-size" data-verdict={size.tooBig ? "skip" : "ok"}>
                      <p>
                        For {account.risk_percent}% of your {money(account.balance).replace(".00", "")} ({money(riskUsd)}{" "}
                        risk): {oz.toFixed(2)} oz = {size.exact.toFixed(4)} lot exactly on your {cent ? "cent" : "standard"}{" "}
                        account.
                      </p>
                      {size.tooBig ? (
                        <p className="trend-size-warn">
                          Too big for your account: even the smallest {broker.minLot} lot risks {money(size.minRisk)} (
                          {size.minRiskPct.toFixed(1)}% of your account), more than your {account.risk_percent}%.
                          {!cent && " A cent account lets you size 100× smaller."}
                        </p>
                      ) : (
                        <p>
                          Trade <strong>{size.lots.toFixed(dp)} lot</strong> (rounded down to your {broker.lotStep} step):
                          risks {money(size.risk)} ({size.riskPct.toFixed(2)}%).
                        </p>
                      )}
                      <p className="trend-size-note">
                        lots = risk ÷ stop distance ÷ {ozPerLotInDollars(broker)} oz per lot
                        {cent && ` (a cent lot moves like 0.01 standard lot: ${broker.ozPerLot} oz ÷ 100)`}.{" "}
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={brokerOpen === x.id}
                          onClick={() => setBrokerOpen(brokerOpen === x.id ? null : x.id)}
                        >
                          Broker settings
                        </button>
                      </p>
                    </div>
                  )}
                  {brokerOpen === x.id && <BrokerForm onDone={() => setBrokerOpen(null)} />}
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
                          void myTrades.mark(p.id!, took ? null : size && !size.tooBig ? size.lots : broker.minLot);
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
                  <p>Waiting for {x.waiting ?? `the next ${candle} close`}.</p>
                  {gap != null && <NearBadge gap={gap} />}
                  {away != null && x.trigger != null && (
                    <div className="trend-gauge" title={`Trigger ${money(x.trigger)}`}>
                      <span>
                        {away > 0
                          ? `${money(away)} (${((100 * away) / bid).toFixed(1)}%) below ${money(x.trigger)}`
                          : `Price is above ${money(x.trigger)}: watching the ${candle} close`}
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
              <Readiness count={x.count} target={minTrades} drift={drift?.[x.id]} />
            </li>
          );
        })}
      </ul>

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

/** The signal card's short version: what each rule is doing right now. */
export function TrendBrief({
  trend,
  bid,
  day,
  name,
  candle,
}: {
  trend: DailyTrendState | null;
  bid: number;
  day: (t: number) => string;
  name: string; // the strategy, e.g. "4-hour trend"
  candle: Candle;
}) {
  if (!trend) return <p className="trend-brief-empty">Waiting for the bot to start the {name} test. Rules and levels show here once it does.</p>;
  return (
    <ul className="trend-brief">
      {trend.rules.map((x) => {
        const p = x.position;
        const away = x.trigger != null ? x.trigger - bid : null;
        const gap = nearTrigger(trend, x);
        return (
          <li key={x.id} data-open={Boolean(p) || undefined} data-near={gap != null || undefined}>
            <strong>{x.name}</strong>
            <span>
              {p ? (
                <>
                  Bought {money(p.entry)} {day(p.opened)}, stop {money(p.stop)}
                  {p.r_now != null && <b data-tone={p.r_now >= 0 ? "profit" : "loss"}> {r(p.r_now)}</b>}
                </>
              ) : x.pending ? (
                `Buy at the next ${candle} open`
              ) : away != null && away > 0 ? (
                `Waiting, ${money(away)} below the trigger`
              ) : (
                "Waiting for the setup"
              )}
            </span>
            {gap != null && <NearBadge gap={gap} />}
          </li>
        );
      })}
    </ul>
  );
}

/** A trend strategy's own trade history (paper), newest first. */
export function TrendTrades({
  trend,
  day,
  taken,
  name,
}: {
  name: string; // the strategy, e.g. "Daily trend"
  trend: DailyTrendState | null;
  day: (t: number) => string;
  taken: Map<string, number>;
}) {
  const trades = (trend?.rules ?? [])
    .flatMap((x) => x.trades.map((t) => ({ ...t, rule: x.name })))
    .sort((a, b) => b.closed - a.closed);
  const open = (trend?.rules ?? []).filter((x) => x.position);
  if (!trades.length && !open.length) {
    return (
      <p className="note">
        No {name} trades yet. It trades only a handful of times a year, so this fills up slowly; the 23-year backtest
        is under Performance.
      </p>
    );
  }
  return (
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
        {open.map((x) => (
          <tr key={`open-${x.id}`}>
            <th scope="row">{x.name}</th>
            <td>{day(x.position!.opened)}</td>
            <td>{x.position!.nights ?? "–"}</td>
            <td>Open{x.position!.r_now != null && ` ${r(x.position!.r_now)}`}</td>
          </tr>
        ))}
        {trades.map((t) => (
          <tr key={t.id ?? `${t.rule}-${t.opened}`}>
            <th scope="row">{t.rule}</th>
            <td>{day(t.opened)}</td>
            <td>{t.nights}</td>
            <td data-tone={t.r > 0 ? "profit" : t.r < 0 ? "loss" : undefined}>
              {r(t.r)}
              {t.id && taken.has(t.id) && " ✓"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
