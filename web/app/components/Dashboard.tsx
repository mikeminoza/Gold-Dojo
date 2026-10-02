"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LiveState, Position, Side, SignalEvent, Sizing, TradeWindow } from "../lib/types";
import type { Theme } from "./TradingChart";
import { useBotState } from "../lib/useBotState";
import { useLivePrice, type LivePrice } from "../lib/useLivePrice";
import { useMyTrades } from "../lib/useMyTrades";
import { useChat, type ChatMessage } from "../lib/useChat";
import { journalCsv, useJournal, type JournalEntry } from "../lib/useJournal";
import { adoptProfileAccount, sizeEvents, sizePosition, useMyAccount } from "../lib/account";
import AccountForm from "./AccountForm";
import ChatPanel from "./ChatPanel";
import Performance from "./Performance";

const TradingChart = dynamic(() => import("./TradingChart"), { ssr: false });

// The bot checks in every 15 s even when nothing changes. Allow a missed check-in or two before
// worrying, and call it offline only after a restart would normally have finished (1-2 min).
const LATE_AFTER_S = 60;
const OFFLINE_AFTER_S = 180;

// config.py's account settings, used until the bot's first update arrives
const DEFAULT_RULES: LiveState["account"] = { balance: 500, risk_percent: 1, max_risk_percent: 2, oz_per_lot: 100, min_lot: 0.01 };

const price = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

/** 12-hour time in a time zone, e.g. "3:00 PM" or "3:00:15 PM". */
function clock12(t: number, tz: string, seconds = false) {
  return new Date(t * 1000).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: true,
  });
}

/** Time formatters for the bot's display time zone (PH time), whatever the viewer's own clock says. */
function timeFormat(tz: string, short = "PH") {
  const dateKey = (t: number) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz });
  return {
    /** "8:30 PM PH" - for times written into sentences */
    hhmm: (t: number) => `${clock12(t, tz)} ${short}`,
    /** "8:30 PM" - where the time zone is already stated nearby */
    bare: (t: number) => clock12(t, tz),
    /** "8:30:15 PM" - for lists that say their time zone in the heading */
    clock: (t: number) => clock12(t, tz, true),
    /** "Mon 8:30 PM" when not today, else "8:30:15 PM" */
    stamp: (t: number, now: number) =>
      dateKey(t) === dateKey(now)
        ? clock12(t, tz, true)
        : `${new Date(t * 1000).toLocaleDateString("en-US", { timeZone: tz, weekday: "short" })} ${clock12(t, tz)}`,
    /** "Today", "Tomorrow" or a weekday name */
    day: (t: number, now: number) => {
      if (dateKey(t) === dateKey(now)) return "Today";
      if (dateKey(t) === dateKey(now + 86400)) return "Tomorrow";
      return new Date(t * 1000).toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
    },
  };
}

/** "3h 42m", "12m", "45s" */
function countdown(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
type TimeFormat = ReturnType<typeof timeFormat>;

function ago(seconds: number) {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

/** The bot's state with the browser's live price on top; an open trade's P/L follows the live price. */
function withLivePrice(state: LiveState, live: LivePrice | null): LiveState {
  if (!live) return state;
  const pos = state.position;
  if (!pos) return { ...state, bid: live.bid, ask: live.ask };
  const exit = pos.side === "BUY" ? live.bid : live.ask;
  const pnl = pos.side === "BUY" ? exit - pos.entry : pos.entry - exit;
  const lots = pos.size?.lots;
  return {
    ...state,
    bid: live.bid,
    ask: live.ask,
    position: { ...pos, pnl, pnl_usd: lots ? pnl * lots * (state.account?.oz_per_lot ?? 100) : pos.pnl_usd },
  };
}

/** Dark / light theme. The head script in layout.tsx applies the saved choice before the page paints. */
function useTheme() {
  // The <html data-theme> attribute is the source of truth; re-render whenever it changes
  const theme = useSyncExternalStore<Theme>(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark",
  );
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("gold-theme", next);
    } catch {
      // storage unavailable - the choice just won't be remembered
    }
  };
  return { theme, toggle };
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const toLight = theme === "dark";
  return (
    <button type="button" className="theme-toggle" onClick={onToggle} aria-label={`Switch to ${toLight ? "light" : "dark"} theme`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        {toLight ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" />
          </>
        ) : (
          <path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z" />
        )}
      </svg>
      {toLight ? "Light" : "Dark"}
    </button>
  );
}

