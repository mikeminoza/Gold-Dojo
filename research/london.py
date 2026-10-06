"""Family A: Asia-range breakout into the London open (docs/london-squeeze-research.md).

Per London trading day D (Mon-Fri, London local time via zoneinfo, so DST is handled):
  * range = mid high / low of the M15 bars in the Asia window:
      A1: [00:00, 07:00) London on D;  A2: [23:00 on D-1, 07:00 on D)
    (needs at least half the window's M15 bars, else the day is skipped)
  * signal bars: M15 bars starting 07:00 ... 09:45 London (closing 07:15 ... 10:00); a bar whose mid
    close is above the range high = BUY candidate, below the low = SELL candidate
  * direction filter "none" or "trend" (only BUY if the previous UTC day's D1 close > EMA50, SELL mirrored)
  * range filter "on": only days with 0.5 x ATR14(D1) <= range width <= 1.5 x ATR14(D1) (previous D1)
  * stop: the tighter of "other side of the range" and k x ATR14(M15, mid, at the signal bar), measured
    from the entry fill; widened to $2 if closer (research.intraday2.simulate, floor=True)
  * target 2R; time exit 16:00 London on D; one trade per day (the first candidate that can trade)
"""
from dataclasses import dataclass, replace
from datetime import timedelta

import numpy as np

from research import intraday2 as core


@dataclass(frozen=True)
class AV:
    asia: str = "A1"        # A1 00:00-07:00, A2 23:00-07:00
    trend: str = "none"     # none / trend
    k: float = 1.0          # ATR multiple for the stop (tighter of range / k x ATR)
    rfilter: str = "on"     # on / off

    @property
    def key(self):
        return f"A {self.asia} dir={self.trend} k={self.k:g} rf={self.rfilter}"

    def with_(self, **kw):
        return replace(self, **kw)


ASIAS, TRENDS, KS, RFILTERS = ["A1", "A2"], ["none", "trend"], [1.0, 1.5], ["on", "off"]


def grid():
    return [AV(a, t, k, r) for a in ASIAS for t in TRENDS for k in KS for r in RFILTERS]


def neighbours(v):
    return ([v.with_(asia=a) for a in ASIAS if a != v.asia] + [v.with_(trend=t) for t in TRENDS if t != v.trend]
            + [v.with_(k=k) for k in KS if k != v.k] + [v.with_(rfilter=r) for r in RFILTERS if r != v.rfilter])


def prepare(bars15, d1table):
    """M15 mid bars with local times, ATR14 and the previous day's D1 trend / ATR."""
    b = core.add_local(bars15, 900)
    b["atr"] = core.wilder_atr(b.h.to_numpy(), b.l.to_numpy(), b.c.to_numpy(), 14)
    b["d_trend"], b["d_atr"] = core.prev_day_features(d1table, b.utc_date.to_numpy())
    return b


def ranges(b, asia):
    """{London date: (hi, lo, bars)} of the Asia window."""
    lm = b.lon_min.to_numpy()
    dates = b.lon_date.to_numpy()
    if asia == "A1":
        sel = lm < 420
        sess = dates[sel]
    else:
        sel = (lm < 420) | (lm >= 23 * 60)
        sess = np.array([d + timedelta(days=1) if m >= 23 * 60 else d for d, m in zip(dates[sel], lm[sel])])
    sub = b[sel].assign(sess=sess)
    g = sub.groupby("sess")
    need = 14 if asia == "A1" else 16
    out = {}
    for d, hi, lo, n in zip(g.size().index, g.h.max(), g.l.min(), g.size()):
        if n >= need:
            out[d] = (hi, lo, n)
    return out


def candidates(b, v, rng=None):
    rng = rng if rng is not None else ranges(b, v.asia)
    lm = b.lon_min.to_numpy()
    sig = b[(lm >= 420) & (lm <= 585) & (b.lon_wd.to_numpy() < 5)]
    out = []
    exit_cache = {}
    for r in sig.itertuples(index=False):
        d = r.lon_date
        if d not in rng:
            continue
        hi, lo, _ = rng[d]
        if r.c > hi:
            side = 1
        elif r.c < lo:
            side = -1
        else:
            continue
        if v.trend == "trend" and side != r.d_trend:
            continue
        if v.rfilter == "on":
            w = hi - lo
            if not (np.isfinite(r.d_atr) and 0.5 * r.d_atr <= w <= 1.5 * r.d_atr):
                continue
        if not np.isfinite(r.atr):
            continue
        if d not in exit_cache:
            exit_cache[d] = core.local_ts(d, (16, 0), core.LON)
        out.append(core.Cand(int(r.tc), side, lo if side > 0 else hi, v.k * r.atr, 2.0, exit_cache[d], ("A", d)))
    return out
