"""Family B: volatility-squeeze breakouts on M30 / H1 (docs/london-squeeze-research.md).

On continuous mid bars of the timeframe:
  * Bollinger(20, 2): SMA20 of close +/- 2 x population std (ddof=0) of the last 20 closes
  * Keltner(20, 1.5): EMA20 of close +/- 1.5 x Wilder ATR20
  * squeeze bar: Bollinger upper < Keltner upper and Bollinger lower > Keltner lower
  * setup: a run of >= N consecutive squeeze bars ends at bar e (bar e is not a squeeze bar)
  * signal: the first bar j >= e (no squeeze bar in e..j) whose close is above the upper Bollinger band
    (BUY) or below the lower one (SELL). One signal per setup; if it can't be taken (outside 07:00-20:00
    London, against the trend filter, news pause, a position already open, ...) the setup is lost.
  * entry window: the signal bar must close within [07:00, 20:00] London on a weekday
  * trend filter "none" or "ema" (previous UTC day's D1 close vs EMA50)
  * stop: "mid" = the middle band (SMA20) at the signal bar, or k x Wilder ATR14 of the timeframe from the
    entry fill (k = 1.0 / 1.5); widened to $2 if closer
  * target 2R or 3R; time exit at 16:55 New York (end of gold's trading day) on the entry day
"""
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from research import intraday2 as core


@dataclass(frozen=True)
class BV:
    tf: str = "M30"
    n: int = 4
    trend: str = "none"     # none / ema
    stop: str = "mid"       # mid / 1.0ATR / 1.5ATR
    rr: float = 2.0

    @property
    def key(self):
        return f"B {self.tf} N={self.n} dir={self.trend} stop={self.stop} {self.rr:g}R"

    def with_(self, **kw):
        return replace(self, **kw)


TFS, NS, TRENDS, STOPS, RRS = ["M30", "H1"], [4, 8], ["none", "ema"], ["mid", "1.0ATR", "1.5ATR"], [2.0, 3.0]


def grid():
    return [BV(tf, n, t, s, rr) for tf in TFS for n in NS for t in TRENDS for s in STOPS for rr in RRS]


def neighbours(v):
    """One parameter changed: the other timeframe / N / trend / target, or any other stop rule."""
    return ([v.with_(tf=x) for x in TFS if x != v.tf] + [v.with_(n=x) for x in NS if x != v.n]
            + [v.with_(trend=x) for x in TRENDS if x != v.trend] + [v.with_(stop=x) for x in STOPS if x != v.stop]
            + [v.with_(rr=x) for x in RRS if x != v.rr])


def prepare(bars, tf, d1table):
    sec = core.TF_SECONDS[tf]
    b = core.add_local(bars, sec)
    c, h, l = b.c.to_numpy(), b.h.to_numpy(), b.l.to_numpy()
    cs = pd.Series(c)
    sma = cs.rolling(20).mean()
    sd = cs.rolling(20).std(ddof=0)
    ema = cs.ewm(span=20, adjust=False).mean()
    atr20 = core.wilder_atr(h, l, c, 20)
    b["mid"] = sma.to_numpy()
    b["bb_up"], b["bb_lo"] = (sma + 2 * sd).to_numpy(), (sma - 2 * sd).to_numpy()
    b["kc_up"], b["kc_lo"] = ema.to_numpy() + 1.5 * atr20, ema.to_numpy() - 1.5 * atr20
    b["atr"] = core.wilder_atr(h, l, c, 14)
    ok = np.isfinite(b.bb_up.to_numpy())
    ok[:20] = False
    b["ok"] = ok
    b["sq"] = ok & (b.bb_up.to_numpy() < b.kc_up.to_numpy()) & (b.bb_lo.to_numpy() > b.kc_lo.to_numpy())
    b["d_trend"], _ = core.prev_day_features(d1table, b.utc_date.to_numpy())
    return b


def setups(b, n):
    """[(e, j, side)] : squeeze run of >= n bars ends at e, first close outside Bollinger at j (or None)."""
    sq, ok = b.sq.to_numpy(), b.ok.to_numpy()
    c, up, lo = b.c.to_numpy(), b.bb_up.to_numpy(), b.bb_lo.to_numpy()
    out = []
    run = 0
    i, N = 0, len(b)
    while i < N:
        if sq[i]:
            run += 1
            i += 1
            continue
        if run >= n and ok[i]:
            e = i
            j = e
            found = None
            while j < N and not sq[j]:
                if c[j] > up[j]:
                    found = (e, j, 1)
                    break
                if c[j] < lo[j]:
                    found = (e, j, -1)
                    break
                j += 1
            if found:
                out.append(found)
            run = 0
            i = j if found is None else j + 1
            continue
        run = 0
        i += 1
    return out


def candidates(b, v, setup_list=None):
    sl = setup_list if setup_list is not None else setups(b, v.n)
    sec = core.TF_SECONDS[v.tf]
    tc, lon_min, lon_wd = b.tc.to_numpy(), b.lon_min.to_numpy(), b.lon_wd.to_numpy()
    mid, atr, trend = b.mid.to_numpy(), b.atr.to_numpy(), b.d_trend.to_numpy()
    ny_date = b.ny_date.to_numpy()
    k = {"mid": np.nan, "1.0ATR": 1.0, "1.5ATR": 1.5}[v.stop]
    out = []
    exit_cache = {}
    for e, j, side in sl:
        close_min = lon_min[j] + sec // 60       # London minute-of-day of the bar CLOSE (may be 1440)
        if lon_wd[j] >= 5 or not (420 <= close_min <= 1200):
            continue
        if v.trend == "ema" and side != trend[j]:
            continue
        if not np.isfinite(atr[j]):
            continue
        d = ny_date[j]
        if d not in exit_cache:
            exit_cache[d] = core.local_ts(d, (16, 55), core.NY)
        if v.stop == "mid":
            cand = core.Cand(int(tc[j]), side, mid[j], np.nan, v.rr, exit_cache[d], ("B", int(tc[j])))
        else:
            cand = core.Cand(int(tc[j]), side, np.nan, k * atr[j], v.rr, exit_cache[d], ("B", int(tc[j])))
        out.append(cand)
    return out
