"""Shared core for docs/london-squeeze-research.md: 24-hour minute cache, mid-price bars, daily
features, news pause, a minute-level bid/ask engine and metrics.

    python -m research.intraday2 build      # minute cache + M15/M30/H1 mid bars from data/dukascopy (no download)

Prices: Dukascopy BID and ASK 1-minute OHLC (ask clipped to >= bid). Signals are computed on MID bars
(average of bid and ask), so a spread blow-out (e.g. at gold's daily reopen) does not look like a move.
Fills use the real bid/ask of the fill minute: buy at the ask, sell at the bid, plus SLIP $/oz per fill.

No peeking (checked by research/intraday2_null.py):
  * a bar is used only after it has closed (its start + its length); entry is the open of the first
    minute at or after the bar close (within ENTRY_WINDOW seconds, else no trade)
  * indicators on bars only look backwards; daily features come from the last D1 candle of a UTC day
    strictly before the signal's UTC day
  * stops and targets are checked from the entry minute on; stop before target in the same minute
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import backtest  # noqa: E402  (only _drawdown)
import config  # noqa: E402
import sizing  # noqa: E402
from research import dukascopy  # noqa: E402

LON, NY = "Europe/London", "America/New_York"
RES = os.path.join(ROOT, "research", "intraday2_results")
CACHE = os.path.join(RES, "cache")
EVENTS_CSV = os.path.join(ROOT, "research", "news", "us_events.csv")
D1_FILE = os.path.join(ROOT, "data", "xauusd_D1.parquet")
START, SPLIT = date(2003, 5, 5), pd.Timestamp("2019-01-01", tz="UTC")
SPLIT_T = int(SPLIT.timestamp())
BALANCE = 500.0
MIN_STOP = 2.0
SLIP = 0.10                 # $/oz per fill (entry and every exit)
PAUSE = 30 * 60             # news pause: no entry within 30 min of a release (before or after)
ENTRY_WINDOW = 5 * 60       # entry minute must exist within 5 min of the signal bar's close
COLS = ["bo", "bh", "bl", "bc", "ao", "ah", "al", "ac"]
TF_SECONDS = {"M15": 900, "M30": 1800, "H1": 3600}


# ---------------------------------------------------------------- minute cache (24 h, per year)
def _read_day(d):
    bid, ask = dukascopy.read(d, "BID"), dukascopy.read(d, "ASK")
    if len(bid) == 0 or len(ask) == 0:
        return None
    b = pd.DataFrame({"t": bid["t"].astype(np.int64), "bo": bid["o"].astype(np.int32), "bh": bid["h"].astype(np.int32),
                      "bl": bid["l"].astype(np.int32), "bc": bid["c"].astype(np.int32), "bv": bid["v"].astype(float)})
    a = pd.DataFrame({"t": ask["t"].astype(np.int64), "ao": ask["o"].astype(np.int32), "ah": ask["h"].astype(np.int32),
                      "al": ask["l"].astype(np.int32), "ac": ask["c"].astype(np.int32), "av": ask["v"].astype(float)})
    m = b.merge(a, on="t", how="inner")
    flat = (m.bo == m.bh) & (m.bh == m.bl) & (m.bl == m.bc)
    m = m[~((m.bv <= 0) & (m.av <= 0) & flat)]  # Dukascopy pads quiet minutes (as research.dukascopy)
    if m.empty:
        return None
    m["t"] = m["t"] + int(pd.Timestamp(d, tz="UTC").timestamp())
    return m[["t"] + COLS]


def _build_year(year):
    parts = []
    d = max(date(year, 1, 1), START - timedelta(days=1))
    end = min(date(year, 12, 31), date(2026, 9, 30))
    while d <= end:
        if d.weekday() != 5:  # Saturdays never trade (as research.dukascopy.download)
            m = _read_day(d)
            if m is not None:
                parts.append(m)
        d += timedelta(days=1)
    if not parts:
        return year, 0
    m = pd.concat(parts, ignore_index=True).sort_values("t").drop_duplicates("t").reset_index(drop=True)
    m.to_parquet(os.path.join(CACHE, f"minutes_{year}.parquet"))
    return year, len(m)


def years_available():
    return sorted(int(f[8:12]) for f in os.listdir(CACHE) if f.startswith("minutes_"))


def load_year(year):
    return Minutes(pd.read_parquet(os.path.join(CACHE, f"minutes_{year}.parquet")))


class Minutes:
    """One year (or any span) of minute arrays in $/oz. Ask clipped to >= bid; mid = average."""

    def __init__(self, m, scaled=True):
        m = m.sort_values("t").reset_index(drop=True)
        self.t = m.t.to_numpy(np.int64)
        div = dukascopy.POINT_DIVISOR if scaled else 1.0
        for c in COLS:
            setattr(self, c, m[c].to_numpy(float) / div)
        for s in ("o", "h", "l", "c"):
            setattr(self, "a" + s, np.maximum(getattr(self, "a" + s), getattr(self, "b" + s)))
        self.n = len(self.t)

    def mid(self, s):
        return (getattr(self, "a" + s) + getattr(self, "b" + s)) / 2


def mid_bars(M, seconds):
    """Clock-aligned (UTC) mid OHLC bars from minutes; time = bar start (UTC seconds)."""
    key = M.t // seconds * seconds
    df = pd.DataFrame({"k": key, "o": M.mid("o"), "h": M.mid("h"), "l": M.mid("l"), "c": M.mid("c"),
                       "sp": M.ac - M.bc})
    g = df.groupby("k", sort=True)
    out = pd.DataFrame({"t": g.size().index.to_numpy(np.int64), "o": g.o.first().to_numpy(), "h": g.h.max().to_numpy(),
                        "l": g.l.min().to_numpy(), "c": g.c.last().to_numpy(), "spread": g.sp.median().to_numpy(),
                        "minutes": g.size().to_numpy()})
    return out


def _bars_year(year):
    M = load_year(year)
    return {tf: mid_bars(M, s) for tf, s in TF_SECONDS.items()}


def build(workers=4):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, ".gitignore"), "w") as f:
        f.write("*\n")
    years = range(START.year, 2027)
    with ProcessPoolExecutor(workers) as ex:
        for y, n in ex.map(_build_year, years):
            print(f"  {y}: {n:,} minutes", flush=True)
    with ProcessPoolExecutor(workers) as ex:
        parts = list(ex.map(_bars_year, years_available()))
    for tf in TF_SECONDS:
        b = pd.concat([p[tf] for p in parts], ignore_index=True).sort_values("t").reset_index(drop=True)
        b.to_parquet(os.path.join(CACHE, f"bars_{tf}.parquet"))
        print(f"  {tf}: {len(b):,} mid bars")


def load_bars(tf):
    return pd.read_parquet(os.path.join(CACHE, f"bars_{tf}.parquet"))


# ---------------------------------------------------------------- indicators and daily features
def wilder_atr(h, l, c, period):
    prev = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - l, np.abs(h - prev), np.abs(l - prev)]), axis=0)
    return pd.Series(tr).ewm(alpha=1 / period, adjust=False).mean().to_numpy().copy()


def add_local(b, seconds):
    """Bar close time and its London / New York local date and minute-of-day (DST-aware via zoneinfo)."""
    b = b.copy()
    b["tc"] = b.t + seconds
    for tz, p in ((LON, "lon"), (NY, "ny")):
        st = pd.to_datetime(b.t, unit="s", utc=True).dt.tz_convert(tz)
        b[f"{p}_date"] = st.dt.date
        b[f"{p}_min"] = st.dt.hour * 60 + st.dt.minute   # local minute-of-day of the bar START
        b[f"{p}_wd"] = st.dt.weekday
    b["utc_date"] = pd.to_datetime(b.t, unit="s", utc=True).dt.date
    return b


def load_d1(path=D1_FILE):
    d1 = pd.read_parquet(path)
    return d1[["time", "high", "low", "close"]].copy()


def daily_table(d1):
    """Per UTC day d: features from the last D1 candle strictly BEFORE d (no peeking).
    trend = sign(close - EMA50 of closes) (0 until 50 candles exist), atr = Wilder ATR14 (D1)."""
    d = d1.sort_values("time").reset_index(drop=True)
    c = d.close.to_numpy(float)
    ema = pd.Series(c).ewm(span=config.DAILY_TREND_EMA, adjust=False).mean().to_numpy()
    side = np.where(c > ema, 1, np.where(c < ema, -1, 0))
    side[: config.DAILY_TREND_EMA - 1] = 0
    atr = wilder_atr(d.high.to_numpy(float), d.low.to_numpy(float), c, config.ATR_PERIOD)
    atr[: config.ATR_PERIOD - 1] = np.nan
    return pd.DataFrame({"date": d.time.dt.date, "trend": side, "atr": atr})


def prev_day_features(table, utc_dates):
    """Vectorised: for each UTC date, (trend, atr) of the last D1 candle with date < that date."""
    keys = table.date.to_numpy()
    idx = np.searchsorted(keys, np.asarray(utc_dates), "left") - 1
    ok = idx >= 0
    trend = np.where(ok, table.trend.to_numpy()[np.clip(idx, 0, None)], 0)
    atr = np.where(ok, table.atr.to_numpy()[np.clip(idx, 0, None)], np.nan)
    return trend, atr


def local_ts(d, hm, tz):
    return int(pd.Timestamp(datetime(d.year, d.month, d.day, hm[0], hm[1])).tz_localize(tz).timestamp())


# ---------------------------------------------------------------- news pause
def load_release_times(path=EVENTS_CSV):
    ev = pd.read_csv(path)
    ts = [local_ts(date.fromisoformat(d), tuple(map(int, t.split(":"))), NY) for d, t in zip(ev.date, ev.time_et)]
    return np.array(sorted(ts), np.int64)


def paused(t, releases):
    if releases is None or len(releases) == 0:
        return False
    k = np.searchsorted(releases, t)
    near = []
    if k < len(releases):
        near.append(releases[k] - t)
    if k > 0:
        near.append(t - releases[k - 1])
    return min(near) <= PAUSE


# ---------------------------------------------------------------- candidate signals and engine
@dataclass
class Cand:
    """A candidate signal: decided at bar close tc; the engine enters at the next minute's open."""
    tc: int               # signal time (bar close, UTC seconds)
    side: int             # +1 BUY / -1 SELL
    stop_level: float     # absolute stop (nan = none)
    stop_dist: float      # stop distance from the entry fill (nan = none); if both, the tighter wins
    rr: float             # target in R (nan = no target)
    t_exit: int           # time exit (UTC seconds)
    group: object         # at most one trade per group (day for A / NY, setup for B)


