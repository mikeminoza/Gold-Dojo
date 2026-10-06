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
from datetime import datetime
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

load_dotenv()

import backtest_refresh
import cloud_state
import config
import health
import health_report
import live_state
import loss_guard
import market_recorder
import session_recap
import swing_paper
import news
import sessions
import sizing
import strategy
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
        # Demo signals are random, so they never go to the real website
        self.cloud = cloud_state.CloudPublisher(enabled=not demo)
        # Keeps the website's backtest running up to the latest session (needs publish_backtest.py once)
        self.backtest = backtest_refresh.BacktestRefresher(self.cloud, feed.candle_seconds(config.TIMEFRAME))
        self.last_bar_time = None
        self._swing_mem = self._report_mem = None  # set by load()
        self.position, self.history = self.load()
        self.report = health_report.HealthReport(self._report_mem) if config.HEALTH_REPORT and not demo else None
        self.recorder = (market_recorder.MinuteRecorder(getattr(feed, "gap", None))
                         if config.RECORD_MARKET_DATA and not demo else None)
        self.swing = swing_paper.SwingPaper(self._swing_mem) if config.SWING_PAPER and not demo else None
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
        STATE_FILE.write_text(json.dumps(memory, default=live_state._plain))
        self.cloud.remember(memory)  # a copy in Supabase survives restarts on hosts that wipe their disk

    # --- data --------------------------------------------------------------
    def daily_bars(self):
        if self.daily is None or time.time() - self.daily_at > DAILY_REFRESH_SECONDS:
            self.daily = self.feed.get_bars(self.symbol, "D1", 150)
            self.daily_at = time.time()
        return self.daily

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
                     "size": size, "session": session, "context": self.context(sig, df, i)})
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
        i = len(df) - 1

        if self.position:
            reason = self.strat.exit(self.position, df, i)
            if reason:
                self.close(df["close"].iat[i], reason)

        sig = self.strat.entry(df, i)
        if sig and not self.position:
            paused = self.news.pause_reason(pd.Timestamp.now(tz="UTC"))
            limited = self.loss_pause(time.time())
            if paused:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): news pause for {paused}")
                self.strat.state.setdefault("skipped", {})[sig.tag] = f"news pause for {paused}"
            elif limited:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): loss limit, {limited[0]}")
                self.strat.state.setdefault("skipped", {})[sig.tag] = f"loss limit ({limited[0]})"
            else:
                self.open(sig, df, i)
        self.post_recaps(df)

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
        windows = self.strat.windows(pd.Timestamp.now(tz="UTC"))
        if windows:
            w = windows[0]
            start = pd.Timestamp(w["range_start"] or w["first_entry"], unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
            nxt = f"{w['name']} {start:%a} {strategy.clock12(start)} {config.DISPLAY_TZ_SHORT}"
        text = self.report.text(self.history, source, nxt)
        self.cloud.post_chat(text, room=config.HEALTH_REPORT_ROOM)
        self.report.posted()
        print(f"{datetime.now():%H:%M:%S} health report: {text}")

    def run(self):
        self.start()
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
                        if self.recorder and (row := self.recorder.tick(bid, ask)):
                            self.cloud.record_minute(row)
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
                        self.save()
                        self.publish(bid, ask)
                        self.post_health_report()
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
