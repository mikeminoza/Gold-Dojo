"""Strategy variants for the long-history research (docs/strategy-research.md).

Same interface as strategy.py (prepare / entry / on_open / exit), so backtest.run() works on them for
fixed stop/target exits. Every variant's signals are also computed as columns (sig_side, sig_stop,
sig_rr, sig_tp) so research/engine.py can replay them fast and with partial / trailing exits.

No peeking:
  * opening range from closed range candles only (SessionBreakout.prepare)
  * daily features (EMA 50 trend, trend strength, ATR regime) from the PREVIOUS completed UTC day:
    a daily candle starting at day d becomes usable at d + 1 day (same merge as SessionBreakout)
  * the fade setup only looks at candles up to and including the signal candle
"""
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

import config
import sessions
import strategy

NEW_YORK = {"name": "New York", "tz": "America/New_York", "open": (8, 30), "end": (11, 30)}
LONDON = {"name": "London", "tz": "Europe/London", "open": (8, 0), "end": (12, 0)}


@dataclass(frozen=True)
class Params:
    name: str = "A baseline"
    kind: str = "orb"                 # "orb" breakout, "fade" mean reversion, "combo" = orb when filter on, fade when off
    timeframe: str = "M30"
    london: bool = False              # add the London session
    range_minutes: int = config.ORB_RANGE_MINUTES
    rr: float = config.ORB_RR
    max_stop_atr: float = config.ORB_MAX_STOP_ATR
    min_stop_atr: float = config.ORB_MIN_STOP_ATR
    trend_min: float | None = None    # B: |D1 close - EMA50| / D1 ATR14 >= this (previous day)
    atr_ratio_min: float | None = None  # C: D1 ATR14 / its 100-day median >= this (previous day)
    exit: str = "fixed"               # "fixed", "half_be" (d1), "trail" (d2)
    trail_mult: float = 1.0           # d2: trailing distance in signal-candle ATRs
    fade_trend_max: float | None = None  # E: only when trend strength < this
    fade_target: str = "range"        # E: "range" = opposite side of the range, or "1.5R"

    def with_(self, **kw):
        return replace(self, **kw)


def wilder_atr(df, period=config.ATR_PERIOD):
    prev = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def daily_features(d1):
    """Per daily candle: trend strength and ATR regime, plus when each becomes usable."""
    d = d1[["time", "high", "low", "close"]].copy()
    ema = d["close"].ewm(span=config.DAILY_TREND_EMA, adjust=False).mean()
    atr = wilder_atr(d)
    d["d_strength"] = (d["close"] - ema).abs() / atr
    d["d_atr_ratio"] = atr / atr.rolling(100, min_periods=100).median()
    d["d_available"] = d["time"] + d["time"].diff().median()  # same rule as SessionBreakout.prepare
    return d[["d_available", "d_strength", "d_atr_ratio"]]


class ResearchBreakout(strategy.SessionBreakout):
    """SessionBreakout with research switches. Signals are precomputed in prepare()."""

    def __init__(self, params: Params, candle_seconds):
        defs = [LONDON, NEW_YORK] if params.london else [NEW_YORK]
        super().__init__(candle_seconds, sessions.MarketClock(defs, params.range_minutes))
        self.p = params

    @property
    def summary(self):
        return self.p.name

    def prepare(self, df, daily=None):
        out = super().prepare(df, daily)
        feats = daily_features(daily)
        out = pd.merge_asof(out.sort_values("time"), feats.sort_values("d_available"),
                            left_on="time", right_on="d_available", direction="backward")
        return add_signals(out.reset_index(drop=True), self.p, self.candle)

    def entry(self, df, i):
        side = df["sig_side"].iat[i]
        if side == 0 or df["sess"].iat[i] in self.state["taken"]:
            return None
        if not np.isnan(df["sig_tp"].iat[i]):
            raise NotImplementedError("absolute targets need research.engine (backtest.run uses rr)")
        return strategy.Signal("BUY" if side > 0 else "SELL", float(df["sig_stop"].iat[i]),
                               float(df["sig_rr"].iat[i]), self.p.name,
                               tag=df["sess"].iat[i], expires=int(df["sess_end"].iat[i]))


def add_signals(df, p: Params, candle):
    """sig_side (+1 BUY / -1 SELL / 0), sig_stop, sig_rr, sig_tp (absolute target or NaN) per candle."""
    df = df.copy()
    close, atr, hi, lo = df["close"], df["atr"], df["range_hi"], df["range_lo"]
    ends = pd.to_datetime(df["sess_end"], unit="s", utc=True)
    can_trade = (df["phase"] == "trade") & hi.notna() & (df["time"] + 2 * candle <= ends)

    strength, ratio = df["d_strength"], df["d_atr_ratio"]
    filt = pd.Series(True, index=df.index)
    if p.trend_min is not None:
        filt &= strength >= p.trend_min
    if p.atr_ratio_min is not None:
        filt &= ratio >= p.atr_ratio_min

    side = np.zeros(len(df))
    stop = np.full(len(df), np.nan)
    rr = np.full(len(df), p.rr)
    tp = np.full(len(df), np.nan)

    def clamp(dist):
        return np.minimum(np.maximum(dist, p.min_stop_atr * atr), p.max_stop_atr * atr)

    if p.kind in ("orb", "combo"):
        on = can_trade & filt
        buy = on & (close > hi) & (df["trend"] > 0)
        sell = on & (close < lo) & (df["trend"] < 0)
        dist = clamp(np.where(buy, close - lo, hi - close))
        side[buy] = 1
        side[sell] = -1
        stop = np.where(buy, close - dist, np.where(sell, close + dist, stop))

    if p.kind in ("fade", "combo"):
        if p.kind == "fade":
            weak = strength < p.fade_trend_max if p.fade_trend_max is not None else pd.Series(True, index=df.index)
        else:
            weak = ~filt  # the days the breakout filter says "no trend"
        weak = weak & strength.notna()
        tr = df["phase"] == "trade"
        g = df["sess"].where(tr)
        # direction of the latest trade-phase close outside the range, up to the previous candle
        brk = pd.Series(np.where(tr & (close > hi), 1.0, np.where(tr & (close < lo), -1.0, np.nan)), index=df.index)
        last_break = brk.groupby(g).ffill().groupby(g).shift().fillna(0)
        hh = df["high"].where(tr).groupby(g).cummax()  # highest high since the range ended, incl. this candle
        ll = df["low"].where(tr).groupby(g).cummin()
        inside = (close < hi) & (close > lo)
        fsell = can_trade & weak & inside & (last_break > 0)
        fbuy = can_trade & weak & inside & (last_break < 0)
        dist = clamp(np.where(fsell, hh - close, close - ll))
        fstop = np.where(fsell, close + dist, close - dist)
        if p.fade_target == "range":
            target = np.where(fsell, lo, hi)
            ok = np.abs(close - target) >= 0.5 * dist  # skip if the target is under 0.5R away
        else:
            target = np.full(len(df), np.nan)
            ok = np.ones(len(df), bool)
        fsell, fbuy = fsell & ok, fbuy & ok
        m = (fsell | fbuy) & (side == 0)
        side[m & fsell] = -1
        side[m & fbuy] = 1
        stop = np.where(m, fstop, stop)
        if p.fade_target == "range":
            tp = np.where(m, target, tp)
        else:
            rr = np.where(m, 1.5, rr)

    df["sig_side"], df["sig_stop"], df["sig_rr"], df["sig_tp"] = side, stop, rr, tp
    return df
