"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DailyTrendState, LiveState, Side } from "../lib/types";
import StrategyGuide from "./StrategyGuide";
import type { Theme } from "./TradingChart";
import { useBotState } from "../lib/useBotState";
import { useLivePrice, type LivePrice } from "../lib/useLivePrice";
import { useMyTrades } from "../lib/useMyTrades";
import { anchorNear, useDraggable } from "../lib/useDraggable";
import { useChat, type ChatMessage } from "../lib/useChat";
import { adoptProfileAccount, useMyAccount } from "../lib/account";
import AccountForm from "./AccountForm";
import ChatPanel from "./ChatPanel";
import Performance from "./Performance";
import NotificationCenter, { type Notice } from "./NotificationCenter";
import BottomBar, { type SideTab } from "./BottomBar";
import EmptyState from "./EmptyState";
import Fold from "./Fold";
import Toaster from "./Toaster";
import Tour from "./Tour";
import { toast as showToast } from "../lib/toast";
import DailyTrend, { nearTrigger, TrendBrief, TrendTrades } from "./DailyTrend";
import { TelegramIcon } from "./Preferences";
import TelegramCta from "./TelegramCta";
import { safeLink } from "../lib/links";
import ProfileMenu, { type Me } from "./ProfileMenu";
import { LotCalculator, PriceAlerts, useAlertWatcher, usePriceAlerts, type PriceAlert } from "./Tools";

const TradingChart = dynamic(() => import("./TradingChart"), { ssr: false });

// The bot checks in every 15 s even when nothing changes. Allow a missed check-in or two before
// worrying, and call it offline only after a restart would normally have finished (1-2 min).
const LATE_AFTER_S = 60;
const OFFLINE_AFTER_S = 180;

// config.py's account settings, used until the bot's first update arrives
const DEFAULT_RULES: LiveState["account"] = { balance: 500, risk_percent: 1, max_risk_percent: 2, oz_per_lot: 100, min_lot: 0.01 };

const price = (n: number) => n.toFixed(2);

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

/** "Mon 8:30 PM" when not today, else "8:30:15 PM", in the bot's display time zone (PH time). */
function stamper(tz: string) {
  const dateKey = (t: number) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz });
  return (t: number, now: number) =>
    dateKey(t) === dateKey(now)
      ? clock12(t, tz, true)
      : `${new Date(t * 1000).toLocaleDateString("en-US", { timeZone: tz, weekday: "short" })} ${clock12(t, tz)}`;
}