/** The signed-in member's display name and role; also applies the account size saved on their profile. */
function useMe() {
  const [me, setMe] = useState<{ name: string; role: "admin" | "member" } | null>(null);
  useEffect(() => {
    let stopped = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (stopped || !d?.name) return;
        setMe({ name: d.name, role: d.role });
        adoptProfileAccount(d.account ?? null);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
  return me;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function chime(side: Side, closing: boolean) {
  const ctx = new AudioContext();
  const notes = closing ? [660, 440] : side === "BUY" ? [523, 784] : [784, 523];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    const start = ctx.currentTime + i * 0.16;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    osc.start(start);
    osc.stop(start + 0.16);
  });
  setTimeout(() => ctx.close(), 800);
}

/** Profit, loss or break-even for a result in $ per oz. `live` words it for a trade that's still open. */
function outcome(pnl: number, live = false) {
  if (Math.abs(pnl) < 0.005) return { tone: "even", label: "Break-even" };
  if (pnl > 0) return { tone: "profit", label: live ? "In profit" : "Profit" };
  return { tone: "loss", label: live ? "In loss" : "Loss" };
}

/** Result for 1 standard lot (100 oz), e.g. "+$394". */
const perLot = (pnl: number) =>
  `${pnl >= 0 ? "+" : "−"}$${Math.round(Math.abs(pnl * 100)).toLocaleString("en-US")}`;

/** Account money, e.g. "$5.20", or signed "+$5.20" / "−$5.20". */
const usd = (n: number, sign = false) =>
  `${sign ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Result line for a trade: money at the suggested size when known, else per oz and per lot. */
function resultText(pnl: number, pnlUsd: number | null | undefined, lots: number | null | undefined) {
  return pnlUsd != null && lots
    ? `${usd(pnlUsd, true)} at ${lots.toFixed(2)} lot (${signed(pnl)} per oz)`
    : `${signed(pnl)} per oz, ${perLot(pnl)} on 1 lot`;
}

function SizeAdvice({ size }: { size: Sizing }) {
  return (
    <div className="size" data-verdict={size.verdict}>
      <p>
        Suggested size <strong>{size.lots.toFixed(2)} lot</strong>
      </p>
      <p>
        Risk {usd(size.risk)} ({size.risk_percent.toFixed(1)}%), target {usd(size.reward)}
      </p>
      {size.verdict !== "ok" && <p className="size-note">{size.note}</p>}
    </div>
  );
}

/** A short, soft two-note "pop" for chat messages (different from the trade-signal chime). */
function chatSound() {
  try {
    const ctx = new AudioContext();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain).connect(ctx.destination);
      const start = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.start(start);
      osc.stop(start + 0.13);
    });
    setTimeout(() => ctx.close(), 500);
  } catch {
    // audio blocked until the page has been clicked once; the pop-up still shows
  }
}

function describe(e: SignalEvent) {
  return e.type === "open"
    ? `${e.side === "BUY" ? "Buy" : "Sell"} at ${price(e.price)}`
    : `${outcome(e.pnl ?? 0).label}: closed ${e.side === "BUY" ? "buy" : "sell"} at ${price(e.price)}, ` +
        `${signed(e.pnl ?? 0)} per oz`;
}

/** Alerts (sound + browser notification) whenever a new signal event arrives. */
function useSignalAlerts(history: SignalEvent[] | undefined, enabled: boolean) {
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!history) return;
    const latest = history[0]?.id ?? null;
    if (seen.current === undefined) {
      seen.current = latest; // first load: don't alert on old signals
      return;
    }
    if (latest === seen.current || !history[0]) return;
    seen.current = latest;
    if (!enabled) return;
    const e = history[0];
    chime(e.side, e.type === "close");
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(e.type === "open" ? `${e.side} gold` : "Signal closed", { body: describe(e) });
    }
  }, [history, enabled]);
}

function Ladder({ position, bid, ask }: { position: Position; bid: number; ask: number }) {
  const { side, entry, sl, tp } = position;
  const now = side === "BUY" ? bid : ask;
  // 0 = stop loss, 1 = take profit, whichever direction the trade runs
  const progress = (p: number) => Math.min(1, Math.max(0, (p - sl) / (tp - sl)));
  const reward = Math.abs(tp - entry);
  const risk = Math.abs(entry - sl);

  return (
    <div className="ladder" aria-label="Where price is between stop loss and take profit">
      <div className="ladder-end target">
        <span>Take profit</span>
        <strong>{price(tp)}</strong>
        <em>+{reward.toFixed(2)}</em>
      </div>
      <div className="ladder-rail">
        <div className="ladder-fill" style={{ height: `${progress(now) * 100}%` }} data-winning={position.pnl >= 0} />
        <div className="ladder-mark entry" style={{ bottom: `${progress(entry) * 100}%` }}>
          <span>Entry {price(entry)}</span>
        </div>
        <div className="ladder-mark now" style={{ bottom: `${progress(now) * 100}%` }}>
          <span>{price(now)}</span>
        </div>
      </div>
      <div className="ladder-end stop">
        <span>Stop loss</span>
        <strong>{price(sl)}</strong>
        <em>−{risk.toFixed(2)}</em>
      </div>
    </div>
  );
}

function Checklist({ state }: { state: LiveState }) {
  return (
    <div className="checklist">
      <p className="checklist-intro">{state.strategy.summary}</p>
      {(["BUY", "SELL"] as const).map((side) => {
        const items = state.conditions[side];
        const ready = items.filter((c) => c.ok).length;
        return (
          <section key={side} className="checklist-side" data-side={side}>
            <h3>
              {side === "BUY" ? "Next buy" : "Next sell"}
              <span>
                {ready} of {items.length} ready
              </span>
            </h3>
            <ul>
              {items.map((c) => (
                <li key={c.label} data-ok={c.ok}>
                  <span aria-hidden>{c.ok ? "✓" : "–"}</span>
                  {c.label}
                  <span className="sr-only">{c.ok ? "(met)" : "(not met)"}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Headline under "Wait": what's happening now, and a highlighted countdown to the next session. */
function WaitingStatus({ state, now }: { state: LiveState; now: number }) {
  const next = state.windows[0];
  const idle = !next || next.state === "later";
  const start = next ? (next.range_start ?? next.first_entry) : 0;
  return (
    <div className="waiting">
      <p className="waiting-headline">{idle ? "No session open right now" : state.session.message}</p>
      {idle && next && (
        <p className="next-up">
          <span>Next up</span>
          <strong>
            {next.name} opens in {countdown(start - now)}
          </strong>
        </p>
      )}
    </div>
  );
}

function sessionStatus(w: TradeWindow, now: number) {
  if (w.traded) return { tone: "done", text: "Traded" };
  if (w.state === "range") return { tone: "soon", text: "Marking range" };
  if (w.state === "trading") return now <= w.last_entry ? { tone: "live", text: "Open now" } : { tone: "done", text: "Closing" };
  return { tone: "later", text: `In ${countdown((w.range_start ?? w.first_entry) - now)}` };
}

/** The current and next sessions, in PH time, with each exchange's own time underneath. */
function SessionSchedule({ state, now, t }: { state: LiveState; now: number; t: TimeFormat }) {
  if (state.windows.length === 0) return null;
  return (
    <section className="schedule" aria-label="Trading sessions">
      <h2>
        Sessions <span>{state.display.label}</span>
      </h2>
      <ul>
        {state.windows.map((w) => {
          const start = w.range_start ?? w.first_entry;
          const end = w.close ?? w.last_entry;
          const status = sessionStatus(w, now);
          return (
            <li key={`${w.name}-${start}`} data-tone={status.tone}>
              <div className="schedule-main">
                <strong>{w.name}</strong>
                <span className="schedule-time">
                  {t.bare(start)} – {t.bare(end)}
                </span>
              </div>
              <div className="schedule-sub">
                <span>
                  {t.day(start, now)}
                  {w.tz && ` · ${clock12(start, w.tz)} ${w.name} time`}
                </span>
                <span className="schedule-pill">{status.text}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Totals over the closed trades the page knows about (the bot keeps the most recent ones). */
function Results({ events, balance }: { events: SignalEvent[]; balance: number }) {
  const closed = events.filter((e) => e.type === "close");
  if (closed.length === 0) return null;
  const pnls = closed.map((e) => e.pnl ?? 0);
  const wins = pnls.filter((p) => outcome(p).tone === "profit").length;
  const losses = pnls.filter((p) => outcome(p).tone === "loss").length;
  const net = pnls.reduce((a, b) => a + b, 0);
  // Money totals only when every closed trade carries its suggested size
  const sized = closed.every((e) => e.pnl_usd != null);
  const netUsd = sized ? closed.reduce((a, e) => a + (e.pnl_usd ?? 0), 0) : null;
  const o = outcome(netUsd ?? net);
  return (
    <div className="results">
      <p className="results-net">
        <span className="outcome" data-tone={o.tone}>
          {o.tone === "even" ? "Break-even overall" : `Net ${o.label.toLowerCase()}`}
        </span>
        {netUsd !== null ? (
          <>
            <strong data-tone={o.tone}>{usd(netUsd, true)}</strong>
            <span>
              {netUsd >= 0 ? "+" : "−"}
              {Math.abs((100 * netUsd) / balance).toFixed(1)}% of the account at the suggested sizes
            </span>
          </>
        ) : (
          <>
            <strong data-tone={o.tone}>{signed(net)} per oz</strong>
            <span>{perLot(net)} on 1 lot</span>
          </>
        )}
      </p>
      <dl>
        <div>
          <dt>Closed trades</dt>
          <dd>{closed.length}</dd>
        </div>
        <div>
          <dt>Profit</dt>
          <dd data-tone="profit">{wins}</dd>
        </div>
        <div>
          <dt>Loss</dt>
          <dd data-tone="loss">{losses}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{Math.round((100 * wins) / closed.length)}%</dd>
        </div>
        <div>
          <dt>Profit factor</dt>
          <dd title="Money won divided by money lost. Above 1 means profitable.">{profitFactor(closed)}</dd>
        </div>
      </dl>
      <SessionSplit closed={closed} />
    </div>
  );
}

/** Money won / money lost; above 1 means the trades made money overall. */
function profitFactor(closed: SignalEvent[]) {
  const value = (e: SignalEvent) => e.pnl_usd ?? e.pnl ?? 0;
  const won = closed.filter((e) => value(e) > 0).reduce((a, e) => a + value(e), 0);
  const lost = -closed.filter((e) => value(e) < 0).reduce((a, e) => a + value(e), 0);
  if (lost === 0) return won > 0 ? "∞" : "–";
  return (won / lost).toFixed(2);
}

/** Results per session (e.g. London vs New York), when trades came from more than one. */
function SessionSplit({ closed }: { closed: SignalEvent[] }) {
  const groups = new Map<string, SignalEvent[]>();
  for (const e of closed) {
    const key = e.session ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  if (groups.size < 2) return null;
  return (
    <table className="results-split">
      <caption>By session</caption>
      <thead>
        <tr>
          <th scope="col">Session</th>
          <th scope="col">Trades</th>
          <th scope="col">Win rate</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {[...groups].map(([name, list]) => {
          const net = list.reduce((a, e) => a + (e.pnl_usd ?? e.pnl ?? 0), 0);
          const wins = list.filter((e) => (e.pnl_usd ?? e.pnl ?? 0) > 0).length;
          return (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{list.length}</td>
              <td>{Math.round((100 * wins) / list.length)}%</td>
              <td data-tone={net > 0 ? "profit" : net < 0 ? "loss" : undefined}>{usd(net, true)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Period = "week" | "month" | "all";
const PERIODS: [Period, string][] = [
  ["week", "This week"],
  ["month", "This month"],
  ["all", "All time"],
];

/** Start of this week (Monday) or month, in the display time zone, as UTC seconds. */
function periodStart(period: Period, now: number, offset: number) {
  if (period === "all") return 0;
  const local = now + offset;
  if (period === "week") {
    const day = Math.floor(local / 86400);
    const sinceMonday = (day + 3) % 7; // 1 Jan 1970 was a Thursday
    return (day - sinceMonday) * 86400 - offset;
  }
  const d = new Date(local * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 - offset;
}

function fromJournal(e: JournalEntry, account: LiveState["account"]): SignalEvent {
  const riskPercent = e.risk != null ? (100 * e.risk) / account.balance : 0;
  return {
    id: e.event_id,
    type: e.type,
    side: e.side,
    price: e.price,
    time: Date.parse(e.created_at) / 1000,
    sl: e.sl ?? undefined,
    tp: e.tp ?? undefined,
    entry: e.entry ?? undefined,
    pnl: e.pnl ?? undefined,
    pnl_usd: e.pnl_usd,
    lots: e.lots,
    reason: e.reason ?? undefined,
    session: e.session ?? undefined,
    trade_id: e.trade_id,
    size:
      e.type === "open" && e.lots != null
        ? {
            lots: e.lots,
            risk: e.risk ?? 0,
            reward: 0,
            risk_percent: riskPercent,
            verdict: riskPercent > account.max_risk_percent ? "skip" : "ok",
            note: "",
          }
        : undefined,
  };
}

/**
 * Every signal ever recorded (the journal in Supabase), with results for a chosen period and a CSV
 * download. Falls back to the bot's recent history until the journal table exists.
 */
function Journal({
  journal,
  all,
  balance,
  state,
  t,
  now,
  onReplay,
  myTrades,
}: {
  onReplay: (e: SignalEvent) => void;
  myTrades: MyTrades;
  journal: ReturnType<typeof useJournal>;
  all: SignalEvent[]; // every signal, sized for the visitor's account
  balance: number;
  state: LiveState;
  t: TimeFormat;
  now: number;
}) {
  const [period, setPeriod] = useState<Period>("all");
  const usingJournal = journal.available && journal.entries.length > 0;
  const since = periodStart(period, now, state.display.offset);
  const events = all.filter((e) => e.time >= since);

  function download() {
    const csv = journalCsv(journal.entries, state.display.tz);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `golden-skibidi-signals-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <div className="journal-bar">
        <div className="journal-periods" role="group" aria-label="Period">
          {PERIODS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>
              {label}
            </button>
          ))}
        </div>
        {usingJournal && (
          <button type="button" className="journal-csv" onClick={download}>
            Download CSV
          </button>
        )}
      </div>
      {!journal.available && (
        <p className="note">
          Showing recent signals only. Run <code>supabase/signals.sql</code> in Supabase to keep every signal
          permanently.
        </p>
      )}
      <Results events={events} balance={balance} />
      <History
        events={events.slice(0, 50)}
        t={t}
        now={now}
        onReplay={onReplay}
        symbol={state.symbol}
        myTrades={myTrades}
        ozPerLot={state.account.oz_per_lot}
      />
    </>
  );
}

