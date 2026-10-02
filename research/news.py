"""News-reaction rules (NFP / CPI / FOMC) and a minute-level bid/ask engine for docs/news-research.md.

    python -m research.news build       # minute cache from data/dukascopy (no download) -> research/news/cache/

No peeking:
  * P0 and the pre-release ATR use only minutes before the release minute T
  * N1/N2 signals use minutes before T+W; N3 uses M5 candles that have closed; entry is at the open of
    the next minute that exists; stops/targets are checked from the entry minute on
  * the daily trend (N4) uses D1 candles of days before the event's UTC day
  (checked by research/news_null.py: perturbing everything from the entry minute on never changes a signal)

Prices: Dukascopy BID and ASK 1-minute OHLC, $/oz. Signals on mid (average of bid and ask OHLC);
fills on the real bid/ask (buy at ask, sell at bid) plus slippage. Ask is clipped to >= bid.
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import backtest  # noqa: E402  (only _drawdown)
import config  # noqa: E402
import sizing  # noqa: E402
from research import dukascopy  # noqa: E402

NY = "America/New_York"
CACHE_DIR = os.path.join(ROOT, "research", "news", "cache")
MINUTES_FILE = os.path.join(CACHE_DIR, "minutes.parquet")
EVENTS_CSV = os.path.join(ROOT, "research", "news", "us_events.csv")
D1_FILE = os.path.join(ROOT, "data", "xauusd_D1.parquet")
BALANCE = 500.0
MIN_STOP = 2.0
SLIP_NEAR, SLIP_FAR, NEAR_SECONDS = 0.30, 0.10, 15 * 60
DAY_START, DAY_END = (6, 0), (17, 0)   # ET window kept per weekday
EOS = (16, 55)                          # end-of-New-York-day time exit, ET
START, SPLIT = date(2003, 5, 5), pd.Timestamp("2019-01-01", tz="UTC")
COLS = ["bo", "bh", "bl", "bc", "ao", "ah", "al", "ac"]


# ---------------------------------------------------------------- minute cache
def _read_day(d):
    bid, ask = dukascopy.read(d, "BID"), dukascopy.read(d, "ASK")
    if len(bid) == 0 or len(ask) == 0:
        return None
    b = pd.DataFrame({"t": bid["t"].astype(np.int64), "bo": bid["o"].astype(float), "bh": bid["h"].astype(float),
                      "bl": bid["l"].astype(float), "bc": bid["c"].astype(float), "bv": bid["v"].astype(float)})
    a = pd.DataFrame({"t": ask["t"].astype(np.int64), "ao": ask["o"].astype(float), "ah": ask["h"].astype(float),
                      "al": ask["l"].astype(float), "ac": ask["c"].astype(float), "av": ask["v"].astype(float)})
    m = b.merge(a, on="t", how="inner")
    flat = (m.bo == m.bh) & (m.bh == m.bl) & (m.bl == m.bc)
    m = m[~((m.bv <= 0) & (m.av <= 0) & flat)]
    if m.empty:
        return None
    m["t"] = m["t"] + int(pd.Timestamp(d, tz="UTC").timestamp())
    for c in COLS:
        m[c] = m[c] / dukascopy.POINT_DIVISOR
    return m[["t"] + COLS]


def _read_year(year):
    parts = []
    d = max(date(year, 1, 1), START - timedelta(days=3))
    end = date(year, 12, 31)
    while d <= end:
        if d.weekday() < 5:
            m = _read_day(d)
            if m is not None:
                parts.append(m)
        d += timedelta(days=1)
    if not parts:
        return None
    m = pd.concat(parts, ignore_index=True)
    et = pd.to_datetime(m.t, unit="s", utc=True).dt.tz_convert(NY)
    mins = et.dt.hour * 60 + et.dt.minute
    keep = (et.dt.weekday < 5) & (mins >= DAY_START[0] * 60 + DAY_START[1]) & (mins < DAY_END[0] * 60 + DAY_END[1])
    return m[keep.to_numpy()]


def build(years=range(2003, 2027)):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(os.path.join(CACHE_DIR, ".gitignore"), "w") as f:
        f.write("*\n")
    with ProcessPoolExecutor(8) as ex:
        parts = [p for p in ex.map(_read_year, years) if p is not None]
    m = pd.concat(parts, ignore_index=True).sort_values("t").drop_duplicates("t").reset_index(drop=True)
    m.to_parquet(MINUTES_FILE)
    print(f"{len(m):,} minutes 06:00-17:00 ET, {pd.Timestamp(m.t.iat[0], unit='s')} to {pd.Timestamp(m.t.iat[-1], unit='s')}")
    return m


class Minutes:
    """Minute arrays + index of each ET trading day."""

    def __init__(self, m):
        m = m.sort_values("t").reset_index(drop=True)
        self.t = m.t.to_numpy(np.int64)
        for c in COLS:
            setattr(self, c, m[c].to_numpy(float))
        for s in ("o", "h", "l", "c"):  # clip ask >= bid
            setattr(self, "a" + s, np.maximum(getattr(self, "a" + s), getattr(self, "b" + s)))
        for s in ("o", "h", "l", "c"):
            setattr(self, "m" + s, (getattr(self, "a" + s) + getattr(self, "b" + s)) / 2)
        et = pd.to_datetime(self.t, unit="s", utc=True).tz_convert(NY)
        days = pd.Series(np.asarray(et.date))
        change = np.r_[True, days.to_numpy()[1:] != days.to_numpy()[:-1]]
        starts = np.flatnonzero(change)
        ends = np.r_[starts[1:], len(self.t)]
        self.days = {days.iat[s]: (s, e) for s, e in zip(starts, ends)}

    def day(self, d):
        s, e = self.days.get(d, (0, 0))
        return Day(self, s, e)


class Day:
    """View of one ET day's minutes (numpy slices, no copies)."""

    def __init__(self, M, s, e, arrays=None):
        names = ["t"] + COLS + ["mo", "mh", "ml", "mc"]
        src = arrays or {n: getattr(M, n)[s:e] for n in names}
        for n in names:
            setattr(self, n, src[n])
        self.n = len(self.t)

    def arrays(self):
        return {n: getattr(self, n) for n in ["t"] + COLS + ["mo", "mh", "ml", "mc"]}

    def first_at(self, t0, t1=None):
        """Index of the first minute with t0 <= t < t1 (t1=None: any later), else -1."""
        i = int(np.searchsorted(self.t, t0, "left"))
        if i >= self.n or (t1 is not None and self.t[i] >= t1):
            return -1
        return i

    def span(self, t0, t1):
        return int(np.searchsorted(self.t, t0, "left")), int(np.searchsorted(self.t, t1, "left"))


