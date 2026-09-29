"""Fake gold prices with fast candles, so the bot and website can be tried without MetaTrader 5.

Same functions as mt5_data. Prices are random, so demo signals mean nothing.
"""
import math
import random
import time

import pandas as pd

CANDLE_SECONDS = 3
STEPS_PER_CANDLE = 8
STEP_SECONDS = CANDLE_SECONDS / STEPS_PER_CANDLE
_bars = []      # closed candles
_forming = None
_last_step = 0.0
_price = 2650.0


def _step(t):
    """One random price move, drifting in slow waves so trends and crossovers happen."""
    global _price
    drift = 0.35 * math.sin(t / 45) + 0.2 * math.sin(t / 11)
    _price += random.gauss(drift * 0.3, 0.9)
    return _price


def _new_candle(start):
    return {"time": start, "open": _price, "high": _price, "low": _price, "close": _price, "spread": 25,
            "tick_volume": 0}


def _tick_candle(candle, price):
    candle["high"] = max(candle["high"], price)
    candle["low"] = min(candle["low"], price)
    candle["close"] = price
    candle["tick_volume"] += random.randint(20, 120)


def connect():
    """Pre-generate history so indicators like EMA 200 are warmed up."""
    global _forming, _last_step
    now = int(time.time()) // CANDLE_SECONDS * CANDLE_SECONDS
    for n in range(2000, 0, -1):
        start = now - n * CANDLE_SECONDS
        candle = _new_candle(start)
        for k in range(STEPS_PER_CANDLE):
            _tick_candle(candle, _step(start + k * STEP_SECONDS))
        _bars.append(candle)
    _forming = _new_candle(now)
    _last_step = now


def _advance():
    """Move the price a fixed number of steps per candle, however often we're called."""
    global _forming, _last_step
    now = time.time()
    while _last_step + STEP_SECONDS <= now:
        _last_step += STEP_SECONDS
        while _forming["time"] + CANDLE_SECONDS <= _last_step:
            _bars.append(_forming)
            del _bars[:-2000]
            _forming = _new_candle(_forming["time"] + CANDLE_SECONDS)
        _tick_candle(_forming, _step(_last_step))


def resolve_symbol(preferred):
    return preferred


def get_bars(symbol, timeframe, count, include_forming=False):
    _advance()
    rows = _bars[-count:] + ([dict(_forming)] if include_forming else [])
    df = pd.DataFrame(rows)
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
    return df


# Demo chart timeframes: how many 3-second demo candles make one candle, so switching
# timeframes on the website visibly changes the chart
CHART_FACTOR = {"M1": 1, "M5": 1, "M15": 1, "M30": 2, "H1": 4, "H4": 10, "D1": 20}


def get_chart_bars(symbol, timeframe, count):
    """Candles for the website chart, including the forming one, merged to the demo timeframe."""
    df = get_bars(symbol, timeframe, 2000, include_forming=True)
    factor = CHART_FACTOR.get(timeframe, 1)
    if factor > 1:
        size = CANDLE_SECONDS * factor
        seconds = (df["time"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(seconds=1)
        df["bucket"] = seconds // size * size
        df = df.groupby("bucket").agg(open=("open", "first"), high=("high", "max"), low=("low", "min"),
                                      close=("close", "last"), tick_volume=("tick_volume", "sum")).reset_index()
        df["time"] = pd.to_datetime(df["bucket"], unit="s", utc=True)
    return df.tail(count).reset_index(drop=True)


def get_tick(symbol):
    _advance()
    return round(_price - 0.12, 2), round(_price + 0.13, 2)


def candle_seconds(timeframe):
    return CANDLE_SECONDS


def is_connected():
    return True


def shutdown():
    pass
