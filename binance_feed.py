"""Free, real-time gold prices from Binance's public market data (no account or API key).

Uses PAXG/USDT: PAX Gold is a token backed 1:1 by a troy ounce of physical gold, so it tracks the
gold spot price closely (usually a few dollars above it). Same functions as mt5_data.

PAXG trades 24/7 but real gold doesn't, so candles outside gold's market hours (the weekend and the
daily 17:00-18:00 New York break) are dropped, keeping indicators and sessions like the real market.
"""
import threading

import pandas as pd
import requests

import config

BASE_URL = "https://data-api.binance.vision"  # Binance's public market-data host
INTERVALS = {"M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m", "H1": "1h", "H4": "4h", "D1": "1d"}
MINUTES = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}
MAX_PER_REQUEST = 1000
POINT = 0.01

_local = threading.local()  # one HTTP session per thread (the chart export runs in its own thread)


def _get(path, **params):
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
    r = _local.session.get(BASE_URL + path, params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def _market_open(times):
    """True for candles inside gold's trading hours (Sun 18:00 - Fri 17:00 New York, minus the 17:00 break)."""
    ny = times.dt.tz_convert("America/New_York")
    day, hour = ny.dt.weekday, ny.dt.hour
    closed = (day == 5) | ((day == 6) & (hour < 18)) | ((day == 4) & (hour >= 17)) | (hour == 17)
    return ~closed


def _klines(symbol, timeframe, count, end_ms=None):
    """Newest `count` candles (paging back through history when more than 1000 are asked for)."""
    rows, end = [], end_ms
    while len(rows) < count:
        # Binance charges more rate-limit weight for bigger requests, so ask only for what's needed
        limit = min(MAX_PER_REQUEST, count - len(rows))
        params = {"symbol": symbol, "interval": INTERVALS[timeframe], "limit": limit}
        if end is not None:
            params["endTime"] = end
        batch = _get("/api/v3/klines", **params)
        if not batch:
            break
        rows = batch + rows
        end = batch[0][0] - 1
        if len(batch) < limit:
            break
    return rows


def _frame(rows, timeframe):
    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume", "close_time",
                                     "quote_volume", "trades", "taker_base", "taker_quote", "ignore"])
    df = df[["time", "open", "high", "low", "close", "trades"]].astype(
        {"open": float, "high": float, "low": float, "close": float, "trades": int})
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    df = df.rename(columns={"trades": "tick_volume"})
    df = df.drop_duplicates("time").sort_values("time")
    if config.FEED_MARKET_HOURS_ONLY:
        if timeframe == "D1":
            df = df[df["time"].dt.weekday < 5]  # drop Saturday/Sunday daily candles
        elif MINUTES[timeframe] <= 60:
            df = df[_market_open(df["time"])]
    return df.reset_index(drop=True)


# --- feed interface (same as mt5_data / demo_feed) -------------------------

def connect():
    _get("/api/v3/ping")


def resolve_symbol(preferred):
    return config.BINANCE_SYMBOL


def get_bars(symbol, timeframe, count, include_forming=False):
    """Candles with a UTC `time` column. The still-forming candle is dropped unless asked for."""
    # Removing closed-market candles (a whole weekend can be ~30% of a window) leaves fewer than
    # asked for, so fetch further back until there are enough
    want, raw = count + 1, count + 10
    while True:
        rows = _klines(symbol, timeframe, raw)
        df = _frame(rows, timeframe)
        if not include_forming:
            now = pd.Timestamp.now(tz="UTC")
            df = df[df["time"] + pd.Timedelta(minutes=MINUTES[timeframe]) <= now]
        if len(df) >= want or len(rows) < raw:  # enough, or no older history exists
            return df.tail(count).reset_index(drop=True)
        raw = int(raw * want / max(len(df), 1) * 1.1) + 10


def get_chart_bars(symbol, timeframe, count):
    return get_bars(symbol, timeframe, count, include_forming=True)


def get_tick(symbol):
    """(bid, ask) or None."""
    book = _get("/api/v3/ticker/bookTicker", symbol=symbol)
    return float(book["bidPrice"]), float(book["askPrice"])


def candle_seconds(timeframe):
    return MINUTES[timeframe] * 60


def is_connected():
    try:
        connect()
        return True
    except requests.RequestException:
        return False


def shutdown():
    if hasattr(_local, "session"):
        _local.session.close()
