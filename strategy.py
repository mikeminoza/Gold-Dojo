"""Strategies. The live bot and the backtester both drive these through the same interface,
so a strategy behaves identically in both:

    df = strat.prepare(bars, daily_bars)   # add indicators / session columns
    sig = strat.entry(df, i)               # Signal or None for the closed candle i
    strat.on_open(sig)                     # a trade was opened from sig
    reason = strat.exit(pos, df, i)        # early-exit reason or None (SL/TP are checked by the caller)
"""
from dataclasses import dataclass
from datetime import datetime, time

import numpy as np
import pandas as pd

import config
import sessions


@dataclass
class Signal:
    side: str               # "BUY" / "SELL"
    stop: float             # stop loss price, from the signal candle
    rr: float               # take profit = rr x risk
    reason: str
    tag: str | None = None  # e.g. the session id
    expires: int | None = None  # UTC seconds: close the trade at this time if still open


def levels(side, entry, stop, rr):
    """Stop loss and take profit for an actual entry price. None if price already ran past the stop."""
    risk = entry - stop if side == "BUY" else stop - entry
    if risk <= 0:
        return None
    return stop, entry + rr * risk if side == "BUY" else entry - rr * risk


def clock12(ts):
    """12-hour time without a leading zero, e.g. "3:00 PM"."""
    return ts.strftime("%I:%M %p").lstrip("0")


def local_hm(ts):
    """Time in the website's display time zone, labelled, e.g. "3:00 PM PH"."""
    return f"{clock12(ts.tz_convert(config.DISPLAY_TZ))} {config.DISPLAY_TZ_SHORT}"


def add_indicators(df):
    df = df.copy()
    close = df["close"]
    df["ema_fast"] = close.ewm(span=config.EMA_FAST, adjust=False).mean()
    df["ema_slow"] = close.ewm(span=config.EMA_SLOW, adjust=False).mean()
    df["ema_trend"] = close.ewm(span=config.EMA_TREND, adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / config.RSI_PERIOD, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / config.RSI_PERIOD, adjust=False).mean()
    df["rsi"] = 100 - 100 / (1 + gain / loss)

    prev_close = close.shift()
    true_range = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    df["atr"] = true_range.ewm(alpha=1 / config.ATR_PERIOD, adjust=False).mean()
    return df


def crossover(df, i):
    """'up' / 'down' if the fast EMA crossed the slow EMA on candle i, else None."""
    prev_diff = df["ema_fast"].iat[i - 1] - df["ema_slow"].iat[i - 1]
    diff = df["ema_fast"].iat[i] - df["ema_slow"].iat[i]
    if prev_diff <= 0 < diff:
        return "up"
    if prev_diff >= 0 > diff:
        return "down"
    return None


def in_session(ts_utc):
    """Is this UTC timestamp inside the EMA strategy's trading hours, in the PC's local time?"""
    local = ts_utc.to_pydatetime().astimezone()
    if local.weekday() not in config.TRADE_WEEKDAYS:
        return False
    return config.SESSION_START_HOUR <= local.hour < config.SESSION_END_HOUR


