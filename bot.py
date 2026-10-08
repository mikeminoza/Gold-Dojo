"""Live gold signal bot: watches candles, tracks BUY/SELL signals, and publishes them to
live.json (for the website) and optionally Telegram.

    python bot.py                    # live prices (config.PRICE_FEED: free Binance PAXG by default)
    python bot.py --strategy ema     # override the strategy
    python bot.py --demo             # fake prices with 3-second candles

It only sends signals; it never places orders.
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv()

import backtest_refresh
import cloud_state
import config
import health
import guards
import monthly_report
import price_check
import health_report
import live_state
import loss_guard
import market_recorder
import real_candles
import session_recap
import swing_paper
import trend_daily
import web_push
import weekly_summary
import news
import sessions
import sizing
import strategy
import telegram_ask
import telegram_notify

STATE_FILE = Path(__file__).with_name("state.json")
LOCK_FILE = Path(__file__).with_name("bot.lock")
PID_FILE = Path(__file__).with_name("bot.pid")
ALREADY_RUNNING = 3  # exit code the start script checks, so it doesn't keep retrying


def single_instance():
    """Allow only one live bot at a time: two would overwrite each other's signals.

    Holds an OS lock on bot.lock for as long as this process runs (released automatically if it
    crashes). Returns the open lock file, which must be kept referenced.
    """
    lock = open(LOCK_FILE, "a+")
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("Another bot is already running on this PC; not starting a second one.")
        raise SystemExit(ALREADY_RUNNING)
    PID_FILE.write_text(str(os.getpid()))
    return lock
HISTORY_LIMIT = 50
DAILY_REFRESH_SECONDS = 600
CANDLE_SETTLE_SECONDS = 5     # wait this long after a candle closes before asking for it
CANDLE_RETRY_SECONDS = 10     # ask again this often if the new candle isn't there yet
CANDLE_GIVE_UP_SECONDS = 300  # after this, wait for the next candle (e.g. a quiet market)


def fmt(price):
    return f"{price:.2f}"


class Bot:
    def __init__(self, feed, demo, strategy_name):
        self.feed = feed
        self.demo = demo
        self.strategy_name = strategy_name
        self.telegram = not demo and bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID"))
        self.news = news.NewsCalendar(enabled=False if demo else None)
        self.strat = strategy.create(strategy_name, feed.candle_seconds(config.TIMEFRAME),
                                     sessions.DemoClock() if demo else None)
        self.symbol = None
        self.df = None
        self.daily = None
        self.daily_at = 0.0
        self.h4 = None
        self.h4_at = 0.0
        # Demo signals are random, so they never go to the real website
        self.cloud = cloud_state.CloudPublisher(enabled=not demo)
        # Keeps the website's backtest running up to the latest session (needs publish_backtest.py once)
        self.backtest = backtest_refresh.BacktestRefresher(self.cloud, feed.candle_seconds(config.TIMEFRAME))
        self.last_bar_time = None
        self._swing_mem = self._report_mem = self._trend_mem = self._h4_mem = None  # set by load()
        self.weekly_sent = None  # ISO week of the last weekly summary
        self.monthly_sent = None  # month of the last monthly report, "YYYY-MM"
        self.backup_sent = None  # ISO week of the last Telegram backup
        self.price_result = None  # last price accuracy check (price_check.py)
        self.price_checked = 0.0
        self.position, self.history = self.load()
        self.report = health_report.HealthReport(self._report_mem) if config.HEALTH_REPORT and not demo else None
        self.recorder = (market_recorder.MinuteRecorder(getattr(feed, "gap", None))
                         if config.RECORD_MARKET_DATA and not demo else None)
        self.swing = swing_paper.SwingPaper(self._swing_mem) if config.SWING_PAPER and not demo else None
        self.trend = trend_daily.DailyTrend(self._trend_mem) if config.DAILY_TREND and not demo else None
        self.h4trend = (trend_daily.DailyTrend(self._h4_mem, trend_daily.H4_RULES)
                        if config.H4_TREND and not demo else None)
        self.silence = guards.Silence()
        self.last_bid = None
        self.push = None if demo else web_push.WebPush(self.cloud)
        self.ask = None if demo else telegram_ask.AskDojo(self.ask_context, self.ask_status)
        self.drift = {}            # rule -> {"percentile", "alarm"} from the daily drift check
        self.drift_checked = 0.0
        self.health = None  # set by main() when running as a web service

    # --- persistence -------------------------------------------------------
    def load(self):
        if self.demo:
            return None, []
        data = None
        try:
            data = json.loads(STATE_FILE.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        if data is None:
            # Nothing saved on this machine (e.g. a fresh start on Render): use the copy in Supabase
            data = self.cloud.load_memory()
            if data:
                print("Restored the bot's memory (open trade, sessions traded) from Supabase")
        if not data:
            return None, []
        self._swing_mem = data.get("swing_paper")
        self._report_mem = data.get("health_report")
        self._trend_mem = data.get("daily_trend")
        self._h4_mem = data.get("h4_trend")
        self.weekly_sent = data.get("weekly_sent")
        self.monthly_sent = data.get("monthly_sent")
        self.backup_sent = data.get("backup_sent")
        self.price_result = data.get("price_check")
        if "side" in data:  # older state.json held only the position
            return data, []
        data = data or {}
        self.strat.state.update(data.get("strategy_state", {}).get(self.strategy_name, {}))
        return data.get("position"), data.get("history", [])

    def save(self):
        if self.demo:
            return
        memory = {
            "position": self.position,
            "history": self.history,
            "strategy_state": {self.strategy_name: self.strat.state},
        }
        if self.swing:
            memory["swing_paper"] = self.swing.memory()
        if self.report:
            memory["health_report"] = self.report.memory()
        if self.trend:
            memory["daily_trend"] = self.trend.memory()
        if self.h4trend:
            memory["h4_trend"] = self.h4trend.memory()
        memory["weekly_sent"] = self.weekly_sent
        memory["monthly_sent"] = self.monthly_sent
        memory["backup_sent"] = self.backup_sent
        memory["price_check"] = self.price_result
        STATE_FILE.write_text(json.dumps(memory, default=live_state._plain))
        self.cloud.remember(memory)  # a copy in Supabase survives restarts on hosts that wipe their disk

    # --- data --------------------------------------------------------------
    def daily_bars(self):
        if self.daily is None or time.time() - self.daily_at > DAILY_REFRESH_SECONDS:
            self.daily = self.feed.get_bars(self.symbol, "D1", 260)  # 200-day average + margin
            self.daily_at = time.time()
        return self.daily

    def h4_bars(self):
        if self.h4 is None or time.time() - self.h4_at > 600:
            self.h4 = self.feed.get_bars(self.symbol, "H4", 260)  # 200-candle average + margin
            self.h4_at = time.time()
        return self.h4

    def prepared(self, include_forming=False):
        bars = self.feed.get_bars(self.symbol, config.TIMEFRAME, 600, include_forming=include_forming)
        if not include_forming:
            self.backtest.maybe_refresh(bars, self.daily_bars())
        return self.strat.prepare(bars, self.daily_bars())

    # --- signal events -----------------------------------------------------
    def record(self, event):
        event["time"] = int(time.time())
        event["id"] = f"{event['time']}-{event['type']}-{len(self.history)}"
        event.update(strategy=self.strategy_name, symbol=self.symbol, timeframe=config.TIMEFRAME)
        self.history = ([event] + self.history)[:HISTORY_LIMIT]
        self.cloud.journal([event])  # saved permanently in the signals table
        print(f"{datetime.now():%H:%M:%S} >>> {event['type'].upper()} {event['side']} @ {fmt(event['price'])}"
              f" ({event.get('reason', '')})")

    def open(self, sig, df, i):
        bid, ask = self.feed.get_tick(self.symbol)
        entry = ask if sig.side == "BUY" else bid
        lv = strategy.levels(sig.side, entry, sig.stop, sig.rr)
        if lv is None:
            print(f"{datetime.now():%H:%M:%S} skipped {sig.side}: price already at or too close to the stop "
                  f"(under {config.MIN_STOP_DISTANCE:g} $/oz away)")
            return
        sl, tp = lv
        size = sizing.lot_size(entry, sl, tp)
        self.strat.on_open(sig)
        self.position = {"side": sig.side, "entry": entry, "sl": sl, "tp": tp, "atr": df["atr"].iat[i],
                         "rsi": df["rsi"].iat[i], "opened": int(time.time()), "expires": sig.expires,
                         "reason": sig.reason, "size": size}
        session = sig.tag[:-11] if sig.tag and len(sig.tag) > 11 else None  # "New York-2026-09-29" -> "New York"
        self.record({"type": "open", "side": sig.side, "price": entry, "sl": sl, "tp": tp, "reason": sig.reason,
                     "size": size, "session": session,
                     "context": {**self.context(sig, df, i), **self.cost_tag(bid, ask, entry, sl)}})
        self.position["trade_id"] = self.history[0]["id"]
        self.position["session"] = session
        if self.telegram:
            icon = "🟢" if sig.side == "BUY" else "🔴"
            warning = "" if size["verdict"] == "ok" else f"\n⚠️ {size['note']}"
            telegram_notify.send(f"{icon} <b>{sig.side} {self.symbol}</b> ({config.TIMEFRAME}, {self.strat.name})\n"
                                 f"{sig.reason}\nEntry: <b>{fmt(entry)}</b>\nStop loss: {fmt(sl)}\n"
                                 f"Take profit: {fmt(tp)}\n"
                                 f"Size: <b>{size['lots']:.2f} lot</b> (risk ${size['risk']:.2f}, "
                                 f"target ${size['reward']:.2f}){warning}")

    @staticmethod
    def cost_tag(bid, ask, entry, sl):
        """Paper-tracked cost filter: the trade's cost as a % of its stop, and whether the filter
        (config.COST_FILTER_PCT) would have kept it. Recorded only; nothing is skipped."""
        stop = abs(entry - sl)
        if not stop:
            return {}
        pct = 100 * ((ask - bid) + config.COST_SLIPPAGE) / stop
        return {"cost_pct": round(pct, 1), "cost_keep": pct <= config.COST_FILTER_PCT}

    @staticmethod
    def context(sig, df, i):
        """The market at the signal, for the website's breakdowns: how wide the opening range was (in ATR),
        how strong the daily trend was in the trade's direction (% from its average), and the weekday."""
        row = df.iloc[i]
        ctx = {"weekday": int(row["time"].tz_convert(config.DISPLAY_TZ).weekday())}
        try:
            if row.get("atr") and pd.notna(row.get("range_hi")):
                ctx["range_atr"] = round(float((row["range_hi"] - row["range_lo"]) / row["atr"]), 2)
            if pd.notna(row.get("daily_ema")) and row["daily_ema"]:
                sign = 1 if sig.side == "BUY" else -1
                ctx["trend_pct"] = round(float(sign * (row["daily_close"] - row["daily_ema"]) / row["daily_ema"] * 100), 2)
        except (KeyError, TypeError, ZeroDivisionError):
            pass
        return ctx

    @staticmethod
    def _excursions(pos, final):
        risk = abs(pos["entry"] - pos["sl"]) or None
        if not risk:
            return {}
        best, worst = max(pos.get("best", final), final), min(pos.get("worst", final), final)
        return {"mfe_r": round(best / risk, 2), "mae_r": round(worst / risk, 2)}

    def close(self, price, reason):
        pos = self.position
        move = price - pos["entry"] if pos["side"] == "BUY" else pos["entry"] - price
        lots = pos.get("size", {}).get("lots")
        usd = sizing.money(move, lots) if lots else None
        self.record({"type": "close", "side": pos["side"], "price": price, "entry": pos["entry"],
                     "pnl": move, "reason": reason, "lots": lots, "pnl_usd": usd,
                     "risk_oz": abs(pos["entry"] - pos["sl"]),  # for results in R (loss limits)
                     # furthest it went in our favour / against us before closing, in R
                     **self._excursions(pos, move),
                     "trade_id": pos.get("trade_id"), "session": pos.get("session")})
        self.position = None
        if self.telegram:
            icon, result = ("✅", "PROFIT") if move > 0 else ("❌", "LOSS") if move < 0 else ("➖", "BREAK-EVEN")
            money = f" = <b>{'+' if usd >= 0 else '−'}${abs(usd):.2f}</b> at {lots:.2f} lot" if lots else ""
            telegram_notify.send(f"{icon} <b>{result}: CLOSE {pos['side']} {self.symbol}</b> — {reason}\n"
                                 f"Entry {fmt(pos['entry'])} → Exit {fmt(price)}\n"
                                 f"Result: {move:+.2f} $/oz{money}")

    # --- checks ------------------------------------------------------------
    def loss_pause(self, now):
        """(reason, until) while the loss limits pause new signals, else None (see loss_guard.py)."""
        opens = {e["id"]: e for e in self.history if e["type"] == "open"}
        closes = []
        for e in reversed(self.history):  # oldest first
            if e["type"] != "close":
                continue
            risk = e.get("risk_oz")
            if risk is None and e.get("trade_id") in opens:  # saved before risk_oz existed
                o = opens[e["trade_id"]]
                risk = abs(o["price"] - o["sl"]) if o.get("sl") is not None else None
            closes.append((e["time"], loss_guard.r_multiple(e.get("pnl") or 0, risk)))
        return loss_guard.pause(closes, now)

    def check_sl_tp(self, bid, ask):
        pos = self.position
        # How far the trade has gone for and against us (the price it could close at), for the analysis
        now = bid if pos["side"] == "BUY" else ask
        move = now - pos["entry"] if pos["side"] == "BUY" else pos["entry"] - now
        pos["best"] = max(pos.get("best", move), move)
        pos["worst"] = min(pos.get("worst", move), move)
        if pos["side"] == "BUY":
            if bid <= pos["sl"]:
                self.close(bid, "Stop loss hit")
            elif bid >= pos["tp"]:
                self.close(bid, "Take profit hit")
        else:
            if ask >= pos["sl"]:
                self.close(ask, "Stop loss hit")
            elif ask <= pos["tp"]:
                self.close(ask, "Take profit hit")

    def on_candle_close(self):
        self.df = df = self.prepared()
        if self.swing:
            self.swing.update(self.daily_bars())
        if self.trend:
            for e in self.trend.update(self.daily_bars()):
                self.announce_trend(e)
        if self.h4trend:
            self.h4_at = 0.0  # a 30-minute close may also close a 4-hour candle: fetch fresh
            for e in self.h4trend.update(self.h4_bars()):
                self.announce_trend(e)
        i = len(df) - 1

        if self.position:
            reason = self.strat.exit(self.position, df, i)
            if reason:
                self.close(df["close"].iat[i], reason)

        sig = self.strat.entry(df, i) if config.NY_SIGNALS else None
        if sig and not self.position:
            paused = self.news.pause_reason(pd.Timestamp.now(tz="UTC"))
            limited = self.loss_pause(time.time())
            capped = self.risk_cap_reason(sig, df, i)
            drifting = config.DRIFT_AUTO_PAUSE and self.drift.get("ny", {}).get("alarm")
            if paused:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): news pause for {paused}")
                self.strat.state.setdefault("skipped", {})[sig.tag] = f"news pause for {paused}"
            elif limited:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): loss limit, {limited[0]}")
                self.strat.state.setdefault("skipped", {})[sig.tag] = f"loss limit ({limited[0]})"
            elif capped:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): risk cap, {capped}")
                self.strat.state.setdefault("skipped", {})[sig.tag] = f"risk cap ({capped})"
            elif drifting:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): drift alarm")
                self.strat.state.setdefault("skipped", {})[sig.tag] = "drift alarm (live results far below the backtest)"
            else:
                self.open(sig, df, i)
        if config.NY_SIGNALS:
            self.post_recaps(df)

    def trend_positions(self):
        return [x.position for t in (self.trend, self.h4trend) if t for x in t.rules.values() if x.position]

    def risk_cap_reason(self, sig, df, i):
        """Would this New York signal push total open risk over MAX_TOTAL_RISK_PCT?"""
        close = float(df["close"].iat[i])
        if abs(close - sig.stop) <= 0:
            return None
        new = sizing.lot_size(close, sig.stop, close)["risk_percent"]
        return guards.risk_cap_reason(self.position, self.trend_positions(), new)

    def check_drift(self):
        """Once a day: are live results (New York signals, Daily trend paper trades) within what the
        backtests expect? Posts in the Bot status chat when an alarm starts or clears."""
        if time.time() - self.drift_checked < 86400 or not self.cloud.enabled:
            return
        self.drift_checked = time.time()
        try:
            ny = (self.backtest._load() or {}) if config.NY_SIGNALS else {}
            ny_pool = [k["pnl"] / abs(k["entry"] - k["sl"]) for k in ny.get("trades", []) if k["entry"] != k["sl"]]
            live = [r for _, r in self.closed_rs()]
            checks = {"ny": ("New York signals", live, ny_pool)} if config.NY_SIGNALS else {}
            for tracker, row, label in ((self.trend, "daily_trend_backtest", "Daily trend"),
                                        (self.h4trend, "h4_trend_backtest", "4-hour trend")):
                if not tracker:
                    continue
                bt = self.cloud_row(row) or {}
                for rule, x in tracker.rules.items():
                    pool = [r for _, r in (bt.get("rules", {}).get(rule, {}).get("trades") or [])]
                    checks[rule] = (f"{label} {trend_daily.NAMES[rule]}", [t["r"] for t in x.trades], pool)
        except Exception as e:  # never let this disturb the bot
            print(f"drift check skipped ({e})")
            return
        for key, (name, live_rs, pool) in checks.items():
            verdict = guards.drift_verdict(live_rs, pool)
            if verdict is None:
                continue
            pct, alarm = verdict
            was = self.drift.get(key, {}).get("alarm")
            self.drift[key] = {"percentile": pct, "alarm": alarm}
            if alarm and not was:
                pause = " New New York signals are paused until it recovers." if key == "ny" and config.DRIFT_AUTO_PAUSE else ""
                self.cloud.post_chat(f"Drift alarm, {name}: after {len(live_rs)} trades, live results are worse than "
                                     f"{100 - pct}% of what the backtest produces over the same number of trades. "
                                     f"Something may differ live (prices, timing or costs).{pause}",
                                     room=config.HEALTH_REPORT_ROOM)
            elif was and not alarm:
                self.cloud.post_chat(f"Drift alarm cleared, {name}: live results are back within the backtest's "
                                     f"normal range ({pct}th percentile).", room=config.HEALTH_REPORT_ROOM)

    def cloud_row(self, row_id):
        r = requests.get(f"{self.cloud.url}/rest/v1/bot_state", params={"id": f"eq.{row_id}", "select": "data"},
                         headers=self.cloud._headers(), timeout=20)
        rows = r.json() if r.ok else []
        return rows[0]["data"] if rows else None

    def closed_rs(self):
        """(close time, R) of the New York trades in the bot's memory, oldest first."""
        opens = {e["id"]: e for e in self.history if e["type"] == "open"}
        out = []
        for e in reversed(self.history):
            if e["type"] != "close":
                continue
            risk = e.get("risk_oz")
            if risk is None and e.get("trade_id") in opens and opens[e["trade_id"]].get("sl") is not None:
                risk = abs(opens[e["trade_id"]]["price"] - opens[e["trade_id"]]["sl"])
            out.append((e["time"], loss_guard.r_multiple(e.get("pnl") or 0, risk)))
        return out

    def watch_silence(self, real):
        """Silence alarm: posts once when prices or candles stop during market hours, and on recovery."""
        now = time.time()
        if real:
            self.silence.price(now)
        if now - getattr(self, "_silence_checked", 0) < 60 or not self.cloud.enabled:
            return
        self._silence_checked = now
        market_open = getattr(self.feed, "market_open", None)
        is_open = bool(market_open and market_open(pd.Timestamp.now(tz="UTC")))
        step = self.feed.candle_seconds(config.TIMEFRAME)
        last_end = self.last_bar_time.timestamp() + step if self.last_bar_time is not None else None
        # the first candle after a weekend or the daily break needs time to arrive
        reopened = is_open and market_open and not market_open(pd.Timestamp(now - 2 * step, unit="s", tz="UTC"))
        msg = self.silence.check(now, is_open and not reopened, last_end)
        if msg:
            print(f"{datetime.now():%H:%M:%S} {msg}")
            self.cloud.post_chat(msg, room=config.HEALTH_REPORT_ROOM)

    def announce_trend(self, e):
        """Daily / 4-hour trend paper trades are announced in chat (a forward test, not live trades)."""
        name = trend_daily.NAMES[e["rule"]]
        mode = "4-hour trend" if e["rule"] in trend_daily.H4_RULES else "Daily trend"
        if e["type"] == "open":
            held = "days" if e["rule"] in trend_daily.H4_RULES else "days to weeks"
            text = (f"{mode} (paper test), {name}: BUY gold at {e['entry']:.2f}, stop {e['stop']:.2f} "
                    f"(trails {trend_daily.STOP[e['rule']]:g} x ATR below the high). Long only, usually held for {held}.")
        else:
            text = (f"{mode} (paper test), {name}: closed at {e['exit']:.2f} ({e['reason'].lower()}) after "
                    f"{e['nights']} nights: {e['r']:+.2f}R after estimated costs.")
        print(f"{datetime.now():%H:%M:%S} {text}")
        self.cloud.post_chat(text)
        if self.telegram:
            telegram_notify.send(("🟢 " if e["type"] == "open" else "🏁 ") + text)
        if self.push:
            self.push.send("h4" if e["rule"] in trend_daily.H4_RULES else "trend", text,
                           title=f"{mode}: {'BUY gold' if e['type'] == 'open' else 'trade closed'}", tag=f"trade-{e['rule']}")

    def check_near(self, bid):
        """Signal coming: once per trigger level, when price gets within NEAR_PCT % of a breakout trigger."""
        if time.time() - getattr(self, "_near_checked", 0) < 60:
            return
        self._near_checked = time.time()
        for tracker, mode, candle in ((self.trend, "Daily trend", "daily"), (self.h4trend, "4-hour trend", "4-hour")):
            for w in (tracker.near(bid) if tracker else []):
                text = (f"Signal coming? {mode}, {trend_daily.NAMES[w['rule']]}: gold is {w['gap_pct']:.2f}% below "
                        f"its trigger {w['trigger']:.2f}. A {candle} close above it means BUY at the next open.")
                print(f"{datetime.now():%H:%M:%S} {text}")
                self.cloud.post_chat(text)
                if self.telegram:
                    telegram_notify.send("👀 " + text)
                if self.push:
                    self.push.send("h4" if w["rule"] in trend_daily.H4_RULES else "trend", text,
                                   title=f"Signal coming? {mode}", tag=f"near-{w['rule']}")

    def post_weekly(self, bid):
        """Sunday evening: a weekly summary of both trend strategies in chat and on Telegram."""
        if self.demo or not (self.trend or self.h4trend) or not weekly_summary.due(self.weekly_sent):
            return
        self.weekly_sent = weekly_summary.week_key()
        text = weekly_summary.text([("Daily trend", self.trend), ("4-hour trend", self.h4trend)], bid,
                                   self.daily_bars())
        print(f"{datetime.now():%H:%M:%S} {text}")
        self.cloud.post_chat(text)
        if self.telegram:
            telegram_notify.send("🗓 " + text)
        if self.push:
            self.push.send(None, text, title="Gold Dojo weekly summary", tag="weekly")

    def check_prices(self):
        """Once a day: compare the PAXG-based daily / 4-hour candles with the real recorded XAUUSD ones."""
        raw = getattr(self.feed, "raw_bars", None)
        if self.demo or raw is None or time.time() - self.price_checked < 86400:
            return
        self.price_checked = time.time()
        was = (self.price_result or {}).get("ok")
        try:
            source = getattr(self.feed, "candle_source", lambda: "PAXG")()
            self.price_result = price_check.check(raw, self.symbol, source=source)
        except Exception as e:  # never let this disturb the bot
            print(f"price check skipped ({e})")
            return
        msg = price_check.message(self.price_result, was)
        if msg:
            print(f"{datetime.now():%H:%M:%S} {msg}")
            self.cloud.post_chat(msg, room=config.HEALTH_REPORT_ROOM)

    def post_monthly(self):
        """On the 1st: last month's paper results vs the backtest, in chat / Telegram / push, and saved."""
        if self.demo or not (self.trend or self.h4trend) or not monthly_report.due(self.monthly_sent):
            return
        self.monthly_sent = monthly_report.month_key()
        rates = {}
        try:
            for row in ("daily_trend_backtest", "h4_trend_backtest"):
                rates.update(monthly_report.backtest_rates(self.cloud_row(row)))
        except Exception as e:
            print(f"monthly report: backtests not loaded ({e})")
        text, record = monthly_report.build([("Daily trend", self.trend), ("4-hour trend", self.h4trend)], rates)
        print(f"{datetime.now():%H:%M:%S} {text}")
        self.cloud.post_chat(text)
        if self.telegram:
            telegram_notify.send("📅 " + text)
        if self.push:
            self.push.send(None, text, title=f"Gold Dojo: {record['month']} report", tag="monthly")
        try:  # the permanent record: the last 36 reports
            saved = (self.cloud_row("monthly_reports") or {}).get("reports", [])
            saved = ([r for r in saved if r.get("month") != record["month"]] + [record])[-36:]
            body = {"id": "monthly_reports", "data": {"reports": saved}, "updated_at": datetime.now(timezone.utc).isoformat()}
            requests.post(f"{self.cloud.url}/rest/v1/bot_state", headers=self.cloud._headers(),
                          data=json.dumps(body), timeout=20)
        except Exception as e:
            print(f"monthly report not saved ({e})")

    def weekly_backup(self):
        """Once a week: the paper-test record (no personal data) as a file to a private Telegram chat."""
        chat = os.getenv("TELEGRAM_ADMIN_CHAT_ID")
        if self.demo or not chat or weekly_summary.week_key() == self.backup_sent:
            return
        if pd.Timestamp.now(tz=config.DISPLAY_TZ).weekday() != weekly_summary.POST_WEEKDAY:
            return
        self.backup_sent = weekly_summary.week_key()
        record = {"saved": int(time.time()), "version": (os.getenv("RENDER_GIT_COMMIT") or "")[:7] or None,
                  "daily_trend": self.trend.memory() if self.trend else None,
                  "h4_trend": self.h4trend.memory() if self.h4trend else None,
                  "price_check": self.price_result}
        name = f"gold-dojo-paper-record-{datetime.now(timezone.utc):%Y-%m-%d}.json"
        ok = telegram_notify.send_document(chat, name, json.dumps(record, indent=1, default=str).encode(),
                                           "Weekly backup of the paper-test record. Keep it.")
        print(f"{datetime.now():%H:%M:%S} weekly backup to Telegram: {'sent' if ok else 'failed'}")

    def ask_status(self):
        """/status on Telegram: what each rule is doing right now."""
        bid = self.last_bid
        if bid is None:
            return "The bot is starting up. Try again in a minute."
        lines = [f"Gold {bid:.2f} (paper test, not financial advice)."]
        for label, tracker in (("Daily trend", self.trend), ("4-hour trend", self.h4trend)):
            if tracker:
                lines.append(f"{label}:\n" + "\n".join("- " + weekly_summary._rule_line(tracker, r, bid)
                                                         for r in tracker.rules))
        return "\n\n".join(lines)

    def ask_context(self):
        """Live facts for Ask Dojo's AI: the status plus each strategy's paper record."""
        text = self.ask_status()
        for label, tracker in (("Daily trend", self.trend), ("4-hour trend", self.h4trend)):
            if tracker:
                started = (pd.Timestamp(tracker.started, unit="s", tz="UTC").strftime("%Y-%m-%d")
                           if tracker.started else "today")
                text += f"\n{label} paper test since {started}: {weekly_summary._record(tracker)}."
        return text + f"\nNow (UTC): {pd.Timestamp.now(tz='UTC'):%Y-%m-%d %H:%M}."

    def post_recaps(self, df):
        """Once a session has ended, post its recap in the website chat (once per session)."""
        if not config.RECAP_TO_CHAT or "sess_end" not in df or not self.cloud.enabled:
            return
        state = self.strat.state
        done = state.setdefault("recapped", [])
        now = time.time()
        ended = df.loc[(df["sess_end"] > 0) & (df["sess_end"] <= now) & (df["sess_end"] > now - 6 * 3600), "sess"]
        for sess in ended.dropna().unique():
            if sess in done:
                continue
            state["recapped"] = done = (done + [sess])[-20:]
            text = session_recap.recap(df, sess, self.history, state.get("skipped", {}).get(sess))
            if text:
                self.cloud.post_chat(text)
                print(f"{datetime.now():%H:%M:%S} chat recap: {text}")
        state["skipped"] = {k: v for k, v in state.get("skipped", {}).items() if k in done[-5:] or k not in done}

    # --- website state -----------------------------------------------------
    def publish(self, bid, ask):
        now = pd.Timestamp.now(tz="UTC")
        last = self.df.iloc[-1]
        status = self.strat.status(self.df, now)

        paused = self.news.pause_reason(now)
        conditions = self.strat.conditions(self.df, now)
        if self.news.enabled:
            item = {"label": f"No major US news within {config.NEWS_PAUSE_MINUTES} min"
                             + (f" ({paused})" if paused else ""), "ok": paused is None}
            for side in conditions:
                conditions[side].append(item)
        open_risk = guards.open_risk_pct(self.position, self.trend_positions())
        item = {"label": f"Open risk {open_risk:.1f}% (cap {config.MAX_TOTAL_RISK_PCT:g}%)",
                "ok": open_risk + config.RISK_PERCENT <= config.MAX_TOTAL_RISK_PCT}
        for side in conditions:
            conditions[side].append(item)
        if config.NY_SIGNALS and config.DRIFT_AUTO_PAUSE and self.drift.get("ny", {}).get("alarm"):
            for side in conditions:
                conditions[side].append({"label": "Live results back within the backtest's range (drift alarm)",
                                         "ok": False})
        limited = self.loss_pause(now.timestamp())
        if config.LOSS_LIMITS:
            item = {"label": "Within the loss limits" + (f" (paused: {limited[0]})" if limited else ""),
                    "ok": limited is None}
            for side in conditions:
                conditions[side].append(item)
        upcoming = self.news.upcoming(now)

        pos = self.position
        if pos:
            now_price = bid if pos["side"] == "BUY" else ask
            move = now_price - pos["entry"] if pos["side"] == "BUY" else pos["entry"] - now_price
            lots = pos.get("size", {}).get("lots")
            pos = {**pos, "pnl": move, "pnl_usd": sizing.money(move, lots) if lots else None}

        state = {
            "symbol": self.symbol,
            "timeframe": "3s demo" if self.demo else config.TIMEFRAME,
            "demo": self.demo,
            "updated": time.time(),
            "bid": bid,
            "ask": ask,
            "strategy": {"id": self.strategy_name, "name": self.strat.name, "summary": self.strat.summary},
            "display": {"tz": config.DISPLAY_TZ, "label": config.DISPLAY_TZ_LABEL, "short": config.DISPLAY_TZ_SHORT,
                        "offset": int(now.tz_convert(config.DISPLAY_TZ).utcoffset().total_seconds())},
            "windows": self.strat.windows(now),
            "account": {"balance": config.ACCOUNT_BALANCE, "risk_percent": config.RISK_PERCENT,
                        "max_risk_percent": config.MAX_RISK_PERCENT, "oz_per_lot": config.OZ_PER_LOT,
                        "min_lot": config.MIN_LOT},
            "candle_minutes": round(self.feed.candle_seconds(config.TIMEFRAME) / 60, 2),
            "session": {"open": status["open"], "message": status["message"], "hours": status["hours"]},
            "range": status["range"],
            "news": {"title": upcoming[1], "time": upcoming[0], "paused": paused is not None} if upcoming else None,
            # this week's high-impact US releases, for the website's news panel
            "news_week": [{"time": int(w.timestamp()), "title": title} for w, title in self.news.events]
            if self.news.enabled else [],
            "news_pause_minutes": config.NEWS_PAUSE_MINUTES,
            "loss_pause": {"reason": limited[0], "until": int(limited[1])} if limited else None,
            "swing_paper": self.swing.summary() if self.swing else None,
            "daily_trend": self.trend.summary(bid) if self.trend else None,
            "h4_trend": self.h4trend.summary(bid) if self.h4trend else None,
            "ny_signals": config.NY_SIGNALS,
            # live vs backtest per rule (daily drift check): percentile of the live total, alarm on/off
            "drift": self.drift,
            "drift_min_trades": config.DRIFT_MIN_TRADES,
            # public Telegram channel with the same alerts (set TELEGRAM_CHANNEL_URL on the host)
            "telegram_url": os.getenv("TELEGRAM_CHANNEL_URL") or None,
            # private chat with the bot (Ask Dojo), e.g. https://t.me/golddojo_alerts_bot
            "telegram_bot_url": (os.getenv("TELEGRAM_BOT_URL") or None) if self.ask and self.ask.enabled else None,
            "bot_health": self.health_summary(),
            "price_check": self.price_result,
            # where the daily / 4-hour signal candles come from: "Twelve Data" (real XAU/USD) or "PAXG"
            "candle_source": getattr(self.feed, "candle_source", lambda: None)(),
            # share of the last day of signal candles built from real XAUUSD prices (None: PAXG-only feed)
            "real_candles": getattr(self.feed, "real_share", lambda: None)(),
            "indicators": {
                "ema_fast": last["ema_fast"], "ema_slow": last["ema_slow"], "ema_trend": last["ema_trend"],
                "rsi": last["rsi"], "atr": last["atr"],
                "periods": [config.EMA_FAST, config.EMA_SLOW, config.EMA_TREND],
            },
            "conditions": conditions,
            "position": pos,
            "history": self.history,
            "chart": {"timeframes": config.CHART_TIMEFRAMES, "default": config.TIMEFRAME},
        }
        live_state.write(state)      # this PC (handy for checking what the bot sees)
        self.cloud.publish(state)    # Supabase -> the website

    def health_summary(self):
        """For the admin page: version, uptime, restarts and errors, price source, Telegram."""
        import binance_feed
        starts = self.report.starts if self.report else []
        now = time.time()
        return {
            "version": (os.getenv("RENDER_GIT_COMMIT") or "")[:7] or None,
            "started": starts[-1] if starts else None,
            "restarts_24h": sum(t > now - 86400 for t in starts[1:]),
            "errors": self.report.errors if self.report else 0,
            "last_error": self.report.last_error if self.report else None,
            "source": binance_feed._printed.get("source") or config.PRICE_FEED,
            "telegram": self.telegram,
            "weekly_sent": self.weekly_sent,
        }

    # --- main loop ---------------------------------------------------------
    def start(self):
        """Connect and load the first candles, retrying (not exiting) while price sources refuse."""
        wait = 5
        while True:
            try:
                self.feed.connect()
                self.symbol = self.feed.resolve_symbol(config.SYMBOL)
                self.df = self.prepared()
                return
            except Exception as e:
                print(f"{datetime.now():%H:%M:%S} can't get prices yet ({e}); retrying in {wait}s")
            # Still alive, just waiting: keep the health page green so the host doesn't restart us
            # into the same refusal
            if self.health:
                self.health.touch(waiting_for_prices=True)
            time.sleep(wait)
            wait = min(wait * 2, 60)

    def new_candle_due(self, now):
        """Clock-based check (free feeds): only ask for candles just after a candle should have closed,
        instead of polling the exchange twice a second. Returns True when it's time to look."""
        if not hasattr(self.feed, "market_open"):
            return True  # MT5 / demo: asking is local and cheap
        step = self.feed.candle_seconds(config.TIMEFRAME)
        boundary = int(now // step) * step
        if boundary <= self.checked_boundary or now - boundary < CANDLE_SETTLE_SECONDS:
            return False
        closed_bar = pd.Timestamp(boundary - step, unit="s", tz="UTC")
        if closed_bar <= self.last_bar_time or not self.feed.market_open(closed_bar):
            self.checked_boundary = boundary  # nothing new can exist (e.g. weekend)
            return False
        if now - boundary > CANDLE_GIVE_UP_SECONDS:
            self.checked_boundary = boundary
            return False
        return now >= self.next_candle_check

    def post_health_report(self):
        """Once a day, a short "is the bot healthy" message in the website chat."""
        if not self.report or not self.cloud.enabled or not self.report.due():
            return
        import binance_feed
        source = binance_feed._printed.get("source") or config.PRICE_FEED
        nxt = None
        windows = self.strat.windows(pd.Timestamp.now(tz="UTC")) if config.NY_SIGNALS else []
        if windows:
            w = windows[0]
            start = pd.Timestamp(w["range_start"] or w["first_entry"], unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
            nxt = f"{w['name']} {start:%a} {strategy.clock12(start)} {config.DISPLAY_TZ_SHORT}"
        text = self.report.text(self.history, source, nxt)
        self.cloud.post_chat(text, room=config.HEALTH_REPORT_ROOM)
        self.report.posted()
        print(f"{datetime.now():%H:%M:%S} health report: {text}")

    def run(self):
        if self.recorder:
            # Real prices recorded before a restart, so candles stay real across restarts
            saved = self.cloud.load_minutes()
            for row in saved:
                real_candles.add(row)
            if saved:
                print(f"Loaded {len(saved)} saved minutes of real XAUUSD prices")
        self.start()
        # Fill in each rule's trigger and "waiting for" right away, not only at the next candle close
        # (also catches up on any day / 4-hour candle that closed while the bot was down)
        for tracker, bars in ((self.trend, self.daily_bars), (self.h4trend, self.h4_bars)):
            if tracker:
                for e in tracker.update(bars()):
                    self.announce_trend(e)
        if self.ask:
            self.ask.start()
        if self.report:
            self.report.started()
        self.last_bar_time = self.df["time"].iat[-1]  # don't alert on a stale candle at startup
        self.checked_boundary = 0
        self.next_candle_check = 0.0
        errors = 0
        # Make sure everything already recorded is in the journal (Supabase ignores duplicates)
        self.cloud.journal([{**e, "symbol": e.get("symbol", self.symbol)} for e in reversed(self.history)])
        poll = 0.5 if self.demo else config.POLL_SECONDS
        print(f"Watching {self.symbol} {config.TIMEFRAME} with {self.strat.name}"
              f"{' (DEMO prices)' if self.demo else ''}. Telegram {'on' if self.telegram else 'off'}, "
              f"news pause {'on' if self.news.enabled else 'off'}, "
              f"website (Supabase) {'on' if self.cloud.enabled else 'off'}. Ctrl+C to stop.")

        try:
            while True:
                try:
                    tick = self.feed.get_tick(self.symbol)
                    if tick:
                        bid, ask = tick
                        real = getattr(self.feed, "tick_is_real", lambda: False)()
                        if self.recorder and real and (row := self.recorder.tick(bid, ask)):
                            self.cloud.record_minute(row)
                            real_candles.add(row)  # this minute now counts toward real candles
                        if self.position:
                            self.check_sl_tp(bid, ask)
                        now = time.time()
                        if self.new_candle_due(now):
                            bar_time = self.feed.get_bars(self.symbol, config.TIMEFRAME, 2)["time"].iat[-1]
                            if bar_time != self.last_bar_time:
                                self.last_bar_time = bar_time
                                self.checked_boundary = int(now // self.feed.candle_seconds(config.TIMEFRAME)) \
                                    * self.feed.candle_seconds(config.TIMEFRAME)
                                self.on_candle_close()
                            else:  # the source hasn't published the new candle yet
                                self.next_candle_check = now + CANDLE_RETRY_SECONDS
                        self.last_bid = bid
                        self.check_near(bid)
                        self.post_weekly(bid)
                        self.post_monthly()
                        self.weekly_backup()
                        self.check_prices()
                        self.save()
                        self.publish(bid, ask)
                        self.post_health_report()
                        self.check_drift()
                        self.watch_silence(real)
                    errors = 0
                except Exception as e:  # keep running through temporary network hiccups / refusals
                    errors += 1
                    print(f"{datetime.now():%H:%M:%S} error: {e}")
                    if self.report:
                        self.report.error(e)
                    try:
                        if not self.feed.is_connected():
                            self.feed.connect()
                    except Exception as e2:
                        print(f"{datetime.now():%H:%M:%S} reconnect failed: {e2}")
                if self.health:
                    self.health.touch(symbol=self.symbol, position=bool(self.position), waiting_for_prices=errors > 0)
                # back off while things fail: 1s, 2s, 4s ... up to 30s
                time.sleep(poll if errors == 0 else min(2 ** (errors - 1), 30))
        except KeyboardInterrupt:
            print("Stopped.")
        finally:
            self.cloud.stop()
            self.feed.shutdown()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="use fake prices instead of MetaTrader 5")
    ap.add_argument("--strategy", choices=["orb", "ema"], default=config.STRATEGY)
    args = ap.parse_args()
    lock = single_instance() if not args.demo else None  # noqa: F841 (held until exit)
    if args.demo:
        import demo_feed as feed
        config.SESSION_START_HOUR, config.SESSION_END_HOUR = 0, 24
        config.TRADE_WEEKDAYS = set(range(7))
        # Looser EMA filters so demo signals show up every couple of minutes
        config.EMA_TREND = 50
        config.RSI_BUY_RANGE, config.RSI_SELL_RANGE = (45, 85), (15, 55)
    elif config.PRICE_FEED == "mt5":
        import mt5_data as feed
    elif config.PRICE_FEED == "binance":
        import binance_feed as feed
    else:
        import xauusd_feed as feed
    bot = Bot(feed, args.demo, args.strategy)
    if os.getenv("PORT"):  # hosted as a web service (Render): answer health checks and pings
        bot.health = health.Health()
        bot.health.serve(int(os.environ["PORT"]))
    bot.run()


if __name__ == "__main__":
    main()