def load_minutes():
    return Minutes(pd.read_parquet(MINUTES_FILE))


# ---------------------------------------------------------------- events and daily trend
def load_events(path=EVENTS_CSV, start=START, end=None):
    ev = pd.read_csv(path)
    ev["date"] = pd.to_datetime(ev["date"]).dt.date
    ev = ev[ev.date >= start]
    if end is not None:
        ev = ev[ev.date <= end]
    ev["T"] = [release_ts(d, t) for d, t in zip(ev.date, ev.time_et)]
    return ev.sort_values("T").reset_index(drop=True)


def release_ts(d, hhmm):
    h, mi = map(int, str(hhmm).split(":"))
    return int(pd.Timestamp(datetime(d.year, d.month, d.day, h, mi)).tz_localize(NY).timestamp())


def et_ts(d, hm):
    return int(pd.Timestamp(datetime(d.year, d.month, d.day, hm[0], hm[1])).tz_localize(NY).timestamp())


def daily_trend(d1):
    """{UTC date: +1 / -1} using the last D1 candle strictly before that date."""
    d = d1[["time", "close"]].copy()
    d["ema"] = d["close"].ewm(span=config.DAILY_TREND_EMA, adjust=False).mean()
    d["side"] = np.where(d["close"] > d["ema"], 1, np.where(d["close"] < d["ema"], -1, 0))
    d["date"] = d["time"].dt.date
    return d[["date", "side"]].reset_index(drop=True)


def trend_before(trend, d_utc):
    i = int(np.searchsorted(trend["date"].to_numpy(), d_utc, "left")) - 1
    return int(trend["side"].iat[i]) if i >= 49 else 0  # EMA50 needs 50 days


# ---------------------------------------------------------------- variants
@dataclass(frozen=True)
class V:
    family: str          # N1 momentum, N2 fade, N3 range breakout; N4 = trend-aligned N1/N3
    scope: str           # NFP / CPI / FOMC / ALL
    w: int = 5
    m: float = 0.5
    stop: str = "ext"    # N1: ext / 1ATR / 2ATR
    exit: str = "2R"     # 2R / 2h / EOS
    trend: bool = False
    base: str = ""       # N4: family of the parent (N1 / N3)

    @property
    def rule(self):
        return self.base if self.family == "N4" else self.family

    @property
    def key(self):
        f = self.rule
        if f == "N1":
            s = f"N1 W={self.w} m={self.m:g} stop={self.stop} {self.exit}"
        elif f == "N2":
            s = f"N2 W={self.w} m={self.m:g} {self.exit}"
        else:
            s = f"N3 W={self.w} {self.exit}"
        if self.trend:
            s = "N4 " + s + " +trend"
        return f"{self.scope} {s}"

    def with_(self, **kw):
        return replace(self, **kw)