class EmaCross:
    name = "EMA crossover"

    def __init__(self, candle_seconds):
        self.candle = pd.Timedelta(seconds=candle_seconds)
        self.state = {}

    @property
    def summary(self):
        return (f"A signal fires when EMA {config.EMA_FAST} crosses EMA {config.EMA_SLOW} "
                f"with everything below lined up.")

    def prepare(self, df, daily=None):
        return add_indicators(df)

    def entry(self, df, i):
        if i < config.EMA_TREND or not in_session(df["time"].iat[i] + self.candle):
            return None
        cross = crossover(df, i)
        close, trend, rsi, atr = (df[c].iat[i] for c in ("close", "ema_trend", "rsi", "atr"))
        rr = config.TP_ATR_MULT / config.SL_ATR_MULT
        (blo, bhi), (slo, shi) = config.RSI_BUY_RANGE, config.RSI_SELL_RANGE
        if cross == "up" and close > trend and blo <= rsi <= bhi:
            return Signal("BUY", close - config.SL_ATR_MULT * atr, rr, "EMAs crossed up")
        if cross == "down" and close < trend and slo <= rsi <= shi:
            return Signal("SELL", close + config.SL_ATR_MULT * atr, rr, "EMAs crossed down")
        return None

    def on_open(self, sig):
        pass

    def exit(self, pos, df, i):
        if not config.CLOSE_ON_OPPOSITE_CROSS:
            return None
        cross = crossover(df, i)
        if (pos["side"] == "BUY" and cross == "down") or (pos["side"] == "SELL" and cross == "up"):
            return "EMAs crossed back"
        return None

    def status(self, df, now):
        """What the website shows while waiting: (is it trading time, message, hours text)."""
        open_now = in_session(now)
        start, end = config.SESSION_START_HOUR, config.SESSION_END_HOUR
        h12 = lambda h: f"{(h % 12) or 12}:00 {'AM' if h % 24 < 12 else 'PM'}"
        hours = "All day" if end - start >= 24 else f"{h12(start)}–{h12(end)} {config.DISPLAY_TZ_SHORT}"
        msg = ("No open signal. Watching every candle for the next one." if open_now
               else f"Outside your trading hours. New signals start again at {h12(start)} {config.DISPLAY_TZ_SHORT}.")
        return {"open": open_now, "message": msg, "hours": hours, "range": None}

    def windows(self, now):
        """When a signal can be placed: any candle close inside the trading hours (PC local time)."""
        local = now.to_pydatetime().astimezone()
        start = local.replace(hour=config.SESSION_START_HOUR % 24, minute=0, second=0, microsecond=0)
        end = start + pd.Timedelta(hours=config.SESSION_END_HOUR - config.SESSION_START_HOUR)
        if end <= local:
            start, end = start + pd.Timedelta(days=1), end + pd.Timedelta(days=1)
        first = pd.Timestamp(start) + self.candle
        return [{
            "name": "Trading hours",
            "tz": None,
            "range_start": None, "range_end": None,
            "first_entry": int(first.timestamp()),
            "last_entry": int((pd.Timestamp(end) - self.candle).timestamp()),
            "close": None,
            "state": "trading" if start <= local < end else "later",
            "traded": False,
        }]

    def conditions(self, df, now):
        i = len(df) - 1
        close, trend = df["close"].iat[i], df["ema_trend"].iat[i]
        fast, slow, rsi = df["ema_fast"].iat[i], df["ema_slow"].iat[i], df["rsi"].iat[i]
        session = in_session(now)
        (blo, bhi), (slo, shi) = config.RSI_BUY_RANGE, config.RSI_SELL_RANGE
        return {
            "BUY": [
                {"label": f"Price above EMA {config.EMA_TREND}", "ok": bool(close > trend)},
                {"label": f"EMA {config.EMA_FAST} above EMA {config.EMA_SLOW}", "ok": bool(fast > slow)},
                {"label": f"RSI between {blo} and {bhi}", "ok": bool(blo <= rsi <= bhi)},
                {"label": "Inside trading hours", "ok": session},
            ],
            "SELL": [
                {"label": f"Price below EMA {config.EMA_TREND}", "ok": bool(close < trend)},
                {"label": f"EMA {config.EMA_FAST} below EMA {config.EMA_SLOW}", "ok": bool(fast < slow)},
                {"label": f"RSI between {slo} and {shi}", "ok": bool(slo <= rsi <= shi)},
                {"label": "Inside trading hours", "ok": session},
            ],
        }


