"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useMyAccount } from "../lib/account";
import { stats, useTrendBacktest, type Result, type Stats } from "../lib/performance";
import type { DailyTrendState, LiveState, SwingPaper } from "../lib/types";
import AccountForm from "./AccountForm";
import { Skeleton } from "./EmptyState";

type Tab = "trend" | "h4" | "swing";

const money = (n: number, sign = false) =>
  `${sign ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const pct = (n: number, sign = true) => `${sign && n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
const factor = (n: number | null) => (n === null ? "∞" : n.toFixed(2));
const tone = (n: number) => (n > 0 ? "profit" : n < 0 ? "loss" : undefined);

function day(t: number, tz: string, withYear = true) {
  return new Date(t * 1000).toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** The account balance after each trade, with a hover read-out. */
function EquityChart({ points, balance, tz }: { points: Stats["equity"]; balance: number; tz: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 300;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const values = points.map((p) => p.v);
  const lo0 = Math.min(balance, ...values);
  const hi0 = Math.max(balance, ...values);
  const pad = (hi0 - lo0) * 0.08 || balance * 0.05;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const x = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * W : W / 2);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(t1).toFixed(1)},${H}L${x(t0).toFixed(1)},${H}Z`;
  const last = points[points.length - 1].v;

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    }
    setHover(best);
  }

  const h = hover !== null ? points[hover] : null;
  return (
    <figure className="equity" data-tone={tone(last - balance)}>
      <div
        className="equity-plot"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Account went from ${money(balance)} to ${money(last)}`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="equity-start" x1="0" x2={W} y1={y(balance)} y2={y(balance)} vectorEffect="non-scaling-stroke" />
          <path d={area} fill="url(#equity-fill)" />
          <path d={line} className="equity-line" vectorEffect="non-scaling-stroke" />
          {h && (
            <line className="equity-cursor" x1={x(h.t)} x2={x(h.t)} y1="0" y2={H} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <span className="equity-label" style={{ top: `${(y(balance) / H) * 100}%` }}>
          Start {money(balance).replace(".00", "")}
        </span>
        {h && (
          <>
            <i className="equity-dot" style={{ left: `${(x(h.t) / W) * 100}%`, top: `${(y(h.v) / H) * 100}%` }} />
            <span
              className="equity-tip"
              style={{ left: `${Math.min(Math.max((x(h.t) / W) * 100, 12), 88)}%` }}
            >
              <strong>{money(h.v)}</strong> {hover ? `after trade ${hover}, ${day(h.t, tz)}` : "at the start"}
            </span>
          </>
        )}
      </div>
      <figcaption>
        <span>{day(t0, tz)}</span>
        <span>{day(t1, tz)}</span>
      </figcaption>
    </figure>
  );
}

/** A small seeded random number generator (mulberry32), so the band is the same on every render. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIMS = 500;

/**
 * Where the backtest says the running total (R) usually is after n trades: 500 made-up trade sequences,
 * each drawn at random (with repeats) from the backtest's own trades, then the 5th, 50th and 95th
 * percentile at every trade number.
 */
function backtestBand(rs: number[], n: number) {
  const rand = seeded(20031 + rs.length);
  const sums = new Float64Array(SIMS);
  const lo = [0];
  const mid = [0];
  const hi = [0];
  const at = (sorted: Float64Array, q: number) => sorted[Math.min(SIMS - 1, Math.floor(q * SIMS))];
  for (let k = 1; k <= n; k++) {
    for (let i = 0; i < SIMS; i++) sums[i] += rs[Math.floor(rand() * rs.length)];
    const sorted = Float64Array.from(sums).sort();
    lo.push(at(sorted, 0.05));
    mid.push(at(sorted, 0.5));
    hi.push(at(sorted, 0.95));
  }
  return { lo, mid, hi };
}

const rText = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;

/** A rule's live paper trades (running total in R) drawn over the backtest's usual range after as many trades. */
function LiveVsBacktest({ trades, live, name }: { trades: [number, number][]; live: number[]; name: string }) {
  const n = Math.max(live.length, 30);
  const band = useMemo(() => backtestBand(trades.map(([, r]) => r), n), [trades, n]);
  const W = 1000;
  const H = 220;
  const liveSum = live.reduce<number[]>((acc, r) => [...acc, acc[acc.length - 1] + r], [0]);
  const lo0 = Math.min(0, ...band.lo, ...liveSum);
  const hi0 = Math.max(0, ...band.hi, ...liveSum);
  const pad = (hi0 - lo0) * 0.08 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const x = (k: number) => (k / n) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = (vs: number[]) => vs.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${path(band.hi)}${band.lo
    .map((v, k) => [k, v] as const)
    .reverse()
    .map(([k, v]) => `L${x(k).toFixed(1)},${y(v).toFixed(1)}`)
    .join("")}Z`;
  const last = live.length;
  const now = liveSum[last];
  const where = !last ? null : now < band.lo[last] ? "below" : now > band.hi[last] ? "above" : "inside";

  return (
    <figure className="track" data-where={where ?? undefined}>
      <div
        className="track-plot"
        role="img"
        aria-label={
          last
            ? `${name}: ${last} paper ${last === 1 ? "trade" : "trades"}, ${rText(now)}, ${where} the backtest's usual range`
            : `${name}: the backtest's usual range over ${n} trades; no paper trades yet`
        }
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <path d={area} className="track-band" />
          <line className="equity-start" x1="0" x2={W} y1={y(0)} y2={y(0)} vectorEffect="non-scaling-stroke" />
          <path d={path(band.mid)} className="track-mid" vectorEffect="non-scaling-stroke" />
          {last > 0 && <path d={path(liveSum)} className="track-live" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="track-y" style={{ top: "6px" }}>
          {rText(hi0)}
        </span>
        <span className="track-y" style={{ bottom: "6px" }}>
          {rText(lo0)}
        </span>
        {last > 0 && (
          <i className="equity-dot track-dot" style={{ left: `${(x(last) / W) * 100}%`, top: `${(y(now) / H) * 100}%` }} />
        )}
      </div>
      <figcaption>
        <span>Trade 1</span>
        <span className="track-key">
          <i data-key="live" /> Paper trades <i data-key="mid" /> Backtest middle <i data-key="band" /> 90% of backtest runs
        </span>
        <span>Trade {n}</span>
      </figcaption>
      <p className="track-note">
        {last
          ? `After ${last} paper ${last === 1 ? "trade" : "trades"}: ${rText(now)}, ${where === "inside" ? "inside" : where} the band. `
          : "No paper trades closed yet: the live line starts with the first one. "}
        Inside the band = on track. Below it for long = something may be wrong.
      </p>
    </figure>
  );
}

function Numbers({ s }: { s: Stats }) {
  const items: [string, string, string | undefined, string?][] = [
    ["Result", `${money(s.net, true)} (${pct(s.netPercent)})`, tone(s.net)],
    ["Trades", `${s.trades}`, undefined, `${s.perWeek.toFixed(1)} a week`],
    ["Win rate", `${Math.round(s.winRate)}%`, undefined, `${s.wins} won, ${s.losses} lost`],
    [
      "Profit factor",
      factor(s.profitFactor),
      s.profitFactor === null || s.profitFactor > 1 ? "profit" : "loss",
      "money won ÷ money lost; above 1 is profitable",
    ],
    ["Worst drop", pct(s.worstDropPercent), s.worstDropPercent < 0 ? "loss" : undefined, `${money(s.worstDrop)} from a high`],
    ["Average win", money(s.avgWin), "profit", `best ${money(s.best)}`],
    ["Average loss", money(s.avgLoss), "loss", `worst ${money(s.worst)}`],
    ["Losing streak", `${s.losingStreak}`, undefined, "most losses in a row"],
  ];
  return (
    <dl className="perf-numbers">
      {items.map(([label, value, t, sub]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd data-tone={t}>{value}</dd>
          {sub && <dd className="perf-sub">{sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Years({ s }: { s: Stats }) {
  if (s.years.length < 2) return null;
  return (
    <table className="results-split perf-years">
      <caption>By year</caption>
      <thead>
        <tr>
          <th scope="col">Year</th>
          <th scope="col">Trades</th>
          <th scope="col">Win rate</th>
          <th scope="col">Profit factor</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {s.years.map((y) => (
          <tr key={y.year}>
            <th scope="row">{y.year}</th>
            <td>{y.trades}</td>
            <td>{Math.round(y.winRate)}%</td>
            <td>{factor(y.profitFactor)}</td>
            <td data-tone={tone(y.net)}>{money(y.net, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The daily swing candidate, tracked on paper only (swing_paper.py). Results in R: +1R = one risk won. */
function SwingTab({ swing, tz }: { swing: SwingPaper | null; tz: string }) {
  if (!swing) return <p className="empty">Paper tracking starts when the bot next restarts.</p>;
  const r = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;
  return (
    <>
      <p className="perf-about">
        Not a signal: a {swing.rule}, recorded since {swing.started ? day(swing.started, tz) : "today"} to re-test it
        later. In the 23-year test it made money but no more than holding gold for the risk (see
        docs/swing-research.md). It needs wide stops, so it doesn&apos;t fit a small standard account.
      </p>
      <dl className="perf-numbers">
        <div>
          <dt>Closed paper trades</dt>
          <dd>{swing.count}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd data-tone={tone(swing.total_r)}>{r(swing.total_r)}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{swing.win_rate === null ? "–" : `${swing.win_rate}%`}</dd>
        </div>
        <div>
          <dt>Profit factor</dt>
          <dd>{swing.profit_factor === null ? "–" : factor(swing.profit_factor)}</dd>
        </div>
      </dl>
      <p className="perf-about">
        {swing.position
          ? `Open on paper: ${swing.position.side > 0 ? "long" : "short"} from ${swing.position.entry.toFixed(2)} since ${day(swing.position.opened, tz)}, trailing stop ${swing.position.stop.toFixed(2)}.`
          : "No paper trade open: waiting for a close above the 100-day high or below the 100-day low."}
      </p>
      {swing.trades.length > 0 && (
        <table className="results-split perf-years">
          <caption>Closed paper trades</caption>
          <thead>
            <tr>
              <th scope="col">Opened</th>
              <th scope="col">Side</th>
              <th scope="col">Nights</th>
              <th scope="col">Exit</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {swing.trades.map((t) => (
              <tr key={t.opened}>
                <th scope="row">{day(t.opened, tz)}</th>
                <td>{t.side === "BUY" ? "Long" : "Short"}</td>
                <td>{t.nights}</td>
                <td>{t.reason}</td>
                <td data-tone={tone(t.r)}>{r(t.r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const NO_TRADES: number[] = [];
/** A rule's closed paper trades in R, oldest first (older bots send only the trade list). */
function liveRs(tracker: DailyTrendState | null, id: string) {
  const rule = tracker?.rules.find((x) => x.id === id);
  if (!rule) return NO_TRADES;
  return rule.rs ?? [...rule.trades].sort((a, b) => a.closed - b.closed).map((t) => t.r);
}

/** A trend strategy's 23-year backtest: each rule's curve and numbers at your size, next to holding gold. */
function TrendTab({
  row,
  account,
  tz,
  tracker,
}: {
  row: "daily_trend_backtest" | "h4_trend_backtest"; // the bot_state row it's published in
  tracker: DailyTrendState | null; // the live paper test of the same rules
  account: { balance: number; risk_percent: number };
  tz: string;
}) {
  const { data, ready } = useTrendBacktest(row);
  const daily = row === "daily_trend_backtest";
  if (!ready) return <Skeleton lines={2} height={120} />;
  if (!data) {
    return daily ? (
      <p className="empty">
        Not published yet. On the PC with the research data run <code>.venv\Scripts\python publish_trend_backtest.py</code>.
      </p>
    ) : (
      <p className="empty">Not published yet. The 4-hour trend backtest shows here once the bot publishes it.</p>
    );
  }
  const riskUsd = (account.balance * account.risk_percent) / 100;
  return (
    <>
      <p className="perf-about">
        {daily ? "Both daily trend rules" : "The 4-hour breakout rule"} replayed on real gold prices, {day(data.from, tz)} –{" "}
        {day(data.to, tz)}. {data.source}. Each trade risks {account.risk_percent}% of your{" "}
        {money(account.balance).replace(".00", "")} ({money(riskUsd)}), not compounded. On a small standard account most
        of these trades are too big to size at 1%: see &quot;Why a cent account?&quot; in the strategy&apos;s panel.
      </p>
      <p className="perf-check" data-verdict="normal">
        <strong>For comparison, simply holding gold</strong>
        <span>
          {money(data.hold.start)} → {money(data.hold.end)}: +{data.hold.return_pct}% over the same years, with a worst fall
          of {data.hold.worst_drop_pct}% along the way. The {daily ? "rules" : "rule"} made money mostly by being in gold
          during its long rise, and the value is smaller drops, not beating it.
        </span>
      </p>
      {Object.entries(data.rules).map(([id, rule]) => {
        const results: Result[] = rule.trades.map(([t, rr]) => ({ t, usd: rr * riskUsd }));
        const s = stats(results, account.balance, data.from);
        if (!s) return null;
        return (
          <section key={id} className="trend-bt">
            <h3>
              {rule.name}{" "}
              <span>
                {rule.stats.count} trades · held {rule.stats.avg_nights} nights on average · total{" "}
                {(rule.stats.total_r ?? 0) >= 0 ? "+" : ""}
                {rule.stats.total_r}R · worst drop {rule.stats.worst_drop_r}R
              </span>
            </h3>
            <EquityChart points={s.equity} balance={account.balance} tz={tz} />
            {rule.trades.length > 0 && <h4 className="track-title">Paper test vs backtest</h4>}
            {rule.trades.length > 0 && <LiveVsBacktest trades={rule.trades} live={liveRs(tracker, id)} name={rule.name} />}
            <Numbers s={s} />
            <Years s={s} />
          </section>
        );
      })}
    </>
  );
}

export default function Performance({
  my,
  rules,
  tz,
  onClose,
  swing,
  dailyTrend = null,
  h4Trend = null,
}: {
  swing?: SwingPaper | null; // undefined = hide the Swing tab (it's for admins only)
  dailyTrend?: DailyTrendState | null; // the live paper tests, drawn against each backtest
  h4Trend?: DailyTrendState | null;
  my: ReturnType<typeof useMyAccount>;
  rules: LiveState["account"];
  tz: string;
  onClose: () => void;
}) {
  const { account } = my;
  const [tab, setTab] = useState<Tab>("trend");
  const [editing, setEditing] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="perf-backdrop" onClick={onClose}>
      <div
        className="perf"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perf-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="perf-head">
          <h2 id="perf-title">Performance</h2>
          <p>
            Sized for {my.custom ? "your" : "the default"} {money(account.balance).replace(".00", "")} account at{" "}
            {account.risk_percent}% risk per trade.{" "}
            <button type="button" className="link-button" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              {my.custom ? "Change" : "Use your own account"}
            </button>
          </p>
          <button type="button" className="perf-close" ref={closeRef} onClick={onClose} aria-label="Close performance">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {editing && <AccountForm my={my} rules={rules} onDone={() => setEditing(false)} />}

        <div className="journal-periods perf-tabs" role="group" aria-label="Which results">
          <button type="button" aria-pressed={tab === "trend"} onClick={() => setTab("trend")}>
            Daily trend
          </button>
          <button type="button" aria-pressed={tab === "h4"} onClick={() => setTab("h4")}>
            4-hour trend
          </button>
          {swing !== undefined && (
            <button type="button" aria-pressed={tab === "swing"} onClick={() => setTab("swing")}>
              Swing (paper)
            </button>
          )}
        </div>

        {tab === "trend" && <TrendTab key="trend" row="daily_trend_backtest" account={account} tz={tz} tracker={dailyTrend} />}
        {tab === "h4" && <TrendTab key="h4" row="h4_trend_backtest" account={account} tz={tz} tracker={h4Trend} />}
        {tab === "swing" && swing !== undefined && <SwingTab swing={swing ?? null} tz={tz} />}
      </div>
    </div>
  );
}
