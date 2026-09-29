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

import cloud_state
import config
import live_state
import news
import sessions
import sizing
import strategy
import telegram_notify

STATE_FILE = Path(__file__).with_name("state.json")
HISTORY_LIMIT = 50
DAILY_REFRESH_SECONDS = 600


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
        self.last_bar_time = None
        self.position, self.history = self.load()

    # --- persistence -------------------------------------------------------
    def load(self):
        if self.demo:
            return None, []
        try:
            data = json.loads(STATE_FILE.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None, []
        if data and "side" in data:  # older state.json held only the position
            return data, []
        data = data or {}
        self.strat.state.update(data.get("strategy_state", {}).get(self.strategy_name, {}))
        return data.get("position"), data.get("history", [])

    def save(self):
        if not self.demo:
            STATE_FILE.write_text(json.dumps({
                "position": self.position,
                "history": self.history,
                "strategy_state": {self.strategy_name: self.strat.state},
            }))

    # --- data --------------------------------------------------------------
    def daily_bars(self):
        if self.daily is None or time.time() - self.daily_at > DAILY_REFRESH_SECONDS:
            self.daily = self.feed.get_bars(self.symbol, "D1", 150)
            self.daily_at = time.time()
        return self.daily

    def prepared(self, include_forming=False):
        bars = self.feed.get_bars(self.symbol, config.TIMEFRAME, 600, include_forming=include_forming)
        return self.strat.prepare(bars, self.daily_bars())

    # --- signal events -----------------------------------------------------
    def record(self, event):
        event["time"] = int(time.time())
        event["id"] = f"{event['time']}-{event['type']}-{len(self.history)}"
        self.history = ([event] + self.history)[:HISTORY_LIMIT]
        print(f"{datetime.now():%H:%M:%S} >>> {event['type'].upper()} {event['side']} @ {fmt(event['price'])}"
              f" ({event.get('reason', '')})")

    def open(self, sig, df, i):
        bid, ask = self.feed.get_tick(self.symbol)
        entry = ask if sig.side == "BUY" else bid
        lv = strategy.levels(sig.side, entry, sig.stop, sig.rr)
        if lv is None:
            print(f"{datetime.now():%H:%M:%S} skipped {sig.side}: price already past the stop")
            return
        sl, tp = lv
        size = sizing.lot_size(entry, sl, tp)
        self.strat.on_open(sig)
        self.position = {"side": sig.side, "entry": entry, "sl": sl, "tp": tp, "atr": df["atr"].iat[i],
                         "rsi": df["rsi"].iat[i], "opened": int(time.time()), "expires": sig.expires,
                         "reason": sig.reason, "size": size}
        self.record({"type": "open", "side": sig.side, "price": entry, "sl": sl, "tp": tp, "reason": sig.reason,
                     "size": size})
        if self.telegram:
            icon = "🟢" if sig.side == "BUY" else "🔴"
            warning = "" if size["verdict"] == "ok" else f"\n⚠️ {size['note']}"
            telegram_notify.send(f"{icon} <b>{sig.side} {self.symbol}</b> ({config.TIMEFRAME}, {self.strat.name})\n"
                                 f"{sig.reason}\nEntry: <b>{fmt(entry)}</b>\nStop loss: {fmt(sl)}\n"
                                 f"Take profit: {fmt(tp)}\n"
                                 f"Size: <b>{size['lots']:.2f} lot</b> (risk ${size['risk']:.2f}, "
                                 f"target ${size['reward']:.2f}){warning}")

    def close(self, price, reason):
        pos = self.position
        move = price - pos["entry"] if pos["side"] == "BUY" else pos["entry"] - price
        lots = pos.get("size", {}).get("lots")
        usd = sizing.money(move, lots) if lots else None
        self.record({"type": "close", "side": pos["side"], "price": price, "entry": pos["entry"],
                     "pnl": move, "reason": reason, "lots": lots, "pnl_usd": usd})
        self.position = None
        if self.telegram:
            icon, result = ("✅", "PROFIT") if move > 0 else ("❌", "LOSS") if move < 0 else ("➖", "BREAK-EVEN")
            money = f" = <b>{'+' if usd >= 0 else '−'}${abs(usd):.2f}</b> at {lots:.2f} lot" if lots else ""
            telegram_notify.send(f"{icon} <b>{result}: CLOSE {pos['side']} {self.symbol}</b> — {reason}\n"
                                 f"Entry {fmt(pos['entry'])} → Exit {fmt(price)}\n"
                                 f"Result: {move:+.2f} $/oz{money}")

    # --- checks ------------------------------------------------------------
    def check_sl_tp(self, bid, ask):
        pos = self.position
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
        i = len(df) - 1

        if self.position:
            reason = self.strat.exit(self.position, df, i)
            if reason:
                self.close(df["close"].iat[i], reason)

        sig = self.strat.entry(df, i)
        if sig and not self.position:
            paused = self.news.pause_reason(pd.Timestamp.now(tz="UTC"))
            if paused:
                print(f"{datetime.now():%H:%M:%S} skipped {sig.side} ({sig.reason}): news pause for {paused}")
            else:
                self.open(sig, df, i)

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
    def run(self):
        self.feed.connect()
        self.symbol = self.feed.resolve_symbol(config.SYMBOL)
        self.df = self.prepared()
        self.last_bar_time = self.df["time"].iat[-1]  # don't alert on a stale candle at startup
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
                        if self.position:
                            self.check_sl_tp(bid, ask)
                        bar_time = self.feed.get_bars(self.symbol, config.TIMEFRAME, 2)["time"].iat[-1]
                        if bar_time != self.last_bar_time:
                            self.last_bar_time = bar_time
                            self.on_candle_close()
                        self.save()
                        self.publish(bid, ask)
                except Exception as e:  # keep running through temporary MT5/network hiccups
                    print(f"{datetime.now():%H:%M:%S} error: {e}")
                    if not self.feed.is_connected():
                        self.feed.connect()
                time.sleep(poll)
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
    Bot(feed, args.demo, args.strategy).run()


if __name__ == "__main__":
    main()
