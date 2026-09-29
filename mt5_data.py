"""MetaTrader 5 connection and price data."""
import os
import time

import MetaTrader5 as mt5
import pandas as pd

TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
}
TIMEFRAME_MINUTES = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}


def default_terminal_path():
    """The usual install location of the MetaTrader 5 terminal, if it's there."""
    for base in (os.getenv("APPDATA"), os.getenv("PROGRAMFILES")):
        path = os.path.join(base or "", "MetaTrader 5", "terminal64.exe")
        if base and os.path.exists(path):
            return path
    return None


def connect():
    # With a path, MT5 is started automatically if it isn't already open
    kwargs = {"timeout": 60000}
    path = os.getenv("MT5_PATH") or default_terminal_path()
    if path:
        kwargs["path"] = path
    if os.getenv("MT5_LOGIN"):
        kwargs.update(
            login=int(os.getenv("MT5_LOGIN")),
            password=os.getenv("MT5_PASSWORD", ""),
            server=os.getenv("MT5_SERVER", ""),
        )
    if not mt5.initialize(**kwargs):
        raise RuntimeError(
            f"MT5 initialize failed: {mt5.last_error()}. "
            "Is the MetaTrader 5 terminal installed, open and logged in?"
        )


def resolve_symbol(preferred):
    """Return the broker's actual gold symbol name and make sure it's in Market Watch."""
    if mt5.symbol_info(preferred) is None:
        candidates = [
            s.name for s in (mt5.symbols_get() or [])
            if ("XAU" in s.name.upper() and "USD" in s.name.upper()) or s.name.upper().startswith("GOLD")
        ]
        if not candidates:
            raise RuntimeError(f"Symbol {preferred!r} not found and no gold symbol detected.")
        print(f"'{preferred}' not found; using broker symbol '{candidates[0]}'")
        preferred = candidates[0]
    mt5.symbol_select(preferred, True)
    return preferred


_offset = {"hours": None, "at": 0.0}
OFFSET_RECHECK_SECONDS = 6 * 3600  # picks up daylight-saving changes on long runs


def _broker_convention_offset():
    """Most gold brokers run server time at UTC+3 while New York is on daylight saving, else UTC+2."""
    ny = pd.Timestamp.now(tz="America/New_York")
    return 3 if ny.dst() else 2


def server_utc_offset_hours(symbol):
    """MT5 bar times are in broker server time (often UTC+2/+3). Measure the offset from a fresh tick.

    Right after connecting the first tick can be empty (time 0), and on weekends the last tick is
    days old, so neither can be trusted; then the broker convention is used instead.
    """
    if _offset["hours"] is not None and time.time() - _offset["at"] < OFFSET_RECHECK_SECONDS:
        return _offset["hours"]
    measured = None
    for _ in range(40):
        tick = mt5.symbol_info_tick(symbol)
        if tick and tick.time:
            diff = (tick.time - time.time()) / 3600
            # A live tick puts server time a whole number of hours from UTC (within a few minutes)
            if abs(diff) <= 14 and abs(diff - round(diff)) < 0.05:
                measured = round(diff)
            break
        time.sleep(0.25)
    if measured is None:
        measured = _offset["hours"] if _offset["hours"] is not None else _broker_convention_offset()
        print(f"No live {symbol} tick (market closed?); using server time UTC+{measured}")
    _offset.update(hours=measured, at=time.time())
    return measured


def get_bars(symbol, timeframe, count, include_forming=False):
    """Return candles with a UTC `time` column. The still-forming candle is dropped unless asked for."""
    rates = mt5.copy_rates_from_pos(symbol, TIMEFRAMES[timeframe], 0, count + 1)
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"No data for {symbol} {timeframe}: {mt5.last_error()}")
    df = pd.DataFrame(rates)
    offset = server_utc_offset_hours(symbol)
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True) - pd.Timedelta(hours=offset)
    return df if include_forming else df.iloc[:-1].reset_index(drop=True)


def get_chart_bars(symbol, timeframe, count):
    """Candles for the website chart, including the one still forming."""
    return get_bars(symbol, timeframe, count, include_forming=True)


def get_tick(symbol):
    """(bid, ask) or None."""
    tick = mt5.symbol_info_tick(symbol)
    return (tick.bid, tick.ask) if tick else None


def candle_seconds(timeframe):
    return TIMEFRAME_MINUTES[timeframe] * 60


def is_connected():
    return mt5.terminal_info() is not None


def shutdown():
    mt5.shutdown()
