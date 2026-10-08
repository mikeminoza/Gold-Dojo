"""Real XAU/USD daily and 4-hour candles from Twelve Data (free API key), for the trend signals.

Used by xauusd_feed for D1 and H4 when TWELVEDATA_API_KEY is set on the host; anything that goes wrong
(no key, limit reached, outage, odd data) returns None and the bot quietly uses PAXG-adjusted candles
instead. The free plan allows about 800 requests a day and 8 a minute: candles are cached and fetched
again only after a candle could have closed (and at most every CACHE_SECONDS), which is ~100 a day.
"""
import os
import threading
import time

import pandas as pd
import requests

URL = "https://api.twelvedata.com/time_series"
INTERVAL = {"D1": "1day", "H4": "4h"}
STEP = {"D1": 86400, "H4": 4 * 3600}
CACHE_SECONDS = 1200        # 20 minutes
RETRY_AFTER = 900           # after a failure, leave it alone for 15 minutes
MAX_BARS = 5000             # Twelve Data's outputsize limit

_lock = threading.Lock()
_cache = {}                 # timeframe -> (fetched_at, frame)
_state = {"failed_at": 0.0, "last_error": None, "used": None}


def key():
    return os.getenv("TWELVEDATA_API_KEY")


def supports(timeframe):
    return bool(key()) and timeframe in INTERVAL


def status():
    """For the website / admin page: which source the trend candles use, and the last problem."""
    return {"source": "Twelve Data" if _state["used"] else "PAXG", "configured": bool(key()),
            "last_error": _state["last_error"]}


def _fetch(timeframe, count):
    r = requests.get(URL, params={"symbol": "XAU/USD", "interval": INTERVAL[timeframe], "timezone": "UTC",
                                  "outputsize": min(MAX_BARS, count + 5), "order": "ASC", "apikey": key()},
                     timeout=20)
    body = r.json()
    if r.status_code != 200 or body.get("status") != "ok":
        raise RuntimeError(f"Twelve Data: {body.get('message') or r.status_code}"[:160])
    df = pd.DataFrame(body["values"])
    # same time precision as the PAXG candles, so the two can be merged (pandas refuses mixed units)
    df["time"] = pd.to_datetime(df["datetime"], utc=True).astype("datetime64[ms, UTC]")
    for c in ("open", "high", "low", "close"):
        df[c] = df[c].astype(float)
    df["tick_volume"] = 0
    df = df[["time", "open", "high", "low", "close", "tick_volume"]].sort_values("time").reset_index(drop=True)
    # sanity: real gold, sensible candles, aligned to the timeframe's UTC boundaries
    bad = (df["high"] < df[["open", "close"]].max(axis=1)) | (df["low"] > df[["open", "close"]].min(axis=1))
    if df.empty or bad.any() or (df["close"] <= 0).any():
        raise RuntimeError("Twelve Data: candles look wrong; using PAXG")
    seconds = (df["time"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(seconds=1)
    if (seconds % STEP[timeframe] != 0).mean() > 0.2:
        raise RuntimeError("Twelve Data: candles don't start on UTC boundaries; using PAXG")
    return df


def get_bars(timeframe, count, include_forming=False):
    """Closed candles (and the forming one if asked), or None to fall back to PAXG."""
    if not supports(timeframe):
        return None
    now = time.time()
    with _lock:
        cached = _cache.get(timeframe)
        boundary = now // STEP[timeframe] * STEP[timeframe]
        fresh = cached and now - cached[0] < CACHE_SECONDS and cached[0] >= boundary + 60 and len(cached[1]) >= count
        if not fresh:
            if now - _state["failed_at"] < RETRY_AFTER and not cached:
                return None
            try:
                _cache[timeframe] = (now, _fetch(timeframe, count))
                _state["last_error"] = None
            except (requests.RequestException, ValueError, KeyError, RuntimeError) as e:
                _state["failed_at"], _state["last_error"] = now, str(e)[:160]
                if not _state.get("warned"):
                    print(f"{e}; trend candles fall back to PAXG")
                    _state["warned"] = True
                if not cached:
                    _state["used"] = False
                    return None
        df = _cache[timeframe][1]
    if not include_forming:
        df = df[df["time"] + pd.Timedelta(seconds=STEP[timeframe]) <= pd.Timestamp.now(tz="UTC")]
    _state["used"] = True
    return df.tail(count).reset_index(drop=True)
