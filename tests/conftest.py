"""Shared fake market data for the tests: no network, no Supabase."""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def m30_day(day, base, breakout=0.0, wiggle=1.0):
    """One weekday of 30-minute candles (00:00-23:30 UTC). After the New York opening range
    (12:30-13:30 UTC in US summer time) price moves by `breakout` per candle until 15:00 UTC."""
    times = pd.date_range(f"{day} 00:00", periods=48, freq="30min", tz="UTC")
    start, end = pd.Timestamp(f"{day} 13:30", tz="UTC"), pd.Timestamp(f"{day} 15:00", tz="UTC")
    rows, price = [], base
    for t in times:
        move = breakout if start <= t < end else 0.0
        o, c = price, price + move
        rows.append({"time": t, "open": o, "high": max(o, c) + wiggle, "low": min(o, c) - wiggle, "close": c,
                     "tick_volume": 100})
        price = c
    return pd.DataFrame(rows)


@pytest.fixture
def daily_uptrend():
    """120 daily candles rising steadily, so the 50-day trend is up."""
    t = pd.date_range("2026-03-02", periods=120, freq="B", tz="UTC")
    c = 1800 + np.arange(120) * 2.0
    return pd.DataFrame({"time": t, "open": c - 1, "high": c + 3, "low": c - 3, "close": c, "tick_volume": 1})


@pytest.fixture
def breakout_bars():
    """Three quiet days, then a New York session that breaks well above its opening range."""
    days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]
    frames = [m30_day(d, 2000.0) for d in days[:-1]] + [m30_day(days[-1], 2000.0, breakout=6.0)]
    return pd.concat(frames, ignore_index=True)