def simulate(M, i, side, stop_level, stop_dist, rr, t_exit, floor, cm=1.0, slippage=True, risk=None, tdist=None):
    """One trade entered at the open of minute i. floor=True: a stop closer than MIN_STOP is widened to
    MIN_STOP; floor=False: the trade is skipped (live MIN_STOP_DISTANCE). cm = cost multiplier (1.5 =
    stress: spread and slippage x1.5). risk/tdist override the stop and target distance (random-direction
    benchmark). Returns (dict, "") or (None, reason)."""
    s = side
    sl = SLIP * cm if slippage else 0.0
    sp_in = M.ao[i] - M.bo[i]
    extra_in = (cm - 1) * 0.5 * sp_in
    entry = (M.ao[i] + sl + extra_in) if s > 0 else (M.bo[i] - sl - extra_in)
    floored = False
    if risk is None:
        cands = []
        if np.isfinite(stop_level):
            d = (entry - stop_level) * s
            if d > 0:
                cands.append(d)
        if np.isfinite(stop_dist):
            cands.append(stop_dist)
        if not cands:
            return None, "stop on the wrong side"
        r = min(cands)
        if r < MIN_STOP:
            if not floor:
                return None, "stop < $2"
            r, floored = MIN_STOP, True
        tdist = rr * r if np.isfinite(rr) else np.inf
    else:
        r = risk
    stop = entry - s * r
    target = entry + s * tdist if np.isfinite(tdist) else np.nan
    j_end = int(np.searchsorted(M.t, t_exit, "left"))
    seg = slice(i, j_end)
    if s > 0:
        hit_sl = M.bl[seg] <= stop
        hit_tp = M.bh[seg] >= target if np.isfinite(target) else np.zeros(j_end - i, bool)
    else:
        hit_sl = M.ah[seg] >= stop
        hit_tp = M.al[seg] <= target if np.isfinite(target) else np.zeros(j_end - i, bool)
    any_hit = hit_sl | hit_tp
    if any_hit.any():
        j = i + int(np.argmax(any_hit))
        sp_out = M.ao[j] - M.bo[j]
        so = sl + (cm - 1) * 0.5 * sp_out
        if hit_sl[j - i]:
            reason = "SL"
            px = (min(stop, M.bo[j]) - so) if s > 0 else (max(stop, M.ao[j]) + so)
        else:
            reason = "TP"
            px = (target - so) if s > 0 else (target + so)
    elif j_end < M.n and M.t[j_end] < t_exit + 3600:
        j = j_end
        sp_out = M.ao[j] - M.bo[j]
        so = sl + (cm - 1) * 0.5 * sp_out
        reason = "Time"
        px = (M.bo[j] - so) if s > 0 else (M.ao[j] + so)
    else:  # no minute near the exit time (early close / data gap): last close before it
        j = max(j_end - 1, i)
        sp_out = M.ac[j] - M.bc[j]
        so = sl + (cm - 1) * 0.5 * sp_out
        reason = "Day end"
        px = (M.bc[j] - so) if s > 0 else (M.ac[j] + so)
    pnl = s * (px - entry)
    spread_cost = 0.5 * sp_in + 0.5 * sp_out
    return {"side": s, "entry": entry, "stop": stop, "target": target, "risk": r, "exit_px": px,
            "entry_t": int(M.t[i]), "exit_t": int(M.t[j]), "reason": reason, "pnl": pnl, "R": pnl / r,
            "spread_R": spread_cost * cm / r, "slip_R": 2 * sl / r, "floored": floored,
            "tdist": tdist}, ""


