"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { lotSize, type useMyAccount } from "../lib/account";
import { stats, useBacktest, type Result, type Stats } from "../lib/performance";
import type { LiveState, SignalEvent } from "../lib/types";
import AccountForm from "./AccountForm";

type Tab = "live" | "backtest";

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

export default function Performance({
  events,
  my,
  rules,
  tz,
  onClose,
}: {
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

  const replay = useMemo(() => {
    if (!backtest) return null;
    const results: Result[] = backtest.trades.map((k) => ({
      t: k.x,
      usd: k.pnl * lotSize(k.entry, k.sl, k.tp, account, rules).lots * rules.oz_per_lot,
    }));
    return stats(results, account.balance, backtest.from);
  }, [backtest, account, rules]);

  const shown = tab === "live" ? live : replay;

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
          <button type="button" aria-pressed={tab === "backtest"} onClick={() => setTab("backtest")}>
            Backtest{backtest ? `, ${new Date(backtest.from * 1000).getUTCFullYear()}–${new Date(backtest.to * 1000).getUTCFullYear()}` : ""}
          </button>
        </div>

        {tab === "backtest" && backtest && (
          <p className="perf-about">
            The current strategy ({backtest.strategy.name.toLowerCase()}, {backtest.timeframe}) replayed on{" "}
            {day(backtest.from, tz)} – {day(backtest.to, tz)}. {backtest.source}. Past results don&apos;t
            promise future ones. Last run {day(backtest.generated, tz)}.
          </p>
        )}
        {tab === "live" && (
          <p className="perf-about">
            Every signal the bot has sent since the journal started, at the sizes this page suggests.
          </p>
        )}

        {shown ? (
          <>
            <EquityChart points={shown.equity} balance={account.balance} tz={tz} />
            <Numbers s={shown} />
            <Years s={shown} />
          </>
        ) : tab === "live" ? (
          <p className="empty">No closed trades yet. Results appear here after the first signal closes.</p>
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
