"""Real XAUUSD candles, built from the live spot quotes the bot records every minute.

The free candle history is PAXG (a gold token) shifted to spot, which moves a little differently from
real gold within the day. The bot also sees real XAUUSD quotes (Swissquote) every second and saves a
one-minute summary of them (market_recorder.py). Here those minutes replace the PAXG candles wherever
they cover a candle well enough, so the opening range, breakouts and ATR the signals use come from
real prices. PAXG only fills older history and any stretch the bot wasn't running.
"""
import threading

import pandas as pd

COVERAGE = 0.8      # a candle uses real prices when at least 80% of its minutes were recorded
KEEP_MINUTES = 30 * 24 * 60  # about a month of minutes in memory
STEP = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240}

_lock = threading.Lock()
_minutes = {}  # minute start (UTC seconds) -> (open, high, low, close) of the mid price


def add(row):
    """Add one recorded minute (a market_recorder row, or one loaded back from Supabase)."""
    half = (row.get("spread_avg") or 0) / 2  # bid + half the spread = mid, like the PAXG candles
    t = int(pd.Timestamp(row["minute"]).timestamp())
    with _lock:
        _minutes[t] = (row["bid_open"] + half, row["bid_high"] + half, row["bid_low"] + half, row["bid_close"] + half)
        if len(_minutes) > KEEP_MINUTES:
            for k in sorted(_minutes)[: len(_minutes) - KEEP_MINUTES]:
                del _minutes[k]


def count():
    with _lock:
        return len(_minutes)


def overlay(df, timeframe):
    """Candles (with a UTC `time` column) where every well-covered candle uses the real recorded prices.
    Returns (candles, how many of them are real)."""
    step = STEP.get(timeframe)
    if step is None or df.empty:
        return df, 0
    with _lock:
        mins = dict(_minutes)
    if not mins:
        return df, 0
    out = df.copy()
    real = 0
    for i, t in enumerate(out["time"]):
        start = int(t.timestamp())
        bars = [mins[m] for m in range(start, start + step * 60, 60) if m in mins]
        if len(bars) < COVERAGE * step:
            continue
        out.iat[i, out.columns.get_loc("open")] = round(bars[0][0], 2)
        out.iat[i, out.columns.get_loc("high")] = round(max(b[1] for b in bars), 2)
        out.iat[i, out.columns.get_loc("low")] = round(min(b[2] for b in bars), 2)
        out.iat[i, out.columns.get_loc("close")] = round(bars[-1][3], 2)
        real += 1
    return out, real
