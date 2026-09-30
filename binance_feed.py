"""Free, real-time PAXG prices from public exchange data (no account or API key).

PAXG (PAX Gold) is a token backed 1:1 by a troy ounce of physical gold, so it tracks the gold spot
price closely (usually a few dollars above it). Same functions as mt5_data.

Sources, tried in order: Binance -> OKX -> Kraken. When one refuses - e.g. Binance's
"418 I'm a teapot" (this internet address is temporarily banned) or "429 too many requests" - it's
rested for a while and the next one is used, so the bot keeps running. Cloud hosts share internet
addresses between many customers, so this can happen through no fault of the bot.

PAXG trades 24/7 but real gold doesn't, so candles outside gold's market hours (the weekend and the
daily 17:00-18:00 New York break) are dropped, keeping indicators and sessions like the real market.
"""
import threading
import time

import pandas as pd
import requests

import config

MINUTES = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}
POINT = 0.01

_local = threading.local()  # one HTTP session per thread
_printed = {"source": None}


def _session():
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
    return _local.session


class SourceRefused(Exception):
    """The source said no (banned / rate-limited / unavailable); rest it for `seconds`."""

    def __init__(self, reason, seconds):
        super().__init__(reason)
        self.seconds = seconds


class Source:
    name = "?"
    base = ""
    PAUSE_ON = {418: 1800, 429: 120, 403: 3600, 451: 86400}  # status -> default rest (seconds)

    def __init__(self):
        self.resting_until = 0.0

    def available(self):
        return time.time() >= self.resting_until

    def rest(self, seconds, reason):
        self.resting_until = time.time() + seconds
        print(f"{self.name} unavailable ({reason}); using the next price source for {round(seconds / 60)} min")

    def get(self, path, params):
        r = _session().get(self.base + path, params=params, timeout=10)
        if r.status_code in self.PAUSE_ON:
            wait = int(r.headers.get("Retry-After", 0) or 0) or self.PAUSE_ON[r.status_code]
            raise SourceRefused(f"HTTP {r.status_code}", wait)
        r.raise_for_status()
        return r.json()

    # Each source returns candles as [(time_ms, open, high, low, close, volume), ...] oldest first,
    # the newest `count` (older than `end_ms` if given), and (bid, ask) for its PAXG price.
    def candles(self, timeframe, count, end_ms=None):
        raise NotImplementedError

    def ticker(self):
        raise NotImplementedError


class Binance(Source):
    name, base = "Binance", "https://data-api.binance.vision"
    INTERVALS = {"M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m", "H1": "1h", "H4": "4h", "D1": "1d"}

    def candles(self, timeframe, count, end_ms=None):
        rows, end = [], end_ms
        while len(rows) < count:
            # Binance charges more rate-limit weight for bigger requests, so ask only for what's needed
            limit = min(1000, count - len(rows))
            params = {"symbol": config.BINANCE_SYMBOL, "interval": self.INTERVALS[timeframe], "limit": limit}
            if end is not None:
                params["endTime"] = end
            batch = self.get("/api/v3/klines", params)
            if not batch:
                break
            rows = [(int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), int(k[8])) for k in batch] + rows
            end = int(batch[0][0]) - 1
            if len(batch) < limit:
                break
        return rows

    def ticker(self):
        book = self.get("/api/v3/ticker/bookTicker", {"symbol": config.BINANCE_SYMBOL})
        return float(book["bidPrice"]), float(book["askPrice"])


class OKX(Source):
    name, base = "OKX", "https://www.okx.com"
    INTERVALS = {"M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m", "H1": "1H", "H4": "4H", "D1": "1Dutc"}
    INST = "PAXG-USDT"

    def _data(self, path, params):
        body = self.get(path, params)
        if body.get("code") not in ("0", 0):
            raise SourceRefused(f"OKX error {body.get('code')}: {body.get('msg')}", 300)
        return body["data"]

    def candles(self, timeframe, count, end_ms=None):
        rows, after = [], end_ms
        # "candles" serves the most recent ~1,440; "history-candles" goes further back
        for path, limit in (("/api/v5/market/candles", 300), ("/api/v5/market/history-candles", 100)):
            while len(rows) < count:
                params = {"instId": self.INST, "bar": self.INTERVALS[timeframe], "limit": limit}
                if after is not None:
                    params["after"] = after  # OKX: return candles OLDER than this time
                batch = self._data(path, params)  # newest first
                if not batch:
                    break
                rows = [(int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]))
                        for k in reversed(batch)] + rows
                after = int(batch[-1][0])
            if len(rows) >= count:
                break
        return rows[-count:]

    def ticker(self):
        d = self._data("/api/v5/market/ticker", {"instId": self.INST})[0]
        return float(d["bidPx"]), float(d["askPx"])


