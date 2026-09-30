"""The ONE shared feature function for the "similar past trades" filter.

Used by ml/build_memory.py (research) and, later, the live filter, so both compute the numbers the
same way. Everything is read from the signal candle `i` (the candle whose close triggered the
entry) or earlier rows, i.e. only information known when that candle closed.

`df` must come from SessionBreakout.prepare (columns: open/high/low/close, atr, rsi, range_hi,
range_lo, daily_close, daily_ema, sess, time).
"""
import math

import pandas as pd

import sessions

# Columns fed to the models, in a fixed order
FEATURES = ["range_atr", "break_atr", "trend_strength", "rsi", "atr_pct", "atr_change",
            "candle_body", "minutes_in", "weekday_sin", "weekday_cos", "side"]

ATR_LOOKBACK = 20  # atr_change = atr now / atr this many candles earlier

_default_clock = None


def _clock():
    global _default_clock
    if _default_clock is None:
        _default_clock = sessions.MarketClock()
    return _default_clock


def features(df, i, side, candle_seconds, clock=None):
    """Feature dict for a signal on closed candle i. side = "BUY" / "SELL"."""
    row = df.iloc[i]
    close, atr = float(row["close"]), float(row["atr"])
    hi, lo = float(row["range_hi"]), float(row["range_lo"])
    sign = 1 if side == "BUY" else -1

    prev_atr = float(df["atr"].iat[i - ATR_LOOKBACK]) if i >= ATR_LOOKBACK else float("nan")
    bar = float(row["high"] - row["low"])

    # Minutes from session open to the moment the signal candle closed
    t = row["time"]
    s = (clock or _clock()).session_at(t)
    close_time = t + pd.Timedelta(seconds=candle_seconds)
    minutes_in = (close_time - s.open).total_seconds() / 60 if s else float("nan")

    wd = close_time.tz_convert("America/New_York").weekday()  # 0-4, the session's own day
    return {
        "range_atr": (hi - lo) / atr,
        "break_atr": (close - hi) / atr if side == "BUY" else (lo - close) / atr,
        "trend_strength": sign * (float(row["daily_close"]) - float(row["daily_ema"])) / float(row["daily_ema"]) * 100,
        "rsi": float(row["rsi"]),
        "atr_pct": atr / close * 100,
        "atr_change": atr / prev_atr if prev_atr else float("nan"),
        "candle_body": abs(close - float(row["open"])) / bar if bar > 0 else 0.0,
        "minutes_in": minutes_in,
        "weekday_sin": math.sin(2 * math.pi * wd / 5),
        "weekday_cos": math.cos(2 * math.pi * wd / 5),
        "side": float(sign),
    }


def matrix(rows):
    """Feature rows (list of dicts or DataFrame) -> numpy array in FEATURES order."""
    frame = pd.DataFrame(rows)
    return frame[FEATURES].to_numpy(dtype=float)