/** This week's major US releases by day, in PH time; signals pause around each one. */
function NewsWeek({ state, t, now }: { state: LiveState; t: TimeFormat; now: number }) {
  const events = state.news_week;
  if (!events) return null;
  const pause = (state.news_pause_minutes ?? 30) * 60;
  const days = new Map<string, { time: number; title: string }[]>();
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    const day = t.day(e.time, now);
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return (
    <section className="side-block">
      <h2>
        Major US news this week <span className="tz-note">{state.display.label}</span>
      </h2>
      {events.length === 0 ? (
        <p className="empty">No high-impact US releases on the calendar this week.</p>
      ) : (
        <>
          <ol className="news-week">
            {[...days].map(([day, list]) => (
              <li key={day}>
                <h3>{day}</h3>
                <ul>
                  {list.map((e) => {
                    const status = now > e.time + pause ? "past" : now >= e.time - pause ? "now" : "soon";
                    return (
                      <li key={`${e.time}-${e.title}`} data-status={status}>
                        <time>{t.bare(e.time)}</time>
                        <span>{e.title}</span>
                        {status === "now" && <em>Signals paused</em>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          <p className="note">
            New signals pause {state.news_pause_minutes ?? 30} minutes before and after each release. Source: Forex
            Factory calendar.
          </p>
        </>
      )}
    </section>
  );
}

type MyTrades = ReturnType<typeof useMyTrades>;

/** Copy the trade's levels for pasting into MT5, and mark whether you took it. */
function TradeActions({
  tradeId,
  symbol,
  side,
  entry,
  sl,
  tp,
  lots,
  myTrades,
  children,
}: {
  tradeId?: string | null;
  symbol: string;
  side: Side;
  entry: number;
  sl: number;
  tp: number;
  lots?: number;
  myTrades: MyTrades;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const took = tradeId ? myTrades.taken.get(tradeId) : undefined;
  const copy = () => {
    const text = [
      `${side} ${symbol}${lots ? ` ${lots.toFixed(2)} lot` : ""}`,
      `Entry ${price(entry)}`,
      `Stop loss ${price(sl)}`,
      `Take profit ${price(tp)}`,
    ].join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  return (
    <div className="trade-actions">
      <button type="button" onClick={copy}>
        {copied ? "Copied ✓" : "Copy levels"}
      </button>
      {tradeId &&
        myTrades.available &&
        (took ? (
          <button type="button" aria-pressed="true" onClick={() => void myTrades.mark(tradeId, null)} title="Undo">
            ✓ You took this ({took.toFixed(2)} lot)
          </button>
        ) : (
          <button type="button" onClick={() => void myTrades.mark(tradeId, lots ?? 0.01)}>
            I took this trade
          </button>
        ))}
      {children}
    </div>
  );
}

function ReplayButton({ e, onReplay }: { e: SignalEvent; onReplay?: (e: SignalEvent) => void }) {
  if (!onReplay) return null;
  return (
    <button type="button" className="history-replay" onClick={() => onReplay(e)}>
      Show on chart
    </button>
  );
}

function History({
  events,
  t,
  now,
  onReplay,
  symbol,
  myTrades,
  ozPerLot,
}: {
  events: SignalEvent[];
  t: TimeFormat;
  now: number;
  onReplay?: (e: SignalEvent) => void;
  symbol: string;
  myTrades: MyTrades;
  ozPerLot: number;
}) {
  if (events.length === 0) {
    return <p className="empty">No signals in this period. They&apos;ll appear here as soon as the bot sends one.</p>;
  }
  return (
    <ol className="history">
      {events.map((e) => {
        if (e.type === "open") {
          return (
            <li key={e.id} data-type="open" data-side={e.side}>
              <time>{t.stamp(e.time, now)}</time>
              <span className="history-what">{describe(e)}</span>
              <span className="history-detail">
                {e.reason ? `${e.reason}. ` : ""}Stop {price(e.sl!)}, target {price(e.tp!)}
                {e.size && `. ${e.size.lots.toFixed(2)} lot, risk ${usd(e.size.risk)}`}
                {e.size && e.size.verdict === "skip" && " (above your risk limit)"}
              </span>
              <TradeActions
                tradeId={e.trade_id ?? e.id}
                symbol={symbol}
                side={e.side}
                entry={e.price}
                sl={e.sl!}
                tp={e.tp!}
                lots={e.size?.lots}
                myTrades={myTrades}
              >
                <ReplayButton e={e} onReplay={onReplay} />
              </TradeActions>
            </li>
          );
        }
        const pnl = e.pnl ?? 0;
        const o = outcome(pnl);
        const mine = e.trade_id ? myTrades.taken.get(e.trade_id) : undefined;
        return (
          <li key={e.id} data-type="close" data-outcome={o.tone}>
            <time>{t.stamp(e.time, now)}</time>
            <span className="history-what">
              <span className="outcome" data-tone={o.tone}>
                {o.label}
              </span>
              {resultText(pnl, e.pnl_usd, e.lots)}
            </span>
            <span className="history-detail">
              {e.side === "BUY" ? "Buy" : "Sell"} closed at {price(e.price)}
              {e.reason ? `, ${e.reason.toLowerCase()}` : ""}
            </span>
            {mine && (
              <span className="history-mine" data-tone={o.tone}>
                You took it: {usd(pnl * mine * ozPerLot, true)} at {mine.toFixed(2)} lot
              </span>
            )}
            <ReplayButton e={e} onReplay={onReplay} />
          </li>
        );
      })}
    </ol>
  );
}

export default function Dashboard() {
  const { state: botState, connected, missing, configured, seenAt } = useBotState();
  const live = useLivePrice();
  const now = useNow();
  const me = useMe();
  const rules = botState?.account ?? DEFAULT_RULES;
  const my = useMyAccount(rules);
  const { account } = my;
  // The bot's state with the live price on top, and the open trade sized for this visitor's account
  const state = useMemo(() => {
    if (!botState) return null;
    const s = withLivePrice(botState, live);
    return s.position && s.account ? { ...s, position: sizePosition(s.position, account, s.account) } : s;
  }, [botState, live, account]);
  const journal = useJournal();
  const myTrades = useMyTrades();
  const signals = useMemo(() => {
    if (!botState?.account) return [];
    const usingJournal = journal.available && journal.entries.length > 0;
    const all = usingJournal ? journal.entries.map((e) => fromJournal(e, botState.account)) : (botState.history ?? []);
    return sizeEvents(all, account, botState.account);
  }, [journal.available, journal.entries, botState, account]);
  const [perfOpen, setPerfOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // the header's menu on phones and tablets
  const [accountOpen, setAccountOpen] = useState(false);
  const closePerf = useCallback(() => setPerfOpen(false), []);
  const [replay, setReplay] = useState<{ open: SignalEvent; close?: SignalEvent; label: string } | null>(null);
  /** Show a past trade on the chart: its open, close, entry / stop / target. */
  const showTrade = (e: SignalEvent) => {
    const tradeId = e.type === "open" ? (e.trade_id ?? e.id) : e.trade_id;
    const open = e.type === "open" ? e : signals.find((x) => x.type === "open" && (x.trade_id ?? x.id) === tradeId);
    if (!open) return;
    const close = signals.find((x) => x.type === "close" && x.trade_id === (open.trade_id ?? open.id));
    const side = open.side === "BUY" ? "Buy" : "Sell";
    const result = close
      ? `${outcome(close.pnl ?? 0).label} ${close.pnl_usd != null ? usd(close.pnl_usd, true) : `${signed(close.pnl ?? 0)} per oz`}`
      : "still open";
    setReplay({ open, close, label: `${side} at ${price(open.price)}, ${result}` });
    document.querySelector(".chart-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const [alerts, setAlerts] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chartTf, setChartTf] = useState<string | null>(null); // the timeframe picked on the chart
  const [toast, setToast] = useState<{ id: number; author: string; room: string; roomId: string; body: string } | null>(
    null,
  );
  const onIncoming = useCallback((m: ChatMessage, room: string) => {
    setToast({ id: m.id, author: m.author, room, roomId: m.room_id, body: m.body });
    chatSound();
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification(`${m.author} in ${room}`, { body: m.body.slice(0, 140), tag: `chat-${m.room_id}` });
      n.onclick = () => window.focus();
    }
  }, []);
  const chat = useChat(chatOpen, onIncoming);

  // The pop-up preview disappears after a few seconds
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  function openChat(roomId?: string) {
    if (roomId) chat.openRoom(roomId);
    else chat.markRead();
    setToast(null);
    setChatOpen(true);
    // Ask once for desktop notifications, while the person is clicking (browsers require that)
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }
  const { theme, toggle: toggleTheme } = useTheme();
  const prevBid = useRef<number | null>(null);
  const [tickDir, setTickDir] = useState<"up" | "down" | null>(null);

  useSignalAlerts(state?.history, alerts);

  useEffect(() => {
    if (!state) return;
    if (prevBid.current !== null && state.bid !== prevBid.current) {
      setTickDir(state.bid > prevBid.current ? "up" : "down");
    }
    prevBid.current = state.bid;
  }, [state]);

  const position = state?.position ?? null;
  const word = position ? (position.side === "BUY" ? "Buy" : "Sell") : "Wait";

  useEffect(() => {
    if (state) {
      const unread = chat.totalUnread ? `(${chat.totalUnread}) ` : "";
      document.title = `${unread}${word} · ${price(state.bid)} · Golden Skibidi`;
    }
  }, [word, state, chat.totalUnread]);

  async function toggleAlerts() {
    if (!alerts && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (!alerts) chime("BUY", false); // also unlocks audio in the browser
    setAlerts(!alerts);
  }

  // Seconds since this browser last received a new update from the bot (see useBotState)
  const lastSeen = seenAt !== null ? Math.max(0, now - seenAt / 1000) : 0;
  const status = !connected
    ? { tone: "wait", text: "Connecting…" }
    : missing || !botState
      ? { tone: "off", text: "Waiting for the bot" }
      : lastSeen > OFFLINE_AFTER_S
        ? { tone: "off", text: `Bot offline, last seen ${ago(lastSeen)}` }
        : lastSeen > LATE_AFTER_S
          ? { tone: "wait", text: "Bot restarting…" }
          : { tone: "live", text: "Live" };

  if (!configured) {
    return (
      <main className="page">
        <div className="setup">
          <h1>Connect Supabase</h1>
          <p>
            This site reads the bot&apos;s signals from Supabase. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>web/.env.local</code> (on this PC) or to the Vercel
            project&apos;s Environment Variables, then reload.
          </p>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="page">
        <div className="setup">
          <h1>Waiting for the bot</h1>
          <p>
            The bot hasn&apos;t sent anything to Supabase yet. On your PC, check that <code>.env</code> has{" "}
            <code>SUPABASE_URL</code> and <code>SUPABASE_SECRET_KEY</code>, then from the <code>trading-bot</code>{" "}
            folder run:
          </p>
          <pre>.venv\Scripts\python bot.py</pre>
          <p>This page updates on its own as soon as the bot starts.</p>
        </div>
      </main>
    );
  }

  if (!state.strategy || !state.windows || !state.account || !state.chart) {
    return (
      <main className="page">
        <div className="setup">
          <h1>Restart the bot</h1>
          <p>
            The running bot is an older version than this page. Stop it with Ctrl+C in its terminal, then start it
            again:
          </p>
          <pre>.venv\Scripts\python bot.py</pre>
        </div>
      </main>
    );
  }

  const t = timeFormat(state.display.tz, state.display.short);
  const { hhmm } = t;
  const spread = state.ask - state.bid;

  return (
    <main className="terminal" data-signal={position?.side ?? "WAIT"}>
      {state.demo && (
        <p className="demo-banner">Demo prices. These signals are random and only for trying out the page.</p>
      )}

      <header className="topbar">
        <div className="instrument">
          <strong>Golden Skibidi</strong>
          <span>
            {state.symbol}, {chartTf ?? state.chart.default} chart
            <span className="instrument-strategy">
              Signals: {state.strategy.name.toLowerCase()} on {state.timeframe} candles
            </span>
          </span>
        </div>
        <div className="topbar-quote">
          <p className="bid" data-tick={tickDir} key={state.bid}>
            {price(state.bid)}
          </p>
          <dl>
            <div>
              <dt>Ask</dt>
              <dd>{price(state.ask)}</dd>
            </div>
            <div>
              <dt>Spread</dt>
              <dd>{spread.toFixed(2)}</dd>
            </div>
          </dl>
        </div>
        <div className="status" data-tone={status.tone} role="status">
          <i aria-hidden />
          {status.text}
        </div>
        <button
          type="button"
          className="theme-toggle topbar-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="topbar-actions"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            {menuOpen ? <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /> : <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />}
          </svg>
          Menu
        </button>
        <nav id="topbar-actions" className="topbar-actions" data-open={menuOpen} aria-label="Site">
        <a className="theme-toggle" href="/how">
          How it works
        </a>
        <button type="button" className="theme-toggle" aria-haspopup="dialog" onClick={() => setPerfOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M2 13.5h12M3 11l3.5-4 3 2.5L14 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Performance
        </button>
        <button type="button" className="alert-toggle" aria-pressed={alerts} onClick={toggleAlerts}>
          {alerts ? "Sound alerts on" : "Turn on sound alerts"}
        </button>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        {me && (
          <a className="theme-toggle" href="/profile" title="Your profile: display name and account size">
            {me.name}
          </a>
        )}
        {me?.role === "admin" && (
          <a className="theme-toggle" href="/admin">
            Members
          </a>
        )}
        <form method="post" action="/auth/signout">
          <button type="submit" className="theme-toggle">
            Sign out
          </button>
        </form>
        </nav>
      </header>

      <div className="workspace">
        <section className="chart-panel" aria-label="Price chart">
          <TradingChart
            key={theme}
            theme={theme}
            symbol={state.symbol}
            bid={state.bid}
            priceTime={live?.time ?? state.updated}
            gap={live?.gapReady ? live.gap : null}
            tzLabel={state.display.label}
            timeframes={state.chart.timeframes}
            defaultTf={state.chart.default}
            offset={state.display.offset}
            history={state.history}
            range={state.range}
            position={position}
            periods={state.indicators.periods}
            onTimeframe={setChartTf}
            replay={replay}
            onExitReplay={() => setReplay(null)}
          />
        </section>

        <aside className="sidebar">
          <section className="signal-card" aria-live="polite">
            <h1 className="signal-word" key={word}>
              {word}
            </h1>
            {position ? (
              <div className="signal-detail">
                <span className="outcome" data-tone={outcome(position.pnl, true).tone}>
                  {outcome(position.pnl, true).label}
                </span>
                {position.size && position.pnl_usd != null ? (
                  <p className="pnl" data-winning={position.pnl >= 0}>
                    {usd(position.pnl_usd, true)}{" "}
                    <small>
                      at {position.size.lots.toFixed(2)} lot ({signed(position.pnl)} per oz)
                    </small>
                  </p>
                ) : (
                  <p className="pnl" data-winning={position.pnl >= 0}>
                    {signed(position.pnl)} <small>per oz</small>
                  </p>
                )}
                <p>
                  {position.reason ? `${position.reason}. ` : ""}
                  {position.side === "BUY" ? "Bought" : "Sold"} at {price(position.entry)}, {ago(now - position.opened)}.
                  {!position.size && ` On 1 lot that's ${perLot(position.pnl)}.`}
                  {position.expires ? ` Closes at ${hhmm(position.expires)} if still open.` : ""}
                </p>
                {position.size && <SizeAdvice size={position.size} />}
                <TradeActions
                  tradeId={position.trade_id}
                  symbol={state.symbol}
                  side={position.side}
                  entry={position.entry}
                  sl={position.sl}
                  tp={position.tp}
                  lots={position.size?.lots}
                  myTrades={myTrades}
                />
              </div>
            ) : (
              <WaitingStatus state={state} now={now} />
            )}
            {state.loss_pause && (
              <p className="news" data-paused="true">
                New signals paused by the loss limits ({state.loss_pause.reason}) until{" "}
                {t.day(state.loss_pause.until, now)} {hhmm(state.loss_pause.until)}.
              </p>
            )}
            {state.news && (
              <p className="news" data-paused={state.news.paused}>
                {state.news.paused
                  ? `Paused for ${state.news.title} at ${hhmm(state.news.time)}. New signals resume 30 minutes after it.`
                  : `Next major US news: ${state.news.title} at ${hhmm(state.news.time)}.`}
              </p>
            )}
            <SessionSchedule state={state} now={now} t={t} />
            <div className="risk-stat">
              <span>Risk per trade</span>
              <strong>{usd((account.balance * account.risk_percent) / 100)}</strong>
              <span>
                {account.risk_percent}% of {my.custom ? "your " : ""}
                {usd(account.balance).replace(".00", "")}
              </span>
              <button
                type="button"
                className="link-button"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((v) => !v)}
              >
                {my.custom ? "Change" : "Use your own account"}
              </button>
            </div>
            {accountOpen && <AccountForm my={my} rules={state.account} onDone={() => setAccountOpen(false)} />}
          </section>

          <section className="side-block">
            {position ? <Ladder position={position} bid={state.bid} ask={state.ask} /> : <Checklist state={state} />}
          </section>

          <section className="side-block">
            <h2>
              Signals <span className="tz-note">{state.display.label}</span>
            </h2>
            <Journal
              journal={journal}
              all={signals}
              balance={account.balance}
              state={state}
              t={t}
              now={now}
              onReplay={showTrade}
              myTrades={myTrades}
            />
          </section>

          <NewsWeek state={state} t={t} now={now} />

          <section className="side-block">
            <h2>Indicators</h2>
            <dl className="indicators">
              {state.range && (
                <div>
                  <dt>{state.range.label}</dt>
                  <dd>
                    {price(state.range.lo)}–{price(state.range.hi)}
                  </dd>
                </div>
              )}
              <div>
                <dt>RSI</dt>
                <dd>
                  {state.indicators.rsi.toFixed(1)}
                  <meter min={0} max={100} low={30} high={70} optimum={50} value={state.indicators.rsi} />
                </dd>
              </div>
              <div>
                <dt>EMA {state.indicators.periods[0]}</dt>
                <dd>{price(state.indicators.ema_fast)}</dd>
              </div>
              <div>
                <dt>EMA {state.indicators.periods[1]}</dt>
                <dd>{price(state.indicators.ema_slow)}</dd>
              </div>
              <div>
                <dt>EMA {state.indicators.periods[2]}</dt>
                <dd>{price(state.indicators.ema_trend)}</dd>
              </div>
              <div>
                <dt>ATR</dt>
                <dd>{state.indicators.atr.toFixed(2)}</dd>
              </div>
            </dl>
            <p className="note">Signals only. Nothing here places trades.</p>
          </section>
        </aside>
      </div>

      {perfOpen && (
        <Performance
          events={signals}
          my={my}
          rules={state.account}
          tz={state.display.tz}
          onClose={closePerf}
          taken={myTrades.taken}
        />
      )}
      {chatOpen && <ChatPanel chat={chat} onClose={() => setChatOpen(false)} stamp={t.stamp} now={now} />}
      {toast && !(chatOpen && chat.activeId === toast.roomId) && (
        <button type="button" className="chat-toast" onClick={() => openChat(toast.roomId)} key={toast.id}>
          <strong>
            {toast.author} <span>in {toast.room}</span>
          </strong>
          <span className="chat-toast-body">{toast.body}</span>
        </button>
      )}
      <button
        type="button"
        className="chat-fab"
        aria-pressed={chatOpen}
        aria-label={chatOpen ? "Close chat" : chat.totalUnread ? `Open chat, ${chat.totalUnread} unread` : "Open chat"}
        onClick={() => (chatOpen ? setChatOpen(false) : openChat())}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          {chatOpen ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path
              d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
        {chat.totalUnread > 0 && !chatOpen && (
          <span className="chat-badge">{chat.totalUnread > 99 ? "99+" : chat.totalUnread}</span>
        )}
      </button>
    </main>
  );
}