class Kraken(Source):
    name, base = "Kraken", "https://api.kraken.com"
    INTERVALS = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}
    PAIR = "PAXGUSD"

    def _result(self, path, params):
        body = self.get(path, params)
        if body.get("error"):
            raise SourceRefused(f"Kraken error {body['error']}", 300)
        return body["result"]

    def candles(self, timeframe, count, end_ms=None):
        if end_ms is not None:
            return []  # Kraken only serves its latest 720 candles; no older history
        result = self._result("/0/public/OHLC", {"pair": self.PAIR, "interval": self.INTERVALS[timeframe]})
        series = next(v for k, v in result.items() if k != "last")
        rows = [(int(k[0]) * 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), int(k[7])) for k in series]
        return rows[-count:]

    def ticker(self):
        d = next(iter(self._result("/0/public/Ticker", {"pair": self.PAIR}).values()))
        return float(d["b"][0]), float(d["a"][0])


SOURCES = [Binance(), OKX(), Kraken()]


def _use(method, *args):
    """Call `method` on the first source that answers; rest the ones that refuse."""
    problems = []
    for source in SOURCES:
        if not source.available():
            continue
        try:
            result = getattr(source, method)(*args)
        except SourceRefused as e:
            source.rest(e.seconds, str(e))
            problems.append(f"{source.name}: {e}")
            continue
        except (requests.RequestException, ValueError, KeyError, IndexError, StopIteration) as e:
            source.rest(60, type(e).__name__)
            problems.append(f"{source.name}: {e}")
            continue
        if _printed["source"] != source.name:
            if _printed["source"] is not None:
                print(f"PAXG prices now from {source.name}")
            _printed["source"] = source.name
        return result
    resting = ", ".join(f"{s.name} for {max(0, round((s.resting_until - time.time()) / 60))} min"
                        for s in SOURCES if not s.available())
    raise ConnectionError(f"no PAXG price source available right now ({'; '.join(problems) or 'resting: ' + resting})")


def market_open(ts):
    """Is real gold trading at this moment? (Sun 18:00 - Fri 17:00 New York, minus the 17:00 break)"""
    ny = ts.tz_convert("America/New_York")
    if ny.weekday() == 5 or ny.hour == 17:
        return False
    if ny.weekday() == 6:
        return ny.hour >= 18
    return not (ny.weekday() == 4 and ny.hour >= 17)


def _market_open(times):
    """market_open() for a whole column of times."""
    ny = times.dt.tz_convert("America/New_York")
    day, hour = ny.dt.weekday, ny.dt.hour
    closed = (day == 5) | ((day == 6) & (hour < 18)) | ((day == 4) & (hour >= 17)) | (hour == 17)
    return ~closed


def _frame(rows, timeframe):
    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "tick_volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    df = df.drop_duplicates("time").sort_values("time")
    if config.FEED_MARKET_HOURS_ONLY:
        if timeframe == "D1":
            df = df[df["time"].dt.weekday < 5]  # drop Saturday/Sunday daily candles
        elif MINUTES[timeframe] <= 60:
            df = df[_market_open(df["time"])]
    return df.reset_index(drop=True)


# --- feed interface (same as mt5_data / demo_feed) -------------------------

def connect():
    """Raises if no source can give a price right now (the bot then waits and retries)."""
    _use("ticker")


def resolve_symbol(preferred):
    return config.BINANCE_SYMBOL


def get_bars(symbol, timeframe, count, include_forming=False):
    """Candles with a UTC `time` column. The still-forming candle is dropped unless asked for."""
    # Removing closed-market candles (a whole weekend can be ~30% of a window) leaves fewer than
    # asked for, so fetch further back until there are enough
    want, raw = count + 1, count + 10
    while True:
        rows = _use("candles", timeframe, raw)
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
    """(bid, ask) of PAXG from the first source that answers."""
    return _use("ticker")


def candle_seconds(timeframe):
    return MINUTES[timeframe] * 60


def is_connected():
    try:
        connect()
        return True
    except ConnectionError:
        return False


def shutdown():
    if hasattr(_local, "session"):
        _local.session.close()
