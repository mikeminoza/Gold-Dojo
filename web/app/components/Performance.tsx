"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { lotSize, type useMyAccount } from "../lib/account";
import { stats, tradeRows, tradeRs, useBacktest, type Result, type Stats, type TradeRow } from "../lib/performance";
import type { LiveState, SignalEvent, SwingPaper } from "../lib/types";
import AccountForm from "./AccountForm";

type Tab = "live" | "mine" | "analysis" | "backtest" | "swing";

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

const BUCKETS: [string, (r: number) => boolean][] = [
  ["Full loss (−1R)", (r) => r <= -0.9],
  ["Small loss", (r) => r > -0.9 && r < 0],
  ["Small win (0 to +1R)", (r) => r >= 0 && r < 1],
  ["Good win (+1 to +2R)", (r) => r >= 1 && r < 1.9],
  ["Full target (+2R)", (r) => r >= 1.9],
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Breakdown({ title, groups }: { title: string; groups: [string, TradeRow[]][] }) {
  const shown = groups.filter(([, rows]) => rows.length > 0);
  if (shown.length < 2) return null;
  return (
    <table className="results-split perf-years">
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Group</th>
          <th scope="col">Trades</th>
          <th scope="col">Win rate</th>
          <th scope="col">Avg</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {shown.map(([name, rows]) => {
          const total = rows.reduce((a, x) => a + x.r, 0);
          const sign = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;
          return (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{rows.length}</td>
              <td>{Math.round((100 * rows.filter((x) => x.r > 0).length) / rows.length)}%</td>
              <td data-tone={tone(total)}>{sign(total / rows.length)}</td>
              <td data-tone={tone(total)}>{sign(total)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Where the live trades' results land, and how they split by side, weekday, range size and trend. */
function AnalysisTab({ rows }: { rows: TradeRow[] }) {
  if (rows.length === 0) {
    return <p className="empty">No closed trades to analyse yet. This fills in as signals close.</p>;
  }
  const most = Math.max(...BUCKETS.map(([, f]) => rows.filter((x) => f(x.r)).length), 1);
  const by = (key: (x: TradeRow) => string | null, order: string[]) =>
    order.map((name) => [name, rows.filter((x) => key(x) === name)] as [string, TradeRow[]]);
  const withContext = rows.filter((x) => x.rangeAtr !== null).length;
  return (
    <>
      <p className="perf-about">
        Results of the live signals in R (1R = the stop distance, so −1R is a full loss and +2R the full target).
        {rows.length < 30 && ` Only ${rows.length} trades so far: treat the splits below as early hints, not answers.`}
      </p>
      <figure className="r-dist">
        <figcaption>How trades ended</figcaption>
        {BUCKETS.map(([label, f]) => {
          const n = rows.filter((x) => f(x.r)).length;
          return (
            <div key={label} className="r-bar" data-loss={label.includes("loss") || undefined}>
              <span>{label}</span>
              <i style={{ width: `${(100 * n) / most}%` }} aria-hidden />
              <strong>{n}</strong>
            </div>
          );
        })}
      </figure>
      <Breakdown title="By direction" groups={by((x) => (x.side === "BUY" ? "Buy" : "Sell"), ["Buy", "Sell"])} />
      <Breakdown
        title="By weekday"
        groups={by((x) => (x.weekday === null ? null : WEEKDAYS[x.weekday]), WEEKDAYS.slice(0, 5))}
      />
      <Breakdown
        title="By opening-range width"
        groups={by(
          (x) => (x.rangeAtr === null ? null : x.rangeAtr < 1 ? "Narrow (< 1 ATR)" : x.rangeAtr > 2 ? "Wide (> 2 ATR)" : "Normal"),
          ["Narrow (< 1 ATR)", "Normal", "Wide (> 2 ATR)"],
        )}
      />
      <Breakdown
        title="By daily trend strength"
        groups={by(
          (x) => (x.trendPct === null ? null : x.trendPct < 1 ? "Weak (< 1%)" : x.trendPct > 3 ? "Strong (> 3%)" : "Moderate"),
          ["Weak (< 1%)", "Moderate", "Strong (> 3%)"],
        )}
      />
      {withContext < rows.length && (
        <p className="perf-about">
          Range and trend splits use only the {withContext} trades recorded since the bot started saving that
          context.
        </p>
      )}
    </>
  );
}

export default function Performance({
  events,
  my,
  rules,
  tz,
  onClose,
  taken,
  swing,
}: {
  swing?: SwingPaper | null;
  taken: Map<string, number>; // trades you marked "I took this" -> lots
  events: SignalEvent[]; // every signal, already sized for the visitor's account
  my: ReturnType<typeof useMyAccount>;
  rules: LiveState["account"];
  tz: string;
  onClose: () => void;
}) {
  const { account } = my;
  const [tab, setTab] = useState<Tab>("live");
  const [editing, setEditing] = useState(false);
  const { backtest, ready } = useBacktest(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = useMemo(() => {
    const results: Result[] = events
      .filter((e) => e.type === "close" && e.pnl_usd != null)
      .map((e) => ({ t: e.time, usd: e.pnl_usd! }));
    return stats(results, account.balance);
  }, [events, account.balance]);

  const mine = useMemo(() => {
    const results: Result[] = events
      .filter((e) => e.type === "close" && e.trade_id && taken.has(e.trade_id))
      .map((e) => ({ t: e.time, usd: (e.pnl ?? 0) * taken.get(e.trade_id!)! * rules.oz_per_lot }));
    return stats(results, account.balance);
  }, [events, taken, account.balance, rules.oz_per_lot]);

  // Live vs backtest: where the live total R sits among random stretches of the same number of backtest trades
  const check = useMemo(() => {
    const live = tradeRs(events);
    if (!backtest || live.length === 0) return null;
    const pool = backtest.trades.map((k) => k.pnl / Math.abs(k.entry - k.sl)).filter(Number.isFinite);
    if (pool.length < 30) return null;
    let seed = 7; // fixed seed: the same answer on every render
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const n = live.length;
    const total = live.reduce((a, b) => a + b, 0);
    const runs = 2000;
    let below = 0;
    for (let i = 0; i < runs; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += pool[Math.floor(rand() * pool.length)];
      if (sum < total) below++;
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return { n, liveAvg: avg(live), backAvg: avg(pool), percentile: Math.round((100 * below) / runs) };
  }, [events, backtest]);

  const replay = useMemo(() => {
    if (!backtest) return null;
    const results: Result[] = backtest.trades.map((k) => ({
      t: k.x,
      usd: k.pnl * lotSize(k.entry, k.sl, k.tp, account, rules).lots * rules.oz_per_lot,
    }));
    return stats(results, account.balance, backtest.from);
  }, [backtest, account, rules]);

  const shown = tab === "live" ? live : tab === "mine" ? mine : tab === "backtest" ? replay : null;
  const rows = useMemo(() => tradeRows(events, tz), [events, tz]);

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
          <button type="button" aria-pressed={tab === "live"} onClick={() => setTab("live")}>
            Live signals
          </button>
          <button type="button" aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
            My trades
          </button>
          <button type="button" aria-pressed={tab === "analysis"} onClick={() => setTab("analysis")}>
            Analysis
          </button>
          <button type="button" aria-pressed={tab === "backtest"} onClick={() => setTab("backtest")}>
            Backtest{backtest ? `, ${new Date(backtest.from * 1000).getUTCFullYear()}–${new Date(backtest.to * 1000).getUTCFullYear()}` : ""}
          </button>
          <button type="button" aria-pressed={tab === "swing"} onClick={() => setTab("swing")}>
            Swing (paper)
          </button>
        </div>

        {tab === "backtest" && backtest && (
          <p className="perf-about">
            The current strategy ({backtest.strategy.name.toLowerCase()}, {backtest.timeframe}) replayed on{" "}
            {day(backtest.from, tz)} – {day(backtest.to, tz)}. {backtest.source}. Last run{" "}
            {day(backtest.generated, tz)}. A longer test on 23 years of real gold prices found no reliable edge, so
            use these signals for learning and demo trading only.
          </p>
        )}
        {tab === "swing" && <SwingTab swing={swing ?? null} tz={tz} />}
        {tab === "analysis" && <AnalysisTab rows={rows} />}
        {tab === "mine" && (
          <p className="perf-about">
            Only the signals you marked &quot;I took this trade&quot;, at the size you marked them with.
          </p>
        )}
        {tab === "live" && (
          <p className="perf-about">
            Every signal the bot has sent since the journal started, at the sizes this page suggests.
          </p>
        )}
        {tab === "live" && check && (
          <div className="perf-check" data-verdict={check.percentile < 5 ? "worse" : check.percentile > 95 ? "better" : "normal"}>
            <strong>
              {check.percentile < 5
                ? "Worse than the backtest expects"
                : check.percentile > 95
                  ? "Better than the backtest expects"
                  : "Within what the backtest expects"}
            </strong>
            <p>
              Average per trade: {check.liveAvg >= 0 ? "+" : "−"}
              {Math.abs(check.liveAvg).toFixed(2)}R live vs {check.backAvg >= 0 ? "+" : "−"}
              {Math.abs(check.backAvg).toFixed(2)}R in the backtest. Over {check.n} trades, the live total beats{" "}
              {check.percentile}% of random {check.n}-trade stretches from the backtest
              {check.percentile < 5
                ? ": something may differ live (prices, timing or costs). Worth a closer look."
                : check.percentile > 95
                  ? ": a lucky run, or live conditions are kinder than the test assumed."
                  : ": normal ups and downs."}
              {check.n < 20 && " With under 20 trades this says little yet."}
            </p>
          </div>
        )}

        {shown ? (
          <>
            <EquityChart points={shown.equity} balance={account.balance} tz={tz} />
            <Numbers s={shown} />
            <Years s={shown} />
          </>
        ) : tab === "swing" || tab === "analysis" ? null : tab === "live" ? (
          <p className="empty">No closed trades yet. Results appear here after the first signal closes.</p>
        ) : tab === "mine" ? (
          <p className="empty">
            None yet. Press &quot;I took this trade&quot; on a signal you trade, and its result shows here once it
            closes.
          </p>
        ) : !ready ? (
          <p className="empty">Loading the backtest…</p>
        ) : (
          <p className="empty">
            No backtest published yet. On the bot&apos;s PC run <code>.venv\Scripts\python publish_backtest.py</code>.
          </p>
        )}
      </div>
    </div>
  );
}