def run_year(M, cands, floor, releases, cm=1.0, slippage=True, busy_until=-1):
    """Trades from candidates (time-ordered) on one year's minutes. One position at a time, at most one
    trade per group. A candidate blocked by the news pause / an open position / a missing entry minute /
    a stop rule is dropped; later candidates of the same group may still trade."""
    rows, skipped = [], {}
    done = set()

    def skip(why):
        skipped[why] = skipped.get(why, 0) + 1

    for c in cands:
        if c.group in done:
            continue
        i = int(np.searchsorted(M.t, c.tc, "left"))
        if i >= M.n or M.t[i] >= c.tc + ENTRY_WINDOW or M.t[i] >= c.t_exit:
            skip("no entry minute")
            continue
        if M.t[i] < busy_until:
            skip("position open")
            continue
        if paused(int(M.t[i]), releases):
            skip("news pause")
            continue
        tr, why = simulate(M, i, c.side, c.stop_level, c.stop_dist, c.rr, c.t_exit, floor, cm, slippage)
        if tr is None:
            skip(why)
            continue
        done.add(c.group)
        busy_until = tr["exit_t"] + 1
        tr["group"] = c.group
        tr["sig_t"] = c.tc
        tr["t_exit_rule"] = c.t_exit
        rows.append(tr)
    return rows, skipped, busy_until