W_VALUES, M_VALUES, STOPS, EXITS, N2_EXITS = [5, 15, 30], [0.5, 1.0], ["ext", "1ATR", "2ATR"], ["2R", "2h", "EOS"], ["2h", "EOS"]
SCOPES = ["NFP", "CPI", "FOMC", "ALL"]


def grid(scope):
    out = [V("N1", scope, w, m, s, e) for w in W_VALUES for m in M_VALUES for s in STOPS for e in EXITS]
    out += [V("N2", scope, w, m, "ext", e) for w in W_VALUES for m in M_VALUES for e in N2_EXITS]
    out += [V("N3", scope, w, 0.0, "range", e) for w in W_VALUES for e in EXITS]
    return out


def _step(lst, x):
    j = lst.index(x)
    return [lst[k] for k in (j - 1, j + 1) if 0 <= k < len(lst)]


def neighbours(v):
    out = [v.with_(w=w) for w in _step(W_VALUES, v.w)]
    if v.rule == "N1":
        out += [v.with_(m=m) for m in M_VALUES if m != v.m]
        out += [v.with_(stop=s) for s in _step(STOPS, v.stop)] + [v.with_(exit=e) for e in _step(EXITS, v.exit)]
    elif v.rule == "N2":
        out += [v.with_(m=m) for m in M_VALUES if m != v.m] + [v.with_(exit=e) for e in N2_EXITS if e != v.exit]
    else:
        out += [v.with_(exit=e) for e in _step(EXITS, v.exit)]
    return out


# ---------------------------------------------------------------- per-event features
class Event:
    """Everything a rule may know about one release, computed from minutes before the decision time."""

    def __init__(self, day, T, etype, d_et, trend=0):
        self.day, self.T, self.type, self.date, self.trend = day, T, etype, d_et, trend
        self.ok, self.why = True, ""
        i0, i1 = day.span(T - 300, T)
        if i1 <= i0:
            self.ok, self.why = False, "no pre-release price"
            return
        self.p0 = day.mc[i1 - 1]
        # 14 clock-aligned M5 mid candles in [T-70min, T)
        a, b = day.span(T - 4200, T)
        if b - a == 0:
            self.ok, self.why = False, "no pre-release ATR"
            return
        bucket = (day.t[a:b] - (T - 4200)) // 300
        hi, lo, cl, prev = [], [], [], None
        trs = []
        prev_close = day.mc[a - 1] if a > 0 else None
        for k in range(14):
            sel = np.flatnonzero(bucket == k)
            if len(sel) == 0:
                continue
            h, l, c = day.mh[a + sel].max(), day.ml[a + sel].min(), day.mc[a + sel[-1]]
            tr = h - l if prev_close is None else max(h - l, abs(h - prev_close), abs(l - prev_close))
            trs.append(tr)
            prev_close = c
        if len(trs) < 10:
            self.ok, self.why = False, "thin pre-release data"
            return
        self.atr = float(np.mean(trs))
        self.eos = et_ts(d_et, EOS)

    def window(self, w):
        """(first, end) indices of minutes in [T, T+W)."""
        return self.day.span(self.T, self.T + 60 * w)


# ---------------------------------------------------------------- signals
@dataclass
class Signal:
    i: int            # entry minute index (enter at its open)
    side: int
    stop: float       # absolute level, or None = set from the entry fill (k x ATR)
    stop_atr: float   # k for ATR stops
    target: float     # absolute (N2), or nan
    rr: float         # 2.0 for 2R exits, else nan
    t_exit: int


def exit_time(ev, v):
    return ev.T + 7200 if v.exit == "2h" else ev.eos


