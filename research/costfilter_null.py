"""Engine checks for docs/cost-filter-research.md on FAKE prices (never on XAUUSD).

    python -m research.costfilter_null            # equivalence, filter check, no-peeking, null test

Fake prices: the driftless random walk of research/intraday2_null.py, with a random spread (independent of
price) that varies by hour and by minute, so the cost filter has something to select on.
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import costfilter as cf  # noqa: E402
from research import intraday2 as core  # noqa: E402
from research import intraday2_null as n2  # noqa: E402

OUT = os.path.join(cf.RES, "null_output.txt")


def fake(seed, start="2012-01-01", end="2014-12-31", spread="var"):
    M = n2.fake_minutes(seed, start, end, spread=0.0)
    if spread == "var":
        rng = np.random.default_rng(seed + 10_000)
        hour = (M.t - M.t[0]) // 3600
        lvl = np.exp(rng.normal(np.log(0.30), 0.45, int(hour[-1]) + 1))[hour]
        s = np.clip(lvl * np.exp(rng.normal(0, 0.2, M.n)), 0.05, 3.0)
    else:
        s = np.full(M.n, float(spread))
    for f in ("o", "h", "l", "c"):
        setattr(M, "a" + f, getattr(M, "b" + f) + s)
    return M


def cands_of(M):
    d1t = core.daily_table(n2.fake_d1(M))
    return cf.candidates_from(core.mid_bars(M, 1800), core.mid_bars(M, 3600), d1t)


def equivalence(seed=7):
    """X=none, m=2, no commission must reproduce intraday2.run_many trade for trade (NY skip, squeeze floor)."""
    M = fake(seed, spread=0.30)
    load, yrs = n2.year_loader(M)
    cs = cands_of(M)
    old = core.run_many(cs, {k: k != "NY" for k in cs}, None, years=yrs, loader=load)
    new = cf.run_many(cs, [cf.Spec(s, 2.0, None) for s in cs], None, years=yrs, loader=load)
    n = d = 0
    for s in cs:
        a, b = old[s], new[f"{s} m=2 X=none"]
        n += len(a)
        cols = ["entry_t", "exit_t", "side", "R", "usd"]
        d += 0 if (len(a) == len(b) and np.allclose(a[cols].to_numpy(float), b[cols].to_numpy(float))) else 1
    return f"equivalence vs intraday2 engine (X=none, m=$2, $0.30 spread, $0.10 slippage): {n} trades in 5 rules, {d} rules differ (must be 0)"


def filter_check(seed=8):
    """Every filtered trade satisfies est_cost <= X x risk; the signal spread equals the median spread of the
    signal bar from intraday2.mid_bars; and the filter really skips candidates."""
    M = fake(seed)
    load, yrs = n2.year_loader(M)
    cs = cands_of(M)
    res = cf.run_many(cs, cf.all_specs(), None, years=yrs, loader=load)
    bad = sum(int((df.est_cost > sp.x * df.risk + 1e-12).sum()) for sp in cf.all_specs() if sp.x is not None
              for df in [res[sp.key]] if len(df))
    bars = {1800: core.mid_bars(M, 1800).set_index("t").spread, 3600: core.mid_bars(M, 3600).set_index("t").spread}
    mism = checked = 0
    for sp in cf.all_specs():
        df = res[sp.key]
        if not len(df):
            continue
        sec = cf.TF_SEC[sp.strat]
        for t, s in zip(df.sig_t, df.sig_spread):
            checked += 1
            mism += int(abs(bars[sec].get(t - sec, np.nan) - s) > 1e-9)
    lines = [f"filter check (fake prices, variable spread): {bad} kept trades with expected cost > X x risk (must be 0); "
             f"signal spread vs mid_bars spread of the signal bar: {checked} compared, {mism} differ (must be 0)",
             "  kept trades per X (all 5 rules, m=$2): " + ", ".join(
                 f"{cf.xlabel(x)} {sum(len(res[cf.Spec(s, 2.0, x).key]) for s in cf.STRATS)}" for x in cf.XS),
             "  filter skips (NY m=2 X=8%): " + str(res["NY m=2 X=8%"].attrs["skipped"])]
    return "\n".join(lines)


def no_peek(seed=3, cuts=12):
    M = fake(seed, "2012-01-01", "2013-06-30")
    load, yrs = n2.year_loader(M)
    specs = cf.all_specs()
    full = cf.run_many(cands_of(M), specs, None, years=yrs, loader=load)
    rng = np.random.default_rng(5)
    cut_ts = sorted(rng.integers(int(M.t[len(M.t) // 4]), int(M.t[-1]), cuts))
    checked = diff = 0
    for cut in cut_ts:
        Mc = n2.truncate(M, cut)
        loadc, yrsc = n2.year_loader(Mc)
        part = cf.run_many(cands_of(Mc), specs, None, years=yrsc, loader=loadc)
        for sp in specs:
            fa, pa = full[sp.key], part[sp.key]
            if not len(fa):
                continue
            cols = ["entry_t", "side", "exit_t", "R", "est_cost"]
            x = fa[fa.exit_t < cut - 3600][cols].round(9)
            y = pa[pa.exit_t < cut - 3600][cols].round(9) if len(pa) else x.iloc[:0]
            checked += len(x)
            diff += len(set(map(tuple, x.to_numpy())) ^ set(map(tuple, y.to_numpy())))
    return (f"no-peeking: {len(cut_ts)} cut times, {len(specs)} specs (5 rules x 2 min stops x 4 X); minutes after the "
            f"cut deleted and everything rebuilt: {checked} trades closed before the cut compared, {diff} differ (must be 0)")


def one_seed(seed):
    M = fake(seed)
    load, yrs = n2.year_loader(M)
    cs = cands_of(M)
    out = {}
    for cost in ("base", "low"):
        res = cf.run_many(cs, cf.all_specs(), None, cost=cost, years=yrs, loader=load)
        for sp in cf.all_specs():
            df = res[sp.key]
            g = (df.R + df.cost_R) if len(df) else pd.Series(dtype=float)
            out[(cost, sp.strat, cf.xlabel(sp.x))] = out.get((cost, sp.strat, cf.xlabel(sp.x)), (0.0, 0, 0.0))
            a, n, c = out[(cost, sp.strat, cf.xlabel(sp.x))]
            out[(cost, sp.strat, cf.xlabel(sp.x))] = (a + float(g.sum()), n + len(df), c + float(df.R.sum()) if len(df) else c)
    return out


def null_test(seeds=range(600, 624)):
    with ProcessPoolExecutor(6) as ex:
        out = list(ex.map(one_seed, seeds))
    rows = []
    for k in out[0]:
        per = np.array([o[k][0] / max(o[k][1], 1) for o in out])
        n = sum(o[k][1] for o in out)
        net = sum(o[k][2] for o in out) / max(n, 1)
        se = float(np.std(per, ddof=1) / np.sqrt(len(per)))
        rows.append({"cost": k[0], "rule": k[1], "X": k[2], "trades": n, "gross_R/trade": round(float(per.mean()), 4),
                     "se": round(se, 4), "z": round(float(per.mean()) / se, 2) if se > 0 else np.nan,
                     "net_R/trade": round(net, 4)})
    d = pd.DataFrame(rows)
    txt = (f"null test: {len(seeds)} driftless random walks (3 years of 24 h minutes each), random spread "
           f"(hourly level ~$0.30, independent of price), $0.10 slippage, no news pause; both min stops pooled.\n"
           f"Gross R (before spread, slippage, commission) must average ~0 for every rule and X; net R is gross minus costs.\n"
           + d.to_string(index=False)
           + f"\nmax |z| = {d.z.abs().max():.2f} over {len(d)} groups")
    return txt


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    parts = []
    for name, fn in (("eq", equivalence), ("filter", filter_check), ("peek", no_peek), ("null", null_test)):
        if what in ("all", name):
            r = fn()
            print(r, flush=True)
            parts.append(r)
    os.makedirs(cf.RES, exist_ok=True)
    if what == "all":
        with open(OUT, "w", encoding="utf-8") as f:
            f.write("\n\n".join(parts) + "\n")