class SessionBreakout:
    """Opening range breakout of the London and New York sessions, with the daily trend.

    1. Mark the high/low of the first ORB_RANGE_MINUTES of the session.
    2. BUY on a candle close above the range high if the daily trend is up (SELL mirrored).
    3. Stop = other side of the range (kept between ORB_MIN/MAX_STOP_ATR x ATR). Target = ORB_RR x risk.
    4. One trade per session; anything still open closes when the session ends.
    """

    name = "Session breakout"

    def __init__(self, candle_seconds, clock=None):
        self.candle = pd.Timedelta(seconds=candle_seconds)
        self.clock = clock or sessions.MarketClock()
        self.state = {"taken": []}  # session ids already traded (persisted by the live bot)

    @property
    def summary(self):
        return (f"Trades the breakout of the first {config.ORB_RANGE_MINUTES} minutes of the London "
                f"and New York sessions, in the direction of the daily trend. One trade per session.")

    def prepare(self, df, daily=None):
        df = add_indicators(df)
        found = [self.clock.session_at(t) for t in df["time"]]
        df["sess"] = [s.id if s else None for s in found]
        df["sess_name"] = [s.name if s else None for s in found]
        df["sess_end"] = [int(s.end.timestamp()) if s else 0 for s in found]
        df["phase"] = [
            None if s is None else "range" if t < s.range_end else "trade" if t + self.candle <= s.end else None
            for t, s in zip(df["time"], found)
        ]
        in_range = df[df["phase"] == "range"].groupby("sess").agg(range_hi=("high", "max"), range_lo=("low", "min"))
        df = df.join(in_range, on="sess")

        # Daily trend, using only daily candles that had closed before each intraday candle started
        if daily is None or len(daily) == 0:
            daily = df
        daily = daily[["time", "close"]].copy()
        daily["daily_ema"] = daily["close"].ewm(span=config.DAILY_TREND_EMA, adjust=False).mean()
        day_len = daily["time"].diff().median()
        daily["available"] = daily["time"] + day_len
        daily = daily.rename(columns={"close": "daily_close"})[["available", "daily_close", "daily_ema"]]
        df = pd.merge_asof(df.sort_values("time"), daily.sort_values("available"),
                           left_on="time", right_on="available", direction="backward")
        df["trend"] = np.sign(df["daily_close"] - df["daily_ema"]).fillna(0)
        return df.reset_index(drop=True)

    def entry(self, df, i):
        row = df.iloc[i]
        if row["phase"] != "trade" or row["sess"] in self.state["taken"] or pd.isna(row["range_hi"]):
            return None
        # The trade opens when this candle closes; skip if that leaves no time before the session ends
        if (row["time"] + 2 * self.candle).timestamp() > row["sess_end"]:
            return None
        close, atr, hi, lo = row["close"], row["atr"], row["range_hi"], row["range_lo"]
        if close > hi and row["trend"] > 0:
            side, stop = "BUY", lo
        elif close < lo and row["trend"] < 0:
            side, stop = "SELL", hi
        else:
            return None
        dist = min(max(abs(close - stop), config.ORB_MIN_STOP_ATR * atr), config.ORB_MAX_STOP_ATR * atr)
        stop = close - dist if side == "BUY" else close + dist
        edge = "above" if side == "BUY" else "below"
        return Signal(side, stop, config.ORB_RR,
                      f"{row['sess_name']} breakout {edge} {hi if side == 'BUY' else lo:.2f}",
                      tag=row["sess"], expires=int(row["sess_end"]))

    def on_open(self, sig):
        self.state["taken"] = (self.state.get("taken", []) + [sig.tag])[-20:]

    def exit(self, pos, df, i):
        expires = pos.get("expires")
        if expires and (df["time"].iat[i] + self.candle).timestamp() >= expires:
            return "Session ended"
        return None

    def _current(self, df, now):
        s = self.clock.session_at(now)
        if s is None:
            return None, None
        rows = df[(df["sess"] == s.id) & (df["phase"] == "range")]
        rng = None if rows.empty else {"hi": rows["high"].max(), "lo": rows["low"].min()}
        return s, rng

    def status(self, df, now):
        s, rng = self._current(df, now)
        # e.g. "London 15:00 PH (08:00 London time)" - PH time first, the exchange's own clock after
        hours = "\n".join(
            f"{d['name']} {local_hm(self._today(d, now))} ({clock12(self._today(d, now))} {d['name']} time)"
            for d in config.ORB_SESSIONS
        ) if isinstance(self.clock, sessions.MarketClock) else "Every 2 min"
        if s is None:
            nxt = self.clock.next_session(now)
            msg = f"No session open. Next is {nxt.name} at {local_hm(nxt.open)}." if nxt else "No session open."
            return {"open": False, "message": msg, "hours": hours, "range": None}
        if now < s.range_end:
            msg = f"{s.name} is open. Marking the opening range until {local_hm(s.range_end)}."
        elif s.id in self.state["taken"]:
            msg = f"Already traded {s.name} today. Next chance is the next session."
        else:
            msg = f"{s.name} range is set. Waiting for a candle to close outside it."
        label = f"{s.name} range" + (" (forming)" if now < s.range_end else "")
        return {"open": True, "message": msg, "hours": hours,
                "range": dict(rng, label=label, forming=bool(now < s.range_end)) if rng else None}

    def windows(self, now):
        """The current/next sessions and when a trade can actually be placed in each.

        Signals come on candle closes after the opening range, and need one candle left before
        the session ends: first chance = range end + 1 candle, last = session end - 1 candle.
        """
        out = []
        for s in self.clock.upcoming(now, n=2):
            state = "range" if s.open <= now < s.range_end else "trading" if s.range_end <= now < s.end else "later"
            out.append({
                "name": s.name,
                # the exchange's own time zone, so the page can show e.g. "8:00 AM in London"
                "tz": next((d["tz"] for d in config.ORB_SESSIONS if d["name"] == s.name), None)
                if isinstance(self.clock, sessions.MarketClock) else None,
                "range_start": int(s.open.timestamp()),
                "range_end": int(s.range_end.timestamp()),
                "first_entry": int((s.range_end + self.candle).timestamp()),
                "last_entry": int((s.end - self.candle).timestamp()),
                "close": int(s.end.timestamp()),
                "state": state,
                "traded": s.id in self.state["taken"],
            })
        return out

    def _today(self, d, now):
        """Today's open time for a session definition (daylight saving handled by the time zone)."""
        return pd.Timestamp(datetime.combine(now.tz_convert(d["tz"]).date(), time(*d["open"])), tz=d["tz"])

    def conditions(self, df, now):
        s, rng = self._current(df, now)
        last = df.iloc[-1]
        trend = last["trend"]
        tf = config.TIMEFRAME if isinstance(self.clock, sessions.MarketClock) else "Candle"
        ready = bool(s and now >= s.range_end and rng)
        if s is None:
            range_label = "A session is open"
        elif not ready:
            range_label = f"{s.name} opening range set (forming until {local_hm(s.range_end)})"
        else:
            range_label = f"{s.name} range set: {rng['lo']:.2f}–{rng['hi']:.2f}"
        fresh = bool(s and s.id not in self.state["taken"])
        hi = f"{rng['hi']:.2f}" if rng else "range high"
        lo = f"{rng['lo']:.2f}" if rng else "range low"
        return {
            "BUY": [
                {"label": f"Daily trend up (above {config.DAILY_TREND_EMA}-day EMA)", "ok": bool(trend > 0)},
                {"label": range_label, "ok": ready},
                {"label": f"{tf} close above {hi}", "ok": bool(ready and last["close"] > rng["hi"])},
                {"label": "No trade yet this session", "ok": fresh},
            ],
            "SELL": [
                {"label": f"Daily trend down (below {config.DAILY_TREND_EMA}-day EMA)", "ok": bool(trend < 0)},
                {"label": range_label, "ok": ready},
                {"label": f"{tf} close below {lo}", "ok": bool(ready and last["close"] < rng["lo"])},
                {"label": "No trade yet this session", "ok": fresh},
            ],
        }


def create(name, candle_seconds, clock=None):
    if name == "orb":
        return SessionBreakout(candle_seconds, clock)
    if name == "ema":
        return EmaCross(candle_seconds)
    raise ValueError(f"Unknown strategy {name!r} (use 'orb' or 'ema')")