function ago(seconds: number) {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

/** The bot's state with the browser's live price on top. */
function withLivePrice(state: LiveState, live: LivePrice | null): LiveState {
  return live ? { ...state, bid: live.bid, ask: live.ask } : state;
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
  // What was chosen: "system" (no saved choice) follows the device's light / dark setting
  const choice = useSyncExternalStore<ThemeChoice>(
    (onChange) => {
      themeListeners.add(onChange);
      window.addEventListener("storage", onChange);
      return () => {
        themeListeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    savedTheme,
    () => "system",
  );
  // While on "system", switch along with the device (e.g. phones going dark at night)
  useEffect(() => {
    if (choice !== "system") return;
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => (document.documentElement.dataset.theme = media.matches ? "light" : "dark");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);
  const choose = (next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem("gold-theme");
      else localStorage.setItem("gold-theme", next);
    } catch {
      // storage unavailable - the choice just won't be remembered
    }
    if (next !== "system") document.documentElement.dataset.theme = next;
    themeListeners.forEach((l) => l());
  };
  return { theme, choice, choose };
}

export type ThemeChoice = Theme | "system";
const themeListeners = new Set<() => void>();
function savedTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem("gold-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** The signed-in member's display name and role; also applies the account size saved on their profile. */
function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let stopped = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (stopped || !d?.name) return;
        setMe({ name: d.name, role: d.role, email: d.email, avatar: d.avatar });
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

/** Account money, e.g. "$5.20", or signed "+$5.20" / "−$5.20". */
const usd = (n: number, sign = false) =>
  `${sign ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

/**
 * Sound + notification when a trend strategy's rule signals a buy, opens or closes a paper trade, or when
 * price comes close to a breakout trigger ("Signal coming?", once per rule and trigger).
 */
function useTrendAlerts(trend: DailyTrendState | null | undefined, enabled: boolean, strategy: Strategy) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!trend) return;
    const events = trend.rules.flatMap((x) => [
      ...(nearTrigger(trend, x) != null
        ? [{ key: `near-${x.id}-${x.trigger ?? ""}`, close: false, text: `Signal coming? ${x.name}: price is ${nearTrigger(trend, x)!.toFixed(2)}% below the trigger${x.trigger != null ? ` ${price(x.trigger)}` : ""}` }]
        : []),
      ...(x.pending ? [{ key: `pending-${x.id}-${trend.levels?.hh100 ?? ""}-${x.trigger ?? ""}`, close: false, text: `${x.name}: buy at the next ${CANDLE[strategy]} open` }] : []),
      ...(x.position ? [{ key: `open-${x.id}-${x.position.opened}`, close: false, text: `${x.name}: bought at ${price(x.position.entry)}` }] : []),
      ...x.trades.map((tr) => ({
        key: `close-${x.id}-${tr.closed}`,
        close: true,
        text: `${x.name}: closed ${tr.r >= 0 ? "+" : "−"}${Math.abs(tr.r).toFixed(2)}R`,
      })),
    ]);
    const first = seen.current === null; // first load: don't alert on old events
    const known: Set<string> = seen.current ?? new Set<string>();
    const fresh = events.filter((e) => !known.has(e.key));
    events.forEach((e) => known.add(e.key));
    seen.current = known;
    if (first || !enabled || !fresh.length) return;
    const e = fresh[0];
    chime("BUY", e.close);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`${STRATEGIES[strategy]} (paper)`, { body: e.text, tag: `trend-${strategy}` });
    }
  }, [trend, enabled, strategy]);
}

/** The two strategies: Daily trend (the main one) and 4-hour trend, each its own tracker in the bot's state. */
type Strategy = "trend" | "h4";
/** A short line under the big word. */
const CAPTIONS: Record<string, string> = {
  Wait: "No setup yet: nothing to do",
  Buy: "Buy at the next open",
  Long: "In a paper trade",
};

const STRATEGIES: Record<Strategy, string> = { trend: "Daily trend", h4: "4-hour trend" };
const CANDLE: Record<Strategy, "daily" | "4-hour"> = { trend: "daily", h4: "4-hour" };
const TAGS: Record<Strategy, string> = {
  trend: "Main strategy · daily candles · paper test",
  h4: "4-hour candles · paper test",
};
const tracker = (state: LiveState, s: Strategy) => (s === "trend" ? state.daily_trend : state.h4_trend) ?? null;
const isStrategy = (s: unknown): s is Strategy => s === "trend" || s === "h4";

/** Each tracker's paper trades as notices, e.g. "4-hour trend (paper): 4-hour breakout closed +1.20R". */
function trendNotices(trend: DailyTrendState | null, s: Strategy): Notice[] {
  return (trend?.rules ?? []).flatMap((r): Notice[] => [
    ...(r.position
      ? [{ id: `${s}-open-${r.id}-${r.position.opened}`, time: r.position.opened, kind: "trend" as const, text: `${STRATEGIES[s]} (paper): ${r.name} bought at ${price(r.position.entry)}` }]
      : []),
    ...r.trades.map((tr) => ({
      id: `${s}-close-${r.id}-${tr.closed}`,
      time: tr.closed,
      kind: "trend" as const,
      text: `${STRATEGIES[s]} (paper): ${r.name} closed ${tr.r >= 0 ? "+" : "−"}${Math.abs(tr.r).toFixed(2)}R`,
      tone: (tr.r >= 0 ? "profit" : "loss") as Notice["tone"],
    })),
  ]);
}

const SIDE_TABS: [SideTab | "tools", string][] = [
  ["signal", "Signal"],
  ["trades", "Trades"],
  ["tools", "Tools"],
];

/** "Today", "Yesterday" or "Mon, Oct 5", in the display time zone. */
function dayLabel(time: number, now: number, tz: string) {
  const key = (t: number) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz });
  if (key(time) === key(now)) return "Today";
  if (key(time) === key(now - 86400)) return "Yesterday";
  return new Date(time * 1000).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

export default function Dashboard() {
  const { state: botState, connected, missing, configured, seenAt } = useBotState();
  const live = useLivePrice();
  const now = useNow();
  const me = useMe();
  const rules = botState?.account ?? DEFAULT_RULES;
  const my = useMyAccount(rules);
  const { account } = my;
  // The bot's state with the live price on top
  const state = useMemo(() => (botState ? withLivePrice(botState, live) : null), [botState, live]);
  const myTrades = useMyTrades();
  // Sidebar tab (remembered in this browser)
  const [perfOpen, setPerfOpen] = useState(false); // the Performance pop-up
  const closePerf = useCallback(() => setPerfOpen(false), []);
  const [sideTab, setSideTab] = useState<SideTab>(() => {
    try {
      const v = localStorage.getItem("gold-tab");
      return v === "trades" || v === "tools" ? v : "signal";
    } catch {
      return "signal";
    }
  });
  // Which strategy the signal card shows (Daily trend is the main one), and which ones send alerts
  const [strategy, setStrategy] = useState<Strategy>(() => {
    try {
      return localStorage.getItem("gold-strategy") === "h4" ? "h4" : "trend";
    } catch {
      return "trend";
    }
  });
  const chooseStrategy = (s: Strategy) => {
    setStrategy(s);
    try {
      localStorage.setItem("gold-strategy", s);
    } catch {
      // not remembered
    }
  };
  const [follow, setFollow] = useState<Strategy[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("gold-alert-strategies") ?? '["trend","h4"]');
      return Array.isArray(v) ? v.filter(isStrategy) : ["trend", "h4"];
    } catch {
      return ["trend", "h4"];
    }
  });
  const toggleFollow = (s: Strategy) => {
    const next = follow.includes(s) ? follow.filter((x) => x !== s) : [...follow, s];
    setFollow(next);
    try {
      localStorage.setItem("gold-alert-strategies", JSON.stringify(next));
    } catch {
      // not remembered
    }
    showToast(`${STRATEGIES[s]} alerts ${next.includes(s) ? "on" : "off"}${next.includes(s) && !alerts ? " (turn on sound alerts in the profile menu)" : ""}`);
  };
  const chooseTab = (tab: SideTab, scroll = false) => {
    setSideTab(tab);
    try {
      localStorage.setItem("gold-tab", tab);
    } catch {
      // not remembered
    }
    if (scroll) document.querySelector(".side-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // The "Get the signals on Telegram" card, until it's hidden with its × (remembered in this browser)
  const [tgHidden, setTgHidden] = useState(() => {
    try {
      return localStorage.getItem("gold-tg-cta-hidden") === "1";
    } catch {
      return false;
    }
  });
  const hideTg = () => {
    setTgHidden(true);
    try {
      localStorage.setItem("gold-tg-cta-hidden", "1");
    } catch {
      // hidden for this visit only
    }
  };
  const [accountOpen, setAccountOpen] = useState(false);
  const [alerts, setAlerts] = useState(() => {
    try {
      return localStorage.getItem("gold-sound-alerts") === "1";
    } catch {
      return false;
    }
  });
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
  const fab = useDraggable("gold-chat-fab", 58); // the chat button can be dragged out of the way

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
  const { theme, choice: themeChoice, choose: chooseTheme } = useTheme();
  const prevBid = useRef<number | null>(null);
  const [tickDir, setTickDir] = useState<"up" | "down" | null>(null);

  useTrendAlerts(state?.daily_trend, alerts && follow.includes("trend"), "trend");
  useTrendAlerts(state?.h4_trend, alerts && follow.includes("h4"), "h4");

  // Price alerts: sound + notification when the live price reaches one
  const priceAlerts = usePriceAlerts();
  const onPriceAlert = useCallback((a: PriceAlert) => {
    chime(a.dir === "above" ? "BUY" : "SELL", false);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Gold ${a.dir === "above" ? "rose" : "fell"} to ${price(a.price)}`, { body: "Your price alert" });
    }
  }, []);
  useAlertWatcher(state?.bid ?? null, onPriceAlert);

  useEffect(() => {
    if (!state) return;
    if (prevBid.current !== null && state.bid !== prevBid.current) {
      setTickDir(state.bid > prevBid.current ? "up" : "down");
    }
    prevBid.current = state.bid;
  }, [state]);

  // The chosen strategy's tracker: Long while a rule holds a paper trade, Buy when one buys at the next open
  const trend = state ? tracker(state, strategy) : null;
  const trendRules = trend?.rules ?? [];
  const word = trendRules.some((x) => x.position) ? "Long" : trendRules.some((x) => x.pending) ? "Buy" : "Wait";
  const cardSide = word === "Wait" ? "WAIT" : "BUY";
  const telegram = safeLink(state?.telegram_url); // the bot's public channel, if it has one
  const askDojo = safeLink(state?.telegram_bot_url); // private chat with the bot's AI helper, if it's on

  useEffect(() => {
    if (state) {
      const unread = chat.totalUnread ? `(${chat.totalUnread}) ` : "";
      document.title = `${unread}${word} · ${price(state.bid)} · Gold Dojo`;
    }
  }, [word, state, chat.totalUnread]);

  async function toggleAlerts() {
    if (!alerts && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (!alerts) chime("BUY", false); // also unlocks audio in the browser
    setAlerts(!alerts);
    try {
      localStorage.setItem("gold-sound-alerts", alerts ? "0" : "1");
    } catch {
      // not remembered
    }
    showToast(alerts ? "Sound alerts off" : "Sound alerts on");
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
          <h1>Waking up the bot</h1>
          <p>
            The bot hasn&apos;t checked in yet. It runs on a free server that sleeps when idle, so waking up can take
            up to a minute. This page updates by itself the moment it does.
          </p>
          <p className="setup-live" role="status">
            <i aria-hidden /> Waiting for the first update…
          </p>
          {me?.role === "admin" && (
            <details>
              <summary>Still nothing after a few minutes?</summary>
              <ul>
                <li>
                  Open the bot&apos;s <code>/health</code> page on Render: it should say <code>&quot;ok&quot;: true</code>.
                </li>
                <li>
                  On Render, check the service is <strong>Live</strong>, not suspended, and that its{" "}
                  <code>SUPABASE_URL</code> and <code>SUPABASE_SECRET_KEY</code> are set.
                </li>
                <li>The pingers (cron-job.org, UptimeRobot) should show green.</li>
              </ul>
            </details>
          )}
        </div>
      </main>
    );
  }

  if (!state.strategy || !state.windows || !state.account || !state.chart) {
    return (
      <main className="page">
        <div className="setup">
          <h1>Updating the bot</h1>
          <p>
            The bot is on an older version than this page and is restarting with the update. This page refreshes by
            itself in a minute or two.
          </p>
          <p className="setup-live" role="status">
            <i aria-hidden /> Waiting for the new version…
          </p>
        </div>
      </main>
    );
  }

  const stamp = stamper(state.display.tz);
  const notices: Notice[] = [
    ...priceAlerts
      .filter((a) => a.hit)
      .map((a): Notice => ({ id: `alert-${a.id}`, time: a.hit!, kind: "alert", text: `Price alert: gold reached ${price(a.price)}` })),
    ...trendNotices(state.daily_trend ?? null, "trend"),
    ...trendNotices(state.h4_trend ?? null, "h4"),
    ...(status.tone === "off" && seenAt
      ? [{ id: `bot-off-${Math.round(seenAt / 60000)}`, time: seenAt / 1000, kind: "bot" as const, text: "The bot stopped sending updates", tone: "loss" as const }]
      : []),
  ];
  const spread = state.ask - state.bid;

  return (
    <main className="terminal" data-signal={cardSide}>
      {state.demo && (
        <p className="demo-banner">Demo prices. These signals are random and only for trying out the page.</p>
      )}

      <header className="topbar">
        <div className="instrument">
          {/* eslint-disable-next-line @next/next/no-img-element -- the site icon, an SVG */}
          <img src="/icon-dark.svg" alt="" width={28} height={28} className="brand-mark brand-dark" />
          {/* eslint-disable-next-line @next/next/no-img-element -- the site icon, an SVG */}
          <img src="/icon-light.svg" alt="" width={28} height={28} className="brand-mark brand-light" />
          <strong>Gold Dojo</strong>
          <span>
            {state.symbol}, {chartTf ?? state.chart.default} chart
            <span className="instrument-strategy">
              Signals: Daily trend and 4-hour trend
              {state.real_candles != null && (
                <span
                  className="real-share"
                  title="How much of the last day of signal candles uses real XAUUSD prices (the rest: PAXG adjusted to spot)"
                >
                  {" "}
                  · real prices {state.real_candles}%
                </span>
              )}
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
        <button type="button" className="theme-toggle perf-open" aria-haspopup="dialog" onClick={() => setPerfOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M2 13.5h12M3 11l3.5-4 3 2.5L14 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Performance</span>
        </button>
        <NotificationCenter notices={notices} stamp={(time) => stamp(time, now)} />
        <ProfileMenu
          me={me}
          themeChoice={themeChoice}
          onTheme={chooseTheme}
          alerts={alerts}
          onToggleAlerts={toggleAlerts}
        />
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
            followTf={strategy === "h4" ? "H4" : "D1"}
            offset={state.display.offset}
            history={[]}
            range={null}
            position={null}
            periods={state.indicators.periods}
            onTimeframe={setChartTf}
            alertPrices={priceAlerts.filter((a) => !a.hit).map((a) => a.price)}
            dailyTrend={
              state.daily_trend
                ? {
                    hh100: state.daily_trend.levels?.hh100 ?? null,
                    positions: state.daily_trend.rules.flatMap((x) => (x.position ? [x.position] : [])),
                  }
                : null
            }
          />
        </section>

        <aside className="sidebar">
          <section className="signal-card" aria-live="polite">
            <div className="strategy-bar">
              <div className="strategy-switch" role="radiogroup" aria-label="Strategy">
                {(Object.keys(STRATEGIES) as Strategy[]).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={strategy === s} onClick={() => chooseStrategy(s)}>
                    {STRATEGIES[s]}
                    {s === "trend" && <small aria-label="main strategy" title="Main strategy">★</small>}
                  </button>
                ))}
              </div>
            </div>
            <div className="strategy-meta">
              <p className="strategy-tag">{TAGS[strategy]}</p>
              <div className="card-actions">
                <button
                  type="button"
                  className="strategy-follow"
                  aria-pressed={follow.includes(strategy)}
                  onClick={() => toggleFollow(strategy)}
                  aria-label={`${follow.includes(strategy) ? "Stop" : "Get"} alerts for ${STRATEGIES[strategy]}`}
                  title={`Alerts for ${STRATEGIES[strategy]}: ${follow.includes(strategy) ? "on" : "off"}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
                    {!follow.includes(strategy) && <path d="M3 3l18 18" />}
                  </svg>
                </button>
                <a className="push-link" href="/profile#notifications" title="Turn on phone notifications">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <rect x="7" y="2.5" width="10" height="19" rx="2" />
                    <path d="M11 18.5h2" />
                  </svg>
                  <span className="sr-only">Turn on phone notifications</span>
                </a>
              </div>
            </div>
            <div className="signal-head">
              <h1 className="signal-word" key={`${strategy}-${word}`}>
                {word}
              </h1>
              <p className="signal-caption">{CAPTIONS[word]}</p>
            </div>
            <TrendBrief
              trend={trend}
              bid={state.bid}
              day={(time) => dayLabel(time, now, state.display.tz)}
              name={STRATEGIES[strategy]}
              candle={CANDLE[strategy]}
            />
            {(telegram || askDojo) && (
              <div className="card-links">
                {telegram && (
                  <a className="telegram-link" href={telegram} target="_blank" rel="noopener noreferrer">
                    <TelegramIcon />
                    Alerts on Telegram
                  </a>
                )}
                {askDojo && (
                  <a className="telegram-link" href={askDojo} target="_blank" rel="noopener noreferrer">
                    <TelegramIcon />
                    Ask Dojo
                  </a>
                )}
              </div>
            )}
          </section>

          <section className="side-block risk-block">
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

          {!tgHidden && <TelegramCta url={telegram} botUrl={askDojo} onHide={hideTg} />}

          <div
            className="side-tabs"
            role="tablist"
            aria-label="Sidebar"
            onKeyDown={(e) => {
              // Arrow keys move between tabs, as screen-reader users expect
              const keys = SIDE_TABS.map(([k]) => k);
              const i = keys.indexOf(sideTab);
              const next =
                e.key === "ArrowRight" ? keys[(i + 1) % keys.length] : e.key === "ArrowLeft" ? keys[(i + keys.length - 1) % keys.length] : null;
              if (!next) return;
              e.preventDefault();
              chooseTab(next as SideTab);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {SIDE_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={sideTab === key}
                tabIndex={sideTab === key ? 0 : -1}
                aria-controls={`panel-${key}`}
                onClick={() => chooseTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="side-panel" role="tabpanel" id={`panel-${sideTab}`} aria-labelledby={`tab-${sideTab}`}>
            {sideTab === "signal" && (
              <>
                {trend ? (
                  <section className="side-block trend-main">
                    <DailyTrend
                      key={strategy}
                      trend={trend}
                      account={account}
                      bid={state.bid}
                      day={(time) => dayLabel(time, now, state.display.tz)}
                      myTrades={myTrades}
                      candle={CANDLE[strategy]}
                      drift={state.drift}
                      minTrades={state.drift_min_trades ?? 20}
                    />
                  </section>
                ) : (
                  <section className="side-block">
                    <EmptyState icon="wait" title={`${STRATEGIES[strategy]} is starting`}>
                      The bot begins the {STRATEGIES[strategy]} test after its next restart. It shows up here then.
                    </EmptyState>
                  </section>
                )}
                <Fold id={`guide-${strategy}`} title={`How ${STRATEGIES[strategy]} works`}>
                  <StrategyGuide strategy={strategy} />
                </Fold>
              </>
            )}

            {sideTab === "trades" && (
              <section className="side-block">
                <h2>
                  {STRATEGIES[strategy]} trades <span className="tz-note">paper test</span>
                </h2>
                <TrendTrades
                  trend={trend}
                  day={(time) => dayLabel(time, now, state.display.tz)}
                  taken={myTrades.taken}
                  fills={myTrades.fills}
                  name={STRATEGIES[strategy]}
                />
              </section>
            )}

            {sideTab === "tools" && (
              <>
                <Fold id="alerts" title="Price alerts">
                  <PriceAlerts bid={state.bid} />
                </Fold>
                <Fold id="calculator" title="Lot size calculator">
                  <LotCalculator bid={state.bid} ask={state.ask} account={account} rules={state.account} />
                </Fold>
                <Fold id="indicators" title="Indicators">
            <dl className="indicators">
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
                </Fold>
              </>
            )}

            <p className="note side-disclaimer">
              Signals only, never trades. Both strategies are on a paper test; past results are no promise.{" "}
              <a href="/how">How it has done</a>
            </p>
          </div>
        </aside>
      </div>

      <BottomBar
        tab={chatOpen ? null : sideTab}
        chatOpen={chatOpen}
        onTab={(tab) => {
          setChatOpen(false); // leave the chat for the chosen section
          chooseTab(tab, true);
        }}
        onChart={() => {
          setChatOpen(false);
          document.querySelector(".chart-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        onChat={() => (chatOpen ? setChatOpen(false) : openChat())}
        unread={chat.totalUnread}
      />
      <Toaster />
      {perfOpen && (
        <Performance
          my={my}
          rules={state.account}
          tz={state.display.tz}
          onClose={closePerf}
          swing={me?.role === "admin" ? (state.swing_paper ?? null) : undefined}
          dailyTrend={state.daily_trend ?? null}
          h4Trend={state.h4_trend ?? null}
        />
      )}
      <Tour />
      {chatOpen && (
        <ChatPanel
          chat={chat}
          onClose={() => setChatOpen(false)}
          stamp={stamp}
          now={now}
          style={anchorNear(fab.spot, 58)}
        />
      )}
      {toast && !(chatOpen && chat.activeId === toast.roomId) && (
        <button
          type="button"
          className="chat-toast"
          onClick={() => openChat(toast.roomId)}
          key={toast.id}
          style={anchorNear(fab.spot, 58)}
        >
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
        title="Chat (drag to move)"
        style={fab.style}
        {...fab.handlers}
        onClick={fab.guardClick(() => (chatOpen ? setChatOpen(false) : openChat()))}
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
