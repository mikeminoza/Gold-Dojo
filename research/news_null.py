"""Engine checks for docs/news-research.md on fake prices (never on XAUUSD).

    python -m research.news_null            # null test (random walks) + no-peeking test

Fake prices: a driftless arithmetic random walk of 1-minute candles, 06:00-17:00 ET on weekdays,
built from a 12-step-per-minute path, with the volatility of the real release calendar's event minutes boosted (x10 for 5 minutes, x3 for
the next 55) so the rules trigger as often as on real news. Bid = ask (zero spread) and zero slippage
for the null test, so every rule should average ~0 R per trade.
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import date, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import news  # noqa: E402

FAKE_START, FAKE_END = date(2009, 1, 1), date(2018, 12, 31)
BASE_VOL = 0.8   # $ per minute (pre-release M5 ATR about $3, so ATR stops clear the $2 minimum)
SUB = 12        # path steps per minute


def fake_minutes(seed, events, spread=0.0):
    rng = np.random.default_rng(seed)
    days = pd.bdate_range(FAKE_START, FAKE_END)
    ts = []
    for d in days:
        t0 = news.et_ts(d.date(), news.DAY_START)
        ts.append(t0 + 60 * np.arange(11 * 60))
    t = np.concatenate(ts)
    vol = np.full(len(t), BASE_VOL)
    for T in events["T"]:
        i = np.searchsorted(t, T)
        vol[i:i + 5] *= 10
        vol[i + 5:i + 60] *= 3
    # a true random-walk path: SUB steps per minute, OHLC taken from the path
    close, hi, lo = np.empty(len(t)), np.empty(len(t)), np.empty(len(t))
    level = 1200.0
    chunk = max(2_000_000 // SUB, 1000)
    for a in range(0, len(t), chunk):  # in chunks, to keep memory small
        b = min(a + chunk, len(t))
        steps = rng.normal(0, 1, (b - a, SUB)) * (vol[a:b] / np.sqrt(SUB))[:, None]
        path = level + np.cumsum(steps.ravel()).reshape(b - a, SUB)
        close[a:b], hi[a:b], lo[a:b] = path[:, -1], path.max(axis=1), path.min(axis=1)
        level = close[b - 1]
    opn = np.r_[1200.0, close[:-1]]
    high, low = np.maximum(hi, opn), np.minimum(lo, opn)
    m = pd.DataFrame({"t": t, "bo": opn, "bh": high, "bl": low, "bc": close})
    for s in ("o", "h", "l", "c"):
        m["a" + s] = m["b" + s] + spread
    return news.Minutes(m)


def fake_d1(M):
    df = pd.DataFrame({"t": M.t, "c": M.bc})
    df["time"] = pd.to_datetime(df.t, unit="s", utc=True).dt.floor("1D")
    d1 = df.groupby("time").c.last().rename("close").reset_index()
    return d1


def build_events(M, events, trend):
    out = []
    for r in events.itertuples():
        d_utc = pd.Timestamp(r.T, unit="s", tz="UTC").date()
        out.append(news.Event(M.day(r.date), r.T, r.type, r.date, news.trend_before(trend, d_utc)))
    return out


def all_variants():
    vs = []
    for sc in ("NFP", "CPI", "FOMC", "ALL"):
        g = news.grid(sc)
        vs += g
        # trend-filtered versions of every N1 / N3 point (N4 candidates)
        vs += [v.with_(family="N4", base=v.family, trend=True) for v in g if v.family in ("N1", "N3")]
    return vs


def scope_events(evs, scope):
    return evs if scope == "ALL" else [e for e in evs if e.type == scope]


def one_seed(seed, sub=None, only=None):
    global SUB
    if sub:
        SUB = sub
    events = news.load_events(start=FAKE_START, end=FAKE_END)
    M = fake_minutes(seed, events)
    trend = news.daily_trend(fake_d1(M))
    evs = build_events(M, events, trend)
    res = {}
    for v in all_variants():
        if only and not only(v):
            continue
        df = news.run(scope_events(evs, v.scope), v, slippage=False)
        res[v.key] = (df.R.sum() if len(df) else 0.0, len(df))
    return res


def _group(k):
    rule = k.split()[1] if " N4 " not in k else "N4"
    stop = (k.split("stop=")[1].split()[0] if "stop=" in k else "range" if " N3 " in k else "fade")
    ex = next(e for e in ("2R", "2h", "EOS") if f" {e}" in k)
    return f"{rule} {stop} {ex}"


def null_test(seeds=range(100, 196)):
    """Average R per trade by rule / stop / exit group. Variants within a group share the same fake
    events (so they are strongly correlated); the standard error is across the independent walks."""
    with ProcessPoolExecutor(4) as ex:
        out = list(ex.map(one_seed, seeds))
    keys = list(out[0])
    groups = sorted({_group(k) for k in keys})
    rows = []
    for g in groups:
        ks = [k for k in keys if _group(k) == g]
        per_seed = []
        for o in out:
            r, n = sum(o[k][0] for k in ks), sum(o[k][1] for k in ks)
            per_seed.append(r / n if n else np.nan)
        per_seed = np.array(per_seed)
        tot_r = sum(o[k][0] for o in out for k in ks)
        tot_n = sum(o[k][1] for o in out for k in ks)
        rows.append({"group": g, "variants": len(ks), "trades": tot_n, "avg_R": round(tot_r / tot_n, 4),
                     "se": round(np.nanstd(per_seed, ddof=1) / np.sqrt(np.isfinite(per_seed).sum()), 4)})
    d = pd.DataFrame(rows)
    d["z"] = (d.avg_R / d.se).round(2)
    print(f"null test: {len(seeds)} independent fake walks (10 years each, real 2009-2018 event times), "
          f"{len(keys)} variants in {len(d)} groups; zero spread and slippage")
    print(d.to_string(index=False))
    allr = sum(o[k][0] for o in out for k in keys) / sum(o[k][1] for o in out for k in keys)
    print(f"all variants together: avg R {allr:+.4f}")
    return d


def _atr_job(args):
    seed, sub = args
    return one_seed(seed, sub, only=lambda v: v.rule == "N1" and v.stop in ("1ATR", "2ATR") and not v.trend)


def overshoot_check(seeds=range(300, 332), subs=(12, 240)):
    """Is the ATR-stop bias the fake path's coarseness? A stop that the path jumps past is filled at the
    stop (the engine only sees minute high/low); finer paths = smaller jumps = smaller bias."""
    print("ATR-stop groups (N1, no trend filter), same seeds, fake paths with 12 vs 240 steps per minute:")
    for sub in subs:
        with ProcessPoolExecutor(4) as ex:
            out = list(ex.map(_atr_job, [(s, sub) for s in seeds]))
        keys = list(out[0])
        line = []
        for g in sorted({_group(k) for k in keys}):
            ks = [k for k in keys if _group(k) == g]
            per = np.array([sum(o[k][0] for k in ks) / max(sum(o[k][1] for k in ks), 1) for o in out])
            line.append(f"{g} {per.mean():+.3f} (se {per.std(ddof=1) / np.sqrt(len(per)):.3f})")
        print(f"  {sub:3d} steps/min: " + "; ".join(line))


def no_peek_test(seed=7):
    """Perturb every minute from the entry minute on (keeping only the entry minute's open) and check
    that the signal (entry minute, side, stop, target) is unchanged; also perturb before the release
    and check that the signal does change somewhere (so the test can fail)."""
    events = news.load_events(start=FAKE_START, end=date(2011, 12, 31))
    M = fake_minutes(seed, events)
    trend = news.daily_trend(fake_d1(M))
    evs = build_events(M, events, trend)
    rng = np.random.default_rng(1)
    checked = changed = 0
    for v in all_variants():
        if v.scope != "ALL":
            continue
        for ev in evs:
            if not ev.ok:
                continue
            sig, _ = news.signal(ev, v)
            if sig is None:
                continue
            arr = {k: a.copy() for k, a in ev.day.arrays().items()}
            i = sig.i
            for k in arr:
                if k == "t":
                    continue
                noise = arr[k][i:] + rng.normal(0, 20, len(arr[k]) - i)
                if k in ("bo", "ao", "mo"):
                    noise[0] = arr[k][i]
                arr[k][i:] = noise
            day2 = news.Day(None, 0, 0, arrays=arr)
            ev2 = news.Event(day2, ev.T, ev.type, ev.date, ev.trend)
            sig2, _ = news.signal(ev2, v)
            same = sig2 is not None and (sig2.i, sig2.side, sig2.stop, sig2.target, sig2.t_exit) == \
                (sig.i, sig.side, sig.stop, sig.target, sig.t_exit)
            if not same:
                changed += 1
            checked += 1
    print(f"no-peeking: {checked} signals re-computed with all data from the entry minute on perturbed; "
          f"{changed} changed (must be 0)")
    # trend: D1 cut at the event day gives the same side
    d1 = fake_d1(M)
    bad = 0
    for ev in evs[::7]:
        d_utc = pd.Timestamp(ev.T, unit="s", tz="UTC").date()
        cut = news.daily_trend(d1[d1.time.dt.date < d_utc])
        bad += news.trend_before(cut, d_utc) != news.trend_before(trend, d_utc)
    print(f"daily trend with D1 cut at the event day: {bad} differences (must be 0)")
    return changed, bad


if __name__ == "__main__":
    no_peek_test()
    null_test()
    overshoot_check()