def finish(rows, skipped):
    df = pd.DataFrame(rows)
    if len(df):
        tp = np.where(np.isfinite(df.target), df.target, df.entry + df.side * 2 * df.risk)
        sz = [sizing.lot_size(e, s, t, balance=BALANCE, risk_percent=1.0) for e, s, t in zip(df.entry, df.stop, tp)]
        df["lots"] = [z["lots"] for z in sz]
        df["verdict"] = [z["verdict"] for z in sz]
        df["usd"] = [sizing.money(p, l) for p, l in zip(df.pnl, df.lots)]
        df["entry_time"] = pd.to_datetime(df.entry_t, unit="s", utc=True)
    df.attrs["skipped"] = skipped
    return df


def run_many(cand_sets, floors, releases, years=None, cm=1.0, slippage=True, loader=None, t_from=None, t_to=None):
    """{key: candidates} -> {key: trades df}. Years outer (one minute file in memory at a time).
    Candidates with tc outside [t_from, t_to) are ignored (train / holdout)."""
    loader = loader or load_year
    years = years or years_available()
    by_year = {k: {} for k in cand_sets}
    for k, cs in cand_sets.items():
        for c in cs:
            if (t_from is not None and c.tc < t_from) or (t_to is not None and c.tc >= t_to):
                continue
            y = pd.Timestamp(c.tc, unit="s", tz="UTC").year
            by_year[k].setdefault(y, []).append(c)
    rows = {k: [] for k in cand_sets}
    skipped = {k: {} for k in cand_sets}
    busy = {k: -1 for k in cand_sets}
    for y in years:
        if not any(y in by_year[k] for k in cand_sets):
            continue
        M = loader(y)
        for k in cand_sets:
            cs = by_year[k].get(y)
            if not cs:
                continue
            r, s, busy[k] = run_year(M, cs, floors[k], releases, cm, slippage, busy[k])
            rows[k] += r
            for w, n in s.items():
                skipped[k][w] = skipped[k].get(w, 0) + n
        del M
    return {k: finish(rows[k], skipped[k]) for k in cand_sets}


