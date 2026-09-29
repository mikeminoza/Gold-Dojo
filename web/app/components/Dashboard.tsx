"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LiveState, Position, Side, SignalEvent, Sizing, TradeWindow } from "../lib/types";
import type { Theme } from "./TradingChart";

const TradingChart = dynamic(() => import("./TradingChart"), { ssr: false });

const STALE_AFTER_S = 10;

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

/** Subscribes to the bot's live stream. */
function useLiveState() {
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // EventSource reconnects by itself
    source.addEventListener("state", (e) => {
      setMissing(false);
      setState(JSON.parse((e as MessageEvent).data));
    });
    source.addEventListener("missing", () => setMissing(true));
    return () => source.close();
  }, []);

  return { state, connected, missing };
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
      </dl>
    </div>
  );
}

function History({ events, t, now }: { events: SignalEvent[]; t: TimeFormat; now: number }) {
  if (events.length === 0) {
    return <p className="empty">No signals yet. They&apos;ll appear here as soon as the bot sends one.</p>;
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
            </li>
          );
        }
        const pnl = e.pnl ?? 0;
        const o = outcome(pnl);
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
          </li>
        );
      })}
    </ol>
  );
}

export default function Dashboard() {
  const { state, connected, missing } = useLiveState();
  const now = useNow();
  const [alerts, setAlerts] = useState(false);
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
    if (state) document.title = `${word} · ${price(state.bid)} · Golden Skibidi`;
  }, [word, state]);

  async function toggleAlerts() {
    if (!alerts && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (!alerts) chime("BUY", false); // also unlocks audio in the browser
    setAlerts(!alerts);
  }

  const stale = state ? now - state.updated > STALE_AFTER_S : false;
  const status = !connected
    ? { tone: "off", text: "Reconnecting to the site…" }
    : missing || !state
      ? { tone: "off", text: "Waiting for the bot" }
      : stale
        ? { tone: "off", text: `Bot stopped sending ${ago(now - state.updated)}` }
        : { tone: "live", text: "Live" };

  if (!state) {
    return (
      <main className="page">
        <div className="setup">
          <h1>Waiting for the bot</h1>
          <p>
            Start the signal bot and this page updates on its own. From the <code>trading-bot</code> folder, run:
          </p>
          <pre>.venv\Scripts\python bot.py</pre>
          <p>
            No MetaTrader 5 yet? Try it with fake prices: <code>.venv\Scripts\python bot.py --demo</code>
          </p>
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
          <pre>.venv\Scripts\python bot.py --demo</pre>
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
            {state.symbol}, {state.timeframe}, {state.strategy.name.toLowerCase()}
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
        <button type="button" className="alert-toggle" aria-pressed={alerts} onClick={toggleAlerts}>
          {alerts ? "Sound alerts on" : "Turn on sound alerts"}
        </button>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>

      <div className="workspace">
        <section className="chart-panel" aria-label="Price chart">
          <TradingChart
            key={theme}
            theme={theme}
            symbol={state.symbol}
            bid={state.bid}
            priceTime={state.updated}
            tzLabel={state.display.label}
            timeframes={state.chart.timeframes}
            defaultTf={state.chart.default}
            offset={state.display.offset}
            history={state.history}
            range={state.range}
            position={position}
            periods={state.indicators.periods}
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
              </div>
            ) : (
              <WaitingStatus state={state} now={now} />
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
              <strong>{usd((state.account.balance * state.account.risk_percent) / 100)}</strong>
              <span>
                {state.account.risk_percent}% of {usd(state.account.balance).replace(".00", "")}
              </span>
            </div>
          </section>

          <section className="side-block">
            {position ? <Ladder position={position} bid={state.bid} ask={state.ask} /> : <Checklist state={state} />}
          </section>

          <section className="side-block">
            <h2>
              Signals <span className="tz-note">{state.display.label}</span>
            </h2>
            <Results events={state.history} balance={state.account.balance} />
            <History events={state.history} t={t} now={now} />
          </section>

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
    </main>
  );
}