def signal(ev, v):
    """Signal for event ev under variant v, or (None, reason). Uses only data before the entry minute."""
    day = ev.day
    rule = v.rule
    if rule in ("N1", "N2"):
        a, b = ev.window(v.w)
        if b <= a:
            return None, "no post-release data"
        move = day.mc[b - 1] - ev.p0
        if abs(move) < v.m * ev.atr or move == 0:
            return None, "move too small"
        side = int(np.sign(move))
        ts = ev.T + 60 * v.w
        i = day.first_at(ts, ts + 300)
        if i < 0:
            return None, "no entry minute"
        if rule == "N1":
            if v.stop == "ext":
                stop = day.ml[a] if side > 0 else day.mh[a]
                k = np.nan
            else:
                stop, k = None, float(v.stop[0])
            sig = Signal(i, side, stop, k, np.nan, 2.0 if v.exit == "2R" else np.nan, exit_time(ev, v))
        else:
            side = -side
            ext = day.mh[a:b].max() if side < 0 else day.ml[a:b].min()
            stop = ext - side * 0.1 * ev.atr
            sig = Signal(i, side, stop, np.nan, ev.p0, np.nan, exit_time(ev, v))
    else:  # N3
        a, b = ev.window(v.w)
        if b <= a:
            return None, "no post-release data"
        hi, lo = day.mh[a:b].max(), day.ml[a:b].min()
        s0 = ev.T + 60 * v.w
        side, i = 0, -1
        k = 0
        while s0 + 300 * (k + 1) <= ev.T + 7200:
            c0, c1 = day.span(s0 + 300 * k, s0 + 300 * (k + 1))
            if c1 > c0:
                c = day.mc[c1 - 1]
                if c > hi or c < lo:
                    side = 1 if c > hi else -1
                    close_t = s0 + 300 * (k + 1)
                    i = day.first_at(close_t, close_t + 300)
                    break
            k += 1
        if side == 0:
            return None, "no breakout"
        if i < 0:
            return None, "no entry minute"
        stop = lo if side > 0 else hi
        sig = Signal(i, side, stop, np.nan, np.nan, 2.0 if v.exit == "2R" else np.nan, exit_time(ev, v))
    if v.trend:
        if ev.trend == 0 or sig.side != ev.trend:
            return None, "against the daily trend"
    return sig, ""


# ---------------------------------------------------------------- engine
def slip(t, T, cm):
    return (SLIP_NEAR if t - T <= NEAR_SECONDS else SLIP_FAR) * cm


def simulate(ev, sig, cm=1.0, side=None, risk=None, tdist=None, slippage=True):
    """One trade. cm = cost multiplier (1.5 = stress). side/risk/tdist override (random-direction
    benchmark: same entry minute, same stop distance, same target distance, other side).
    Returns dict or (None, reason)."""
    day, T = ev.day, ev.T
    i = sig.i
    s = sig.side if side is None else side
    sm = cm if slippage else 0.0
    sp_in = day.ao[i] - day.bo[i]
    extra_in = (cm - 1) * 0.5 * sp_in if slippage else 0.0
    sl_in = slip(day.t[i], T, sm)
    entry = (day.ao[i] + sl_in + extra_in) if s > 0 else (day.bo[i] - sl_in - extra_in)
    if risk is None:
        stop = sig.stop if sig.stop is not None else entry - s * sig.stop_atr * ev.atr
        r = (entry - stop) * s
        if r < MIN_STOP:
            return None, "stop < $2" if r > 0 else "stop on the wrong side"
        if not np.isnan(sig.target):
            target = sig.target
            if (target - entry) * s <= 0:
                return None, "entry past the target"
        elif not np.isnan(sig.rr):
            target = entry + s * sig.rr * r
        else:
            target = np.nan
    else:
        r = risk
        stop = entry - s * r
        target = entry + s * tdist if tdist is not None and np.isfinite(tdist) else np.nan
    j_end = int(np.searchsorted(day.t, sig.t_exit, "left"))
    lo_arr, hi_arr = (day.bl, day.bh) if s > 0 else (day.al, day.ah)
    seg = slice(i, j_end)
    if s > 0:
        hit_sl = lo_arr[seg] <= stop
        hit_tp = hi_arr[seg] >= target if np.isfinite(target) else np.zeros(j_end - i, bool)
    else:
        hit_sl = hi_arr[seg] >= stop
        hit_tp = lo_arr[seg] <= target if np.isfinite(target) else np.zeros(j_end - i, bool)
    any_hit = hit_sl | hit_tp
    if any_hit.any():
        j = i + int(np.argmax(any_hit))
        sp_out = day.ao[j] - day.bo[j]
        so = slip(day.t[j], T, sm) + ((cm - 1) * 0.5 * sp_out if slippage else 0.0)
        if hit_sl[j - i]:
            reason = "SL"
            px = (min(stop, day.bo[j]) - so) if s > 0 else (max(stop, day.ao[j]) + so)
        else:
            reason = "TP"
            px = (target - so) if s > 0 else (target + so)
    elif j_end < day.n:
        j = j_end
        sp_out = day.ao[j] - day.bo[j]
        so = slip(day.t[j], T, sm) + ((cm - 1) * 0.5 * sp_out if slippage else 0.0)
        reason = "Time"
        px = (day.bo[j] - so) if s > 0 else (day.ao[j] + so)
    else:  # data ends before the exit time (early close): last close
        j = day.n - 1
        sp_out = day.ac[j] - day.bc[j]
        so = slip(day.t[j], T, sm) + ((cm - 1) * 0.5 * sp_out if slippage else 0.0)
        reason = "Day end"
        px = (day.bc[j] - so) if s > 0 else (day.ac[j] + so)
    pnl = s * (px - entry)
    spread_cost = 0.5 * sp_in + 0.5 * sp_out
    slip_cost = sl_in + slip(day.t[j], T, sm)
    return {"side": s, "entry": entry, "stop": stop, "target": target, "risk": r, "exit_px": px,
            "entry_t": int(day.t[i]), "exit_t": int(day.t[j]), "reason": reason, "pnl": pnl, "R": pnl / r,
            "spread_R": spread_cost / r, "slip_R": slip_cost / r, "gross_R": (pnl + spread_cost * cm + slip_cost) / r}, ""


