"use client";

import { Fragment, useState } from "react";
import type { MyAccount } from "../lib/account";
import { brokerSize, lotDecimals, ozPerLotInDollars, useBroker } from "../lib/broker";
import { toast } from "../lib/toast";
import type { DailyTrendState, LiveState } from "../lib/types";
import BrokerForm from "./BrokerForm";
import TradeExplain, { type ExplainTrade } from "./TradeExplain";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;

type Taken = {
  taken: Map<string, number>;
  mark: (id: string, lots: number | null) => Promise<void>;
  available: boolean;
  fills: Map<string, number>; // the price your broker filled you at, by trade id
  setFill: (id: string, price: number | null) => Promise<"saved" | "not_set_up" | "failed">;
  fillsAvailable: boolean;
};

// The backtest's costs per fill: $0.50 spread + $0.20 slippage per oz
const BACKTEST_COST_OZ = 0.7;

/** "$0.45 worse" / "$0.45 better" / "the same": your fill against the bot's paper entry (longs only, so higher is worse). */
function fillWords(fill: number, entry: number) {
  const diff = fill - entry;
  if (Math.abs(diff) < 0.005) return "the same";
  return `${money(Math.abs(diff))} ${diff > 0 ? "worse" : "better"}`;
}

const fillTone = (gap: number) => (gap > 0.005 ? "loss" : gap < -0.005 ? "profit" : undefined);

/**
 * Broker price check: what your broker actually filled you at, next to the bot's paper entry, in $ per oz
 * and as a share of the stop distance (so you can see how much of the risk the difference eats).
 */
