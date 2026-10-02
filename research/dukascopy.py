"""Download XAUUSD 1-minute bid/ask candles from Dukascopy's public datafeed and build M30 / H1 / D1.

    python -m research.dukascopy                    # download (cached) + build data/xauusd_*.parquet
    python -m research.dukascopy --check-scale      # print raw prices on known dates (point divisor)
    python -m research.dukascopy --start 2003-01-01 --end 2026-09-30

Source: https://datafeed.dukascopy.com/datafeed/XAUUSD/{YYYY}/{MM-1:02}/{DD}/{BID|ASK}_candles_min_1.bi5
Each file = LZMA-compressed 24-byte big-endian records:
    uint32 seconds from 00:00 UTC, uint32 open, close, low, high (note O,C,L,H), float32 volume.
Prices are integers; divide by POINT_DIVISOR (verified with --check-scale, see docs/strategy-research.md).

Polite: at most 4 requests in flight, a small gap between requests, exponential backoff on errors,
a shared pause for everyone on HTTP 429/503, and every answer (including "no data") cached under
data/dukascopy/ so reruns never refetch. Errors are never cached.

Output columns (like the live feed): time (UTC, candle start), open, high, low, close (BID prices),
tick_volume (Dukascopy volume, summed), spread (ask - bid in PRICE units, median of the candle's
minutes). backtest.run multiplies spread by `point`, so pass point=1.0 with these files.
"""
import argparse
import lzma
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import binance_feed  # noqa: E402  (only for its gold market-hours filter)

DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "dukascopy", "XAUUSD")
URL = "https://datafeed.dukascopy.com/datafeed/XAUUSD/{y}/{m:02d}/{d:02d}/{side}_candles_min_1.bi5"
POINT_DIVISOR = 1000.0  # verified empirically, see check_scale()
WORKERS = 4
GAP_SECONDS = 0.25      # minimum gap between request starts (all threads together)
RECORD = np.dtype([("t", ">u4"), ("o", ">u4"), ("c", ">u4"), ("l", ">u4"), ("h", ">u4"), ("v", ">f4")])


class Blocked(Exception):
    """The server keeps refusing (429/503) - stop instead of hammering it."""


class Polite:
    """Shared throttle: request gap + a common pause after 'too many requests'."""

    def __init__(self, max_refusals=12):
        self.lock = threading.Lock()
        self.next_start = 0.0
        self.paused_until = 0.0
        self.refusals = 0           # consecutive 429/503 answers (reset by any success)
        self.max_refusals = max_refusals

    def wait(self):
        with self.lock:
            now = time.time()
            start = max(now, self.next_start, self.paused_until)
            self.next_start = start + GAP_SECONDS
        time.sleep(max(0.0, start - time.time()))

    def refused(self, status):
        with self.lock:
            self.refusals += 1
            if self.refusals >= self.max_refusals:
                raise Blocked(f"HTTP {status} {self.refusals} times in a row")
            pause = min(60 * 2 ** (self.refusals - 1), 900)
            self.paused_until = max(self.paused_until, time.time() + pause)
            print(f"  HTTP {status}: everyone pauses {pause}s (refusal {self.refusals}/{self.max_refusals})", flush=True)

    def ok(self):
        with self.lock:
            self.refusals = 0


_local = threading.local()


def _session():
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
        _local.s.headers["User-Agent"] = "gold-research/1.0 (personal backtest; cached, max 4 concurrent)"
    return _local.s


def cache_path(day, side):
    return os.path.join(CACHE, f"{day.year}", f"{day.month - 1:02d}", f"{day.day:02d}_{side}.bi5")


def fetch(day, side, polite, tries=6):
    """Cached bytes for one day/side ('' = no data that day). Raises Blocked if refused repeatedly."""
    path = cache_path(day, side)
    if os.path.exists(path):
        return path
    if os.path.exists(path + ".missing"):
        return None
    url = URL.format(y=day.year, m=day.month - 1, d=day.day, side=side)
    for attempt in range(tries):
        polite.wait()
        try:
            r = _session().get(url, timeout=60)
        except requests.RequestException as e:
            wait = 5 * 2 ** attempt
            print(f"  {day} {side}: {type(e).__name__}, retry in {wait}s", flush=True)
            time.sleep(wait)
            continue
        if r.status_code in (429, 503):
            polite.refused(r.status_code)
            continue
        if r.status_code == 404:
            polite.ok()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path + ".missing", "wb").close()
            return None
        if r.status_code != 200:
            wait = 5 * 2 ** attempt
            print(f"  {day} {side}: HTTP {r.status_code}, retry in {wait}s", flush=True)
            time.sleep(wait)
            continue
        polite.ok()
        if r.content:
            lzma.decompress(r.content)  # never cache a broken file
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(r.content)
        os.replace(tmp, path)
        return path
    raise RuntimeError(f"{day} {side}: gave up after {tries} tries")