def both_sides(trades, loader=None, cm=1.0):
    """Random-direction benchmark input: R of every trade if taken BUY and if taken SELL, same entry
    minute, same stop distance, same target distance, same time exit, same costs."""
    loader = loader or load_year
    out = np.zeros((len(trades), 2))
    years = trades.entry_time.dt.year.to_numpy()
    for y in sorted(set(years)):
        M = loader(y)
        for k in np.flatnonzero(years == y):
            t = trades.iloc[k]
            i = int(np.searchsorted(M.t, t.entry_t, "left"))
            for s_i, side in enumerate((1, -1)):
                tr, _ = simulate(M, i, side, np.nan, np.nan, np.nan, int(t.t_exit_rule), True, cm,
                                 risk=t.risk, tdist=t.tdist)
                out[k, s_i] = tr["R"]
    return out


def random_percentile(trades, runs=1000, seed=11, loader=None):
    both = both_sides(trades, loader)
    rng = np.random.default_rng(seed)
    pfs = []
    for _ in range(runs):
        pick = rng.integers(0, 2, len(trades))
        pfs.append(pf(both[np.arange(len(trades)), pick]))
    pfs = np.array(pfs)
    real = pf(trades.R)
    return {"pctl": round(100 * float((pfs < real).mean()), 1), "median": round(float(np.median(pfs)), 2),
            "p90": round(float(np.percentile(pfs, 90)), 2)}


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


def r_drop(r):
    """Worst peak-to-trough fall of cumulative R (as backtest._drawdown), in R (negative)."""
    return float(backtest._drawdown(pd.Series(np.asarray(r, float))))


def metrics(df, years_span):
    if len(df) == 0:
        return {"trades": 0}
    yr = df.groupby(df.entry_time.dt.year)["R"].sum()
    dr = r_drop(df.R)
    return {"trades": len(df), "per_yr": round(len(df) / years_span, 1), "win_%": round(100 * (df.R > 0).mean(), 1),
            "pf": round(pf(df.R), 2), "total_R": round(df.R.sum(), 1), "avg_R": round(df.R.mean(), 3),
            "drop_R": round(dr, 1), "drop_%": round(dr, 1),  # 1 R = 1% of $500 at fixed 1% risk
            "result_$": round(df.usd.sum(), 2),
            "drop_$%": round(100 * backtest._drawdown(df.usd.reset_index(drop=True)) / BALANCE, 1),
            "losing_years": int((yr < 0).sum()), "years": int(len(yr)), "loss_streak": streak(df.R),
            "spread_R": round(df.spread_R.mean(), 3), "skip_lots": int((df.verdict == "skip").sum()),
            "floored": int(df.floored.sum()), "longs": int((df.side > 0).sum()),
            "tp_%": round(100 * (df.reason == "TP").mean(), 1)}


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


# ---------------------------------------------------------------- reference: the live New York breakout
def ny_prepare(bars30, d1table):
    b = add_local(bars30, 1800)
    b["atr"] = wilder_atr(b.h.to_numpy(), b.l.to_numpy(), b.c.to_numpy(), config.ATR_PERIOD)
    b["d_trend"], _ = prev_day_features(d1table, b.utc_date.to_numpy())
    return b


def ny_candidates(b):
    """config.ORB_SESSIONS (New York 08:30-11:30 ET), 60-min range = the 08:30 and 09:00 M30 bars,
    signal bars 09:30 / 10:00 / 10:30 (a candle + one more must fit before 11:30), close beyond the range
    in the D1 EMA50 trend direction, stop distance from the signal close clamped to [0.5, 1.0] x ATR14
    (ORB_MIN/MAX_STOP_ATR), target ORB_RR = 2R, time exit 11:30 ET. Stop closer than $2 to the fill: skip
    (MIN_STOP_DISTANCE, run with floor=False)."""
    nm, wd = b.ny_min.to_numpy(), b.ny_wd.to_numpy()
    rng = b[(nm >= 510) & (nm < 570) & (wd < 5)].groupby("ny_date").agg(hi=("h", "max"), lo=("l", "min"))
    rng = rng.to_dict("index")
    sig = b[np.isin(nm, [570, 600, 630]) & (wd < 5)]
    out = []
    for r in sig.itertuples(index=False):
        g = rng.get(r.ny_date)
        if g is None or not np.isfinite(r.atr):
            continue
        if r.c > g["hi"] and r.d_trend > 0:
            side, dist = 1, r.c - g["lo"]
        elif r.c < g["lo"] and r.d_trend < 0:
            side, dist = -1, g["hi"] - r.c
        else:
            continue
        dist = min(max(dist, config.ORB_MIN_STOP_ATR * r.atr), config.ORB_MAX_STOP_ATR * r.atr)
        out.append(Cand(int(r.tc), side, r.c - side * dist, np.nan, config.ORB_RR,
                        local_ts(r.ny_date, (11, 30), NY), ("NY", r.ny_date)))
    return out