function FillPrice({
  tradeId,
  entry,
  stopDistance,
  myTrades,
}: {
  tradeId: string;
  entry: number;
  stopDistance: number;
  myTrades: Taken;
}) {
  const saved = myTrades.fills.get(tradeId);
  const [draft, setDraft] = useState(saved != null ? String(saved) : "");
  const [busy, setBusy] = useState(false);
  const inputId = `fill-${tradeId}`;
  const save = async () => {
    const text = draft.trim();
    const price = text ? Number(text) : null;
    if (price !== null && !(Number.isFinite(price) && price > 0 && price < 100000)) {
      toast("Enter a price like 2650.40");
      return;
    }
    if (price === (saved ?? null)) return;
    setBusy(true);
    const result = await myTrades.setFill(tradeId, price);
    setBusy(false);
    toast(
      result === "saved"
        ? price
          ? "Fill price saved"
          : "Fill price cleared"
        : result === "not_set_up"
          ? "Fill prices aren't set up yet"
          : "Couldn't save it. Try again.",
    );
  };
  if (!myTrades.fillsAvailable) return null;
  const gap = saved != null ? saved - entry : 0;
  return (
    <div className="fill-check">
      <form
        className="fill-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={inputId}>Your fill price</label>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          placeholder={entry.toFixed(2)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      {saved != null && (
        <p className="fill-diff" data-tone={fillTone(gap)}>
          Your fill {money(saved)} vs the bot&apos;s {money(entry)}: {fillWords(saved, entry)}
          {Math.abs(gap) >= 0.005 && " per oz"} (≈ {((100 * Math.abs(gap)) / Math.max(stopDistance, 0.01)).toFixed(1)}% of
          the stop distance)
        </p>
      )}
    </div>
  );
}

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
                  {p.id && took && (
                    <FillPrice
                      key={myTrades.fills.get(p.id) ?? "none"}
                      tradeId={p.id}
                      entry={p.entry}
                      stopDistance={p.entry - p.sl}
                      myTrades={myTrades}
                    />
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
                <>
                  {((100 * away) / bid).toFixed(1)}% below the trigger {money(x.trigger!)}
                </>
              ) : x.waiting ? (
                `Waiting for ${x.waiting}`
              ) : (
                "Waiting for the setup"
              )}
            </span>
            {!p && !x.pending && away != null && away > 0 && (
              // full when price reaches the trigger, empty when it's 15% or more away
              <i className="brief-gauge" aria-hidden>
                <i style={{ width: `${Math.max(4, 100 * (1 - Math.min(1, away / (0.15 * bid))))}%` }} />
              </i>
            )}
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
  fills,
  name,
}: {
  name: string; // the strategy, e.g. "Daily trend"
  trend: DailyTrendState | null;
  day: (t: number) => string;
  taken: Map<string, number>;
  fills?: Map<string, number>; // your broker's fill price on trades you took
}) {
  const [shown, setShown] = useState<string | null>(null); // the row whose "Explain" panel is open
  const trades = (trend?.rules ?? [])
    .flatMap((x) => x.trades.map((t) => ({ ...t, rule: x.name, ruleId: x.id })))
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
  // Broker price check: your fill against the bot's entry on every taken trade you entered a fill for
  const fillOf = (id: string | undefined) => (id && taken.has(id) ? fills?.get(id) : undefined);
  const checked = [
    ...open.map((x) => ({ fill: fillOf(x.position!.id), entry: x.position!.entry })),
    ...trades.map((t) => ({ fill: fillOf(t.id), entry: t.entry })),
  ].filter((x): x is { fill: number; entry: number } => x.fill != null);
  const avgGap = checked.length ? checked.reduce((sum, x) => sum + x.fill - x.entry, 0) / checked.length : 0;
  const fillNote = (id: string | undefined, entry: number) => {
    const fill = fillOf(id);
    return fill == null ? null : (
      <small className="fill-row" data-tone={fillTone(fill - entry)}>
        Your fill: {fillWords(fill, entry)}
      </small>
    );
  };
  const toggle = (key: string) => (
    <td className="explain-cell">
      <button
        type="button"
        className="link-button explain-toggle"
        aria-expanded={shown === key}
        aria-controls={`explain-${key}`}
        onClick={() => setShown(shown === key ? null : key)}
      >
        {shown === key ? "Hide" : "Explain"}
      </button>
    </td>
  );
  const panel = (key: string, trade: ExplainTrade) =>
    shown === key && (
      <tr className="explain-row">
        <td colSpan={5} id={`explain-${key}`}>
          <TradeExplain trade={trade} />
        </td>
      </tr>
    );
  return (
    <>
      {checked.length > 0 && (
        <p className="fill-summary" data-tone={avgGap > BACKTEST_COST_OZ ? "loss" : undefined}>
          Your average fill vs the bot: {avgGap > 0 ? "+" : avgGap < 0 ? "−" : ""}
          {money(Math.abs(avgGap))} per oz over {checked.length} {checked.length === 1 ? "trade" : "trades"}{" "}
          (+ is worse).{" "}
          {avgGap > BACKTEST_COST_OZ
            ? `That's more than the ~${money(BACKTEST_COST_OZ)} per oz of spread and slippage the backtest assumed, so your real costs are higher than the tested results show.`
            : `Within the ~${money(BACKTEST_COST_OZ)} per oz of spread and slippage the backtest assumed.`}
        </p>
      )}
      <table className="results-split perf-years trend-trades">
      <thead>
        <tr>
          <th scope="col">Rule</th>
          <th scope="col">Bought</th>
          <th scope="col">Nights</th>
          <th scope="col">Result</th>
          <th scope="col">
            <span className="sr-only">Explain</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {open.map((x) => {
          const p = x.position!;
          const key = `open-${x.id}`;
          return (
            <Fragment key={key}>
              <tr>
                <th scope="row">{x.name}</th>
                <td>
                  {day(p.opened)}
                  {fillNote(p.id, p.entry)}
                </td>
                <td>{p.nights ?? "–"}</td>
                <td>Open{p.r_now != null && ` ${r(p.r_now)}`}</td>
                {toggle(key)}
              </tr>
              {panel(key, {
                rule: x.id,
                entry: p.entry,
                opened: p.opened,
                sl: p.sl,
                trigger: p.trigger,
                stop: p.stop,
                rNow: p.r_now,
              })}
            </Fragment>
          );
        })}
        {trades.map((t) => {
          const key = t.id ?? `${t.ruleId}-${t.opened}`;
          return (
            <Fragment key={key}>
              <tr>
                <th scope="row">{t.rule}</th>
                <td>
                  {day(t.opened)}
                  {fillNote(t.id, t.entry)}
                </td>
                <td>{t.nights}</td>
                <td data-tone={t.r > 0 ? "profit" : t.r < 0 ? "loss" : undefined}>
                  {r(t.r)}
                  {t.id && taken.has(t.id) && " ✓"}
                </td>
                {toggle(key)}
              </tr>
              {panel(key, { ...t, rule: t.ruleId })}
            </Fragment>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