def days(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def download(start, end):
    polite = Polite()
    jobs = [(d, s) for d in days(start, end) for s in ("BID", "ASK")
            if d.weekday() != 5 and not os.path.exists(cache_path(d, s))
            and not os.path.exists(cache_path(d, s) + ".missing")]  # Saturdays never trade
    print(f"{len(jobs)} files to download ({start} to {end}); the rest are cached", flush=True)
    done = 0
    with ThreadPoolExecutor(WORKERS) as ex:
        futures = [ex.submit(fetch, d, s, polite) for d, s in jobs]
        try:
            failed = 0
            for f in as_completed(futures):
                try:
                    f.result()
                except RuntimeError as e:  # one stubborn file: keep going, a rerun fetches it
                    failed += 1
                    print(f"  {e}", flush=True)
                done += 1
                if done % 500 == 0:
                    print(f"  {done}/{len(jobs)}", flush=True)
        except Blocked:
            for f in futures:
                f.cancel()
            raise
    return failed


def read(day, side):
    path = cache_path(day, side)
    if not os.path.exists(path):
        return np.empty(0, RECORD)
    with open(path, "rb") as f:
        raw = f.read()
    if not raw:
        return np.empty(0, RECORD)
    return np.frombuffer(lzma.decompress(raw), RECORD)


def minutes(start, end):
    """All 1-minute candles (bid OHLC + ask close + volume), filler minutes dropped."""
    parts = []
    for d in days(start, end):
        bid, ask = read(d, "BID"), read(d, "ASK")
        if len(bid) == 0 or len(ask) == 0:
            continue
        b = pd.DataFrame({"t": bid["t"].astype(np.int64), "open": bid["o"] / POINT_DIVISOR,
                          "high": bid["h"] / POINT_DIVISOR, "low": bid["l"] / POINT_DIVISOR,
                          "close": bid["c"] / POINT_DIVISOR, "vol": bid["v"].astype(float)})
        a = pd.DataFrame({"t": ask["t"].astype(np.int64), "ask_close": ask["c"] / POINT_DIVISOR,
                          "ask_vol": ask["v"].astype(float)})
        m = b.merge(a, on="t", how="inner")
        flat = (m["open"] == m["high"]) & (m["high"] == m["low"]) & (m["low"] == m["close"])
        m = m[~((m["vol"] <= 0) & (m["ask_vol"] <= 0) & flat)]  # Dukascopy pads quiet minutes
        if m.empty:
            continue
        m["time"] = pd.Timestamp(d, tz="UTC") + pd.to_timedelta(m["t"], unit="s")
        parts.append(m.drop(columns=["t"]))
    out = pd.concat(parts, ignore_index=True)
    out["spread"] = out["ask_close"] - out["close"]
    return out


def resample(m, rule):
    key = m["time"].dt.floor(rule) if rule != "D1" else m["time"].dt.floor("1D")
    g = m.groupby(key)
    df = pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(),
                       "close": g["close"].last(), "tick_volume": g["vol"].sum(),
                       "spread": g["spread"].median(), "minutes": g.size()})
    df.index.name = "time"
    df = df.reset_index()
    # same gold market-hours filter as binance_feed._frame
    if rule == "D1":
        df = df[df["time"].dt.weekday < 5]
    else:
        df = df[binance_feed._market_open(df["time"])]
    return df.reset_index(drop=True)


def build(start, end):
    m = minutes(start, end)
    print(f"{len(m):,} minute candles, {m['time'].iat[0]} to {m['time'].iat[-1]}")
    bad = (m["spread"] <= 0).mean()
    print(f"minutes with ask <= bid: {100 * bad:.3f}%")
    out = {}
    for name, rule in (("M30", "30min"), ("H1", "1h"), ("D1", "D1")):
        df = resample(m, rule)
        df.to_parquet(os.path.join(DATA, f"xauusd_{name}.parquet"))
        out[name] = df
        print(f"  {name}: {len(df):,} candles -> data/xauusd_{name}.parquet")
    return out


def check_scale(polite=None):
    """Raw median close on dates with a known gold price, to verify POINT_DIVISOR."""
    polite = polite or Polite(max_refusals=4)
    known = [(date(2004, 6, 15), 390), (date(2011, 9, 6), 1870), (date(2018, 6, 15), 1280),
             (date(2021, 6, 15), 1860), (date(2024, 11, 15), 2565)]
    for d, usd in known:
        fetch(d, "BID", polite)
        raw = read(d, "BID")
        if len(raw) == 0:
            print(f"{d}: no data")
            continue
        med = float(np.median(raw["c"][raw["c"] > 0]))
        print(f"{d}: raw median close {med:,.0f}; known ~${usd:,} -> divisor ~{med / usd:,.1f}")


def main():
    global WORKERS, GAP_SECONDS
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2003-01-01")
    ap.add_argument("--end", default=str(date.today() - timedelta(days=1)))
    ap.add_argument("--check-scale", action="store_true")
    ap.add_argument("--no-download", action="store_true", help="build from the cache only")
    ap.add_argument("--workers", type=int, default=WORKERS, help="requests in flight (max 4)")
    ap.add_argument("--gap", type=float, default=GAP_SECONDS, help="seconds between request starts")
    args = ap.parse_args()
    WORKERS, GAP_SECONDS = min(args.workers, 4), args.gap
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    try:
        if args.check_scale:
            check_scale()
            return
        if not args.no_download and download(start, end):
            raise SystemExit("Some files failed (see above). Rerun to fetch just those, then it builds.")
    except Blocked as e:
        raise SystemExit(f"Dukascopy keeps refusing ({e}). Stopped; cached files are kept, rerun later.")
    build(start, end)


if __name__ == "__main__":
    main()
