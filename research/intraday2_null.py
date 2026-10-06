"""Engine checks for docs/london-squeeze-research.md on FAKE prices (never on XAUUSD).

    python -m research.intraday2_null            # no-peeking, random-walk null test, hand-checked trade

Fake prices: a driftless arithmetic random walk of 1-minute candles (12 path steps per minute, OHLC from
the path), on weekdays 00:00-21:00 UTC plus 22:00-24:00 UTC Sunday-Thursday (gold's daily break left out).
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import intraday2 as core  # noqa: E402
from research import london, squeeze  # noqa: E402

VOL = 0.5      # $ per minute
SUB = 12


def fake_minutes(seed, start="2012-01-01", end="2014-12-31", spread=0.0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(pd.Timestamp(start, tz="UTC").timestamp()), int(pd.Timestamp(end, tz="UTC").timestamp()) + 86400, 60)
    ts = pd.to_datetime(t, unit="s", utc=True)
    wd, hr = ts.weekday.to_numpy(), ts.hour.to_numpy()
    keep = ((wd < 5) & (hr != 21) & ~((wd == 4) & (hr >= 21))) | ((wd == 6) & (hr >= 22))
    t = t[keep]
    close, hi, lo = np.empty(len(t)), np.empty(len(t)), np.empty(len(t))
    level, chunk = 1500.0, 100_000
    for a in range(0, len(t), chunk):
        b = min(a + chunk, len(t))
        steps = rng.normal(0, VOL / np.sqrt(SUB), (b - a, SUB))
        path = level + np.cumsum(steps.ravel()).reshape(b - a, SUB)
        close[a:b], hi[a:b], lo[a:b] = path[:, -1], path.max(axis=1), path.min(axis=1)
        level = close[b - 1]
    opn = np.r_[1500.0, close[:-1]]
    high, low = np.maximum(hi, opn), np.minimum(lo, opn)
    m = pd.DataFrame({"t": t, "bo": opn, "bh": high, "bl": low, "bc": close})
    for s in ("o", "h", "l", "c"):
        m["a" + s] = m["b" + s] + spread
    return core.Minutes(m, scaled=False)


def year_loader(M):
    yrs = pd.to_datetime(M.t, unit="s", utc=True).year.to_numpy()

    def load(y):
        s, e = np.searchsorted(yrs, y, "left"), np.searchsorted(yrs, y, "right")
        sub = core.Minutes.__new__(core.Minutes)
        sub.t = M.t[s:e]
        for c in core.COLS:
            setattr(sub, c, getattr(M, c)[s:e])
        sub.n = e - s
        return sub
    return load, sorted(set(yrs))


def fake_d1(M):
    df = pd.DataFrame({"t": M.t, "h": M.mid("h"), "l": M.mid("l"), "c": M.mid("c")})
    df["time"] = pd.to_datetime(df.t, unit="s", utc=True).dt.floor("1D")
    g = df.groupby("time")
    d1 = pd.DataFrame({"high": g.h.max(), "low": g.l.min(), "close": g.c.last()}).reset_index()
    return d1[d1.time.dt.weekday < 5].reset_index(drop=True)


def all_candidates(M):
    d1t = core.daily_table(fake_d1(M))
    out, floors = {}, {}
    b15 = london.prepare(core.mid_bars(M, 900), d1t)
    rngs = {a: london.ranges(b15, a) for a in london.ASIAS}
    for v in london.grid():
        out[v.key], floors[v.key] = london.candidates(b15, v, rngs[v.asia]), True
    for tf in squeeze.TFS:
        b = squeeze.prepare(core.mid_bars(M, core.TF_SECONDS[tf]), tf, d1t)
        sets = {n: squeeze.setups(b, n) for n in squeeze.NS}
        for v in squeeze.grid():
            if v.tf == tf:
                out[v.key], floors[v.key] = squeeze.candidates(b, v, sets[v.n]), True
    out["NY live"], floors["NY live"] = core.ny_candidates(core.ny_prepare(core.mid_bars(M, 1800), d1t)), False
    return out, floors


def one_seed(seed):
    M = fake_minutes(seed)
    load, yrs = year_loader(M)
    cands, floors = all_candidates(M)
    res = core.run_many(cands, floors, releases=None, years=yrs, slippage=False, loader=load)
    return {k: (float(df.R.sum()) if len(df) else 0.0, len(df), int(df.floored.sum()) if len(df) else 0) for k, df in res.items()}


def group_of(k):
    if k.startswith("A "):
        return "A " + k.split()[1] + " " + ("k=1" if "k=1 " in k else "k=1.5")
    if k.startswith("B "):
        p = k.split()
        return f"B {p[1]} {p[4]} {p[5]}"
    return k


def null_test(seeds=range(500, 524)):
    with ProcessPoolExecutor(3) as ex:
        out = list(ex.map(one_seed, seeds))
    keys = list(out[0])
    rows = []
    for g in sorted({group_of(k) for k in keys}):
        ks = [k for k in keys if group_of(k) == g]
        per = np.array([sum(o[k][0] for k in ks) / max(sum(o[k][1] for k in ks), 1) for o in out])
        n = sum(o[k][1] for o in out for k in ks)
        fl = sum(o[k][2] for o in out for k in ks)
        rows.append({"group": g, "variants": len(ks), "trades": n, "floored_%": round(100 * fl / max(n, 1), 1),
                     "avg_R": round(float(np.mean(per)), 4), "se": round(float(np.std(per, ddof=1) / np.sqrt(len(per))), 4)})
    d = pd.DataFrame(rows)
    d["z"] = (d.avg_R / d.se).round(2)
    print(f"null test: {len(seeds)} independent driftless random walks (3 years of 24 h minutes each), "
          f"zero spread and slippage, no news pause; {len(keys)} variants in {len(d)} groups")
    print(d.to_string(index=False))
    allr = sum(o[k][0] for o in out for k in keys) / sum(o[k][1] for o in out for k in keys)
    print(f"all variants together: avg R {allr:+.4f}")
    return d


def truncate(M, cut):
    n = int(np.searchsorted(M.t, cut, "left"))
    sub = core.Minutes.__new__(core.Minutes)
    sub.t = M.t[:n]
    for c in core.COLS:
        setattr(sub, c, getattr(M, c)[:n])
    sub.n = n
    return sub


def no_peek_test(seed=3, cuts=12):
    """Signals (and closed trades) computed with all minutes from a cut time on DELETED must equal the
    full-data ones up to the cut. Any use of future bars / days would change them."""
    M = fake_minutes(seed, "2012-01-01", "2013-06-30")
    full, floors = all_candidates(M)
    load, yrs = year_loader(M)
    full_tr = core.run_many(full, floors, None, years=yrs, slippage=False, loader=load)
    rng = np.random.default_rng(5)
    cut_ts = sorted(rng.integers(int(M.t[len(M.t) // 4]), int(M.t[-1]), cuts))
    checked = diff = tchecked = tdiff = 0
    for cut in cut_ts:
        Mc = truncate(M, cut)
        part, _ = all_candidates(Mc)
        loadc, yrsc = year_loader(Mc)
        part_tr = core.run_many(part, floors, None, years=yrsc, slippage=False, loader=loadc)
        for k in full:
            a = [(c.tc, c.side, round(c.stop_level, 9) if np.isfinite(c.stop_level) else None,
                  round(c.stop_dist, 9) if np.isfinite(c.stop_dist) else None, c.t_exit) for c in full[k] if c.tc <= cut]
            b = [(c.tc, c.side, round(c.stop_level, 9) if np.isfinite(c.stop_level) else None,
                  round(c.stop_dist, 9) if np.isfinite(c.stop_dist) else None, c.t_exit) for c in part[k] if c.tc <= cut]
            checked += len(a)
            diff += len(set(a) ^ set(b))
            fa, pa = full_tr[k], part_tr[k]
            if len(fa):
                x = fa[fa.exit_t < cut - 3600][["entry_t", "side", "exit_t", "R"]].round(9)
                y = pa[pa.exit_t < cut - 3600][["entry_t", "side", "exit_t", "R"]].round(9) if len(pa) else x.iloc[:0]
                tchecked += len(x)
                tdiff += len(set(map(tuple, x.to_numpy())) ^ set(map(tuple, y.to_numpy())))
    print(f"no-peeking: {len(cut_ts)} cut times, {len(full)} variants: {checked} signals up to the cut compared, "
          f"{diff} differ (must be 0); {tchecked} trades closed before the cut compared, {tdiff} differ (must be 0)")
    return diff, tdiff


def hand_check(seed=21):
    """One A1 trade on fake prices WITH a $0.30 spread and slippage, recomputed by plain loops."""
    M = fake_minutes(seed, "2013-01-01", "2013-03-31", spread=0.30)
    d1t = core.daily_table(fake_d1(M))
    b15 = london.prepare(core.mid_bars(M, 900), d1t)
    v = london.AV("A1", "none", 1.5, "off")
    cands = london.candidates(b15, v)
    load, yrs = year_loader(M)
    tr = core.run_many({v.key: cands}, {v.key: True}, None, years=yrs, loader=load)[v.key]
    t = tr.iloc[len(tr) // 2]
    d = pd.Timestamp(t.entry_t, unit="s", tz="UTC").tz_convert(core.LON).date()
    # independent recomputation
    a0, a1 = core.local_ts(d, (0, 0), core.LON), core.local_ts(d, (7, 0), core.LON)
    mid_h, mid_l = (M.ah + M.bh) / 2, (M.al + M.bl) / 2
    sel = (M.t >= a0) & (M.t < a1)
    hi, lo = mid_h[sel].max(), mid_l[sel].min()
    side = sig_close = None
    t0 = a1
    while t0 < core.local_ts(d, (10, 0), core.LON):
        w = (M.t >= t0) & (M.t < t0 + 900)
        if w.any():
            c = (M.ac[w][-1] + M.bc[w][-1]) / 2
            if c > hi or c < lo:
                side, sig_close = (1 if c > hi else -1), t0 + 900
                break
        t0 += 900
    i = int(np.flatnonzero(M.t >= sig_close)[0])
    entry = M.ao[i] + 0.10 if side > 0 else M.bo[i] - 0.10
    # ATR14 of M15 mid bars at the signal bar (Wilder), recomputed with a loop
    bars = core.mid_bars(M, 900)
    bars = bars[bars.t < sig_close]
    atr, prev = None, None
    for h, l, c in zip(bars.h, bars.l, bars.c):
        tr_ = h - l if prev is None else max(h - l, abs(h - prev), abs(l - prev))
        atr = tr_ if atr is None else atr + (tr_ - atr) / 14
        prev = c
    risk = max(min((entry - lo) if side > 0 else (hi - entry), 1.5 * atr), 2.0)
    stop, target = entry - side * risk, entry + side * 2 * risk
    t_exit = core.local_ts(d, (16, 0), core.LON)
    px = reason = None
    for j in range(i, M.n):
        if M.t[j] >= t_exit:
            px, reason = (M.bo[j] - 0.10 if side > 0 else M.ao[j] + 0.10), "Time"
            break
        if (side > 0 and M.bl[j] <= stop) or (side < 0 and M.ah[j] >= stop):
            px = (min(stop, M.bo[j]) - 0.10) if side > 0 else (max(stop, M.ao[j]) + 0.10)
            reason = "SL"
            break
        if (side > 0 and M.bh[j] >= target) or (side < 0 and M.al[j] <= target):
            px, reason = (target - 0.10 if side > 0 else target + 0.10), "TP"
            break
    R = side * (px - entry) / risk
    print(f"hand check (fake prices, $0.30 spread, $0.10 slippage), {v.key}, London day {d}:")
    print(f"  Asia range {lo:.3f}-{hi:.3f}; first M15 close outside at {pd.Timestamp(sig_close, unit='s', tz='UTC')}; "
          f"side {side:+d}; entry {entry:.3f} (ask/bid open +/- slip); ATR14 {atr:.3f}; risk {risk:.3f}; "
          f"stop {stop:.3f}; target {target:.3f}; exit {reason} at {px:.3f}; R {R:+.4f}")
    print(f"  engine: side {int(t.side):+d}; entry {t.entry:.3f}; risk {t.risk:.3f}; exit {t.reason} at {t.exit_px:.3f}; "
          f"R {t.R:+.4f} -> {'MATCH' if abs(t.R - R) < 1e-9 and t.side == side else 'MISMATCH'}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("all", "hand"):
        hand_check()
    if what in ("all", "peek"):
        no_peek_test()
    if what in ("all", "null"):
        null_test()
