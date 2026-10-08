"""Free XAUUSD (spot gold) prices, no account or API key.

- Live bid/ask: real XAUUSD spot quotes from Swissquote's public price feed.
- Candles: PAXG candles from Binance, OKX or Kraken (PAX Gold, a token backed 1:1 by physical gold), shifted by
  the measured PAXG-vs-spot gap (usually $5-10) so they line up with the XAUUSD price.
- Daily and 4-hour candles (the trend signals): real XAU/USD from Twelve Data when TWELVEDATA_API_KEY is
  set (twelvedata_feed.py), PAXG-adjusted otherwise or whenever Twelve Data can't answer.

Same functions as mt5_data. If Swissquote can't be reached, the adjusted PAXG price is used instead.
"""
import threading
import time

import requests

import binance_feed as paxg
import config
import real_candles
import twelvedata_feed

SPOT_URL = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD"
TIERS = ["elite", "prime", "premium", "standard"]  # Swissquote price tiers, tightest spread first
SPOT_MIN_INTERVAL = 1.0      # seconds between spot requests (be polite to a public feed)
GAP_MIN_INTERVAL = 60.0      # seconds between PAXG-vs-spot gap measurements (it drifts slowly)
GAP_SMOOTHING = 0.2          # each new measurement moves the gap 20% of the way

POINT = 0.01
candle_seconds = paxg.candle_seconds
is_connected = paxg.is_connected
market_open = paxg.market_open

_lock = threading.Lock()
_state = {"spot": None, "spot_at": 0.0, "gap": None, "gap_at": 0.0, "warned": False}


def _spot_quote():
    """(bid, ask) of real XAUUSD spot, cached for SPOT_MIN_INTERVAL; None if unavailable."""
    with _lock:
        if _state["spot"] and time.time() - _state["spot_at"] < SPOT_MIN_INTERVAL:
            return _state["spot"]
    try:
        data = requests.get(SPOT_URL, timeout=5).json()
        prices = [x for platform in data for x in platform["spreadProfilePrices"]]
        # The tightest of Swissquote's free price tiers (elite ~$0.50 vs standard ~$0.70 on gold)
        p = min(prices, key=lambda x: (TIERS.index(x["spreadProfile"]) if x["spreadProfile"] in TIERS else 9,
                                       x["ask"] - x["bid"]))
        quote = (round(p["bid"], 2), round(p["ask"], 2))
    except (requests.RequestException, ValueError, KeyError, IndexError) as e:
        if not _state["warned"]:
            print(f"XAUUSD spot quote unavailable ({e}); using PAXG adjusted to spot instead.")
            _state["warned"] = True
        return None
    with _lock:
        _state.update(spot=quote, spot_at=time.time(), warned=False)
    return quote


def _measure_gap(force=False):
    """How far PAXG trades above spot gold, smoothed so single odd quotes don't jump the chart."""
    if not force and time.time() - _state["gap_at"] < GAP_MIN_INTERVAL:
        return
    spot = _spot_quote()
    if spot is None:
        return
    try:
        pbid, pask = paxg.get_tick(config.BINANCE_SYMBOL)
    except ConnectionError:
        return  # keep the last gap; measured again later
    gap = (pbid + pask) / 2 - (spot[0] + spot[1]) / 2
    with _lock:
        old = _state["gap"]
        _state["gap"] = gap if old is None else old + GAP_SMOOTHING * (gap - old)
        _state["gap_at"] = time.time()


GAP_STEP = 0.25  # only move the shift applied to candles when the gap drifts this far


def gap():
    """The shift applied to PAXG candles. Held steady until the measured gap drifts by GAP_STEP, so the
    chart history isn't redrawn every few seconds for a few cents."""
    measured = _state["gap"] or 0.0
    applied = _state.get("applied")
    if applied is None or abs(measured - applied) >= GAP_STEP:
        _state["applied"] = applied = round(measured, 2)
    return applied


def connect():
    paxg.connect()
    _measure_gap(force=True)
    print(f"XAUUSD: live spot from Swissquote, candles from PAXG shifted by -{gap():.2f}")


def resolve_symbol(preferred):
    return "XAUUSD"


def _to_spot(df):
    shift = gap()
    for col in ("open", "high", "low", "close"):
        df[col] = (df[col] - shift).round(2)
    return df


def _base_bars(timeframe, count, include_forming):
    """Real XAU/USD from Twelve Data for D1 / H4 when available, else PAXG shifted to spot."""
    real = twelvedata_feed.get_bars(timeframe, count, include_forming)
    if real is not None and len(real) >= min(count, 60):
        return real
    return _to_spot(paxg.get_bars(config.BINANCE_SYMBOL, timeframe, count, include_forming))


def get_bars(symbol, timeframe, count, include_forming=False):
    """Candles: PAXG shifted to spot, with every candle the bot recorded real XAUUSD prices for
    replaced by the real prices (real_candles.py)."""
    bars = _base_bars(timeframe, count, include_forming)
    bars, real = real_candles.overlay(bars, timeframe)
    if timeframe == config.TIMEFRAME and len(bars):
        recent = bars.tail(48)  # the last day or so of signal candles
        _, real_recent = real_candles.overlay(recent, timeframe)
        _state["real_share"] = round(100 * real_recent / len(recent))
    return bars


def raw_bars(symbol, timeframe, count):
    """The candle source alone (Twelve Data or PAXG), without the real-price overlay (for the price check)."""
    return _base_bars(timeframe, count, False)


def candle_source():
    """Where the daily / 4-hour candles come from right now: "Twelve Data" or "PAXG"."""
    return twelvedata_feed.status()["source"]


def real_share():
    """How much of the last day of signal candles uses real XAUUSD prices (0-100), or None."""
    return _state.get("real_share")


def tick_is_real():
    """True when the last price came from the real spot feed (not the PAXG fallback)."""
    return bool(_state.get("tick_real"))


def get_chart_bars(symbol, timeframe, count):
    return get_bars(symbol, timeframe, count, include_forming=True)


def get_tick(symbol):
    """(bid, ask) of XAUUSD: the real spot quote, or PAXG shifted to spot as a fallback."""
    _measure_gap()
    spot = _spot_quote()
    _state["tick_real"] = bool(spot)
    if spot:
        return spot
    pbid, pask = paxg.get_tick(config.BINANCE_SYMBOL)
    return round(pbid - gap(), 2), round(pask - gap(), 2)


def shutdown():
    paxg.shutdown()