def run(events, v, cm=1.0, slippage=True, keep_sig=False):
    """All trades of variant v over a list of Event objects (already filtered to v.scope).
    One position at a time (matters only for the pooled scope)."""
    rows, skipped = [], {}
    busy_until = -1
    for ev in events:
        if not ev.ok:
            skipped[ev.why] = skipped.get(ev.why, 0) + 1
            continue
        sig, why = signal(ev, v)
        if sig is None:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        if ev.day.t[sig.i] < busy_until:
            skipped["previous trade open"] = skipped.get("previous trade open", 0) + 1
            continue
        tr, why = simulate(ev, sig, cm, slippage=slippage)
        if tr is None:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        busy_until = tr["exit_t"] + 1
        tp = tr["target"] if np.isfinite(tr["target"]) else tr["entry"] + tr["side"] * 2 * tr["risk"]
        size = sizing.lot_size(tr["entry"], tr["stop"], tp, balance=BALANCE, risk_percent=1.0)
        tr.update(type=ev.type, date=ev.date, T=ev.T, lots=size["lots"], verdict=size["verdict"],
                  usd=sizing.money(tr["pnl"], size["lots"]))
        if keep_sig:
            tr["_ev"], tr["_sig"] = ev, sig
        rows.append(tr)
    df = pd.DataFrame(rows)
    if len(df):
        df["entry_time"] = pd.to_datetime(df.entry_t, unit="s", utc=True)
    df.attrs["skipped"] = skipped
    return df


# ---------------------------------------------------------------- metrics
def pf(r):
    r = np.asarray(r, float)
    loss = -r[r < 0].sum()
    win = r[r > 0].sum()
    return np.inf if loss == 0 and win > 0 else (win / loss if loss > 0 else np.nan)


def streak(r):
    best = cur = 0
    for x in r:
        cur = cur + 1 if x < 0 else 0
        best = max(best, cur)
    return best


def metrics(df):
    if len(df) == 0:
        return {"trades": 0}
    yr = df.groupby(df.entry_time.dt.year)["R"].sum()
    return {"trades": len(df), "win_%": round(100 * (df.R > 0).mean(), 1), "pf": round(pf(df.R), 2),
            "total_R": round(df.R.sum(), 1), "avg_R": round(df.R.mean(), 3),
            "result_$": round(df.usd.sum(), 2),
            "drop_%": round(100 * backtest._drawdown(df.usd.reset_index(drop=True)) / BALANCE, 1),
            "losing_years": int((yr < 0).sum()), "years": int(len(yr)), "loss_streak": streak(df.R),
            "spread_R": round(df.spread_R.mean(), 3), "slip_R": round(df.slip_R.mean(), 3),
            "gross_R": round(df.gross_R.mean(), 3), "skip_lots": int((df.verdict == "skip").sum()),
            "longs": int((df.side > 0).sum())}


def per_year(df):
    if len(df) == 0:
        return pd.DataFrame()
    g = df.groupby(df.entry_time.dt.year)
    return pd.DataFrame({"trades": g.size(), "pf": g.R.apply(pf).round(2), "R": g.R.sum().round(1),
                         "$": g.usd.sum().round(2)})


def md(df):
    cols = list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    for r in df.itertuples(index=False):
        lines.append("| " + " | ".join("-" if x is None or (isinstance(x, float) and np.isnan(x)) else str(x) for x in r) + " |")
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "build":
        build()
