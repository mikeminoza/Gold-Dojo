"""Experiments for docs/swing-research.md. Run in this order:

    python -m research.swing_null           # engine checks on fake prices
    python -m research.run_swing data       # data notes (no strategy results)
    python -m research.run_swing train      # all pre-registered variants, TRAIN only; freezes finalists
    python -m research.run_swing train_random  # diagnostic: random-entry benchmark on TRAIN
    python -m research.run_swing holdout    # finalists on the HOLDOUT, once (refuses a 2nd run)

Results are printed as markdown and saved to research/swing_results/.
"""
import argparse
import json
import os
import sys
from functools import lru_cache

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from research import swing  # noqa: E402
from research.swing import V, md  # noqa: E402

SPLIT = pd.Timestamp("2019-01-01", tz="UTC")
OUT = os.path.join(ROOT, "research", "swing_results")
FINALISTS_FILE = os.path.join(OUT, "finalists.json")
HOLDOUT_FILE = os.path.join(OUT, "holdout.json")
N_VALUES, K_VALUES, S1_EXITS = [20, 55, 100], [2.0, 3.0], ["channel", "trail"]
TRENDS, S2_EXITS = ["sma200", "50>200"], ["3R", "trail"]
MONTHS = [3, 6, 12]
COLS = ("trades", "per_year", "win_%", "pf", "total_R", "result_$", "drop_%", "mtm_drop_%", "losing_years", "years",
        "loss_streak", "avg_hold", "exposure_%", "long_R", "short_n", "short_R", "short_pf", "gross_pf",
        "cost_R_per_trade", "std_result_$", "std_skip")


# ---------------------------------------------------------------- pre-registered variants
def grid(long_only=False):
    out = [V("S1", n=n, k=k, exit=e, long_only=long_only) for n in N_VALUES for k in K_VALUES for e in S1_EXITS]
    out += [V("S2", trend=tr, exit=e, k=2.0, long_only=long_only) for tr in TRENDS for e in S2_EXITS]
    if not long_only:
        out += [V("S3", months=m, k=3.0, exit="rebalance") for m in MONTHS]
    return out


def neighbours(v: V):
    out = []
    if v.family == "S1":
        j = N_VALUES.index(v.n)
        out += [v.with_(n=N_VALUES[x]) for x in (j - 1, j + 1) if 0 <= x < len(N_VALUES)]
        out += [v.with_(k=k) for k in K_VALUES if k != v.k] + [v.with_(exit=e) for e in S1_EXITS if e != v.exit]
    elif v.family == "S2":
        out += [v.with_(trend=t) for t in TRENDS if t != v.trend] + [v.with_(exit=e) for e in S2_EXITS if e != v.exit]
    else:
        j = MONTHS.index(v.months)
        out += [v.with_(months=MONTHS[x]) for x in (j - 1, j + 1) if 0 <= x < len(MONTHS)]
    return out


def family(v: V):
    return "S4" if v.long_only else v.family


# ---------------------------------------------------------------- data
@lru_cache(maxsize=None)
def load(tf):
    return pd.read_parquet(os.path.join(swing.DATA, f"xauusd_{tf}.parquet"))


@lru_cache(maxsize=None)
def daily():
    return swing.indicators(load("D1"))


def intraday(until=None):
    h1, m30 = load("H1"), load("M30")
    if until is not None:
        h1, m30 = h1[h1.time < until], m30[m30.time < until]
    return swing.Intraday(h1.reset_index(drop=True), m30.reset_index(drop=True))


def split_index(d):
    return int(np.searchsorted(d["time"].dt.tz_convert(None).to_numpy(), SPLIT.tz_convert(None).to_datetime64()))


def measure(d, t, lo, hi, cost_mult=1.0):
    m = swing.metrics(d, t, lo, hi, cost_mult)
    if not t.empty:
        m["gross_pf"] = round(swing.pf(t.gross / t.risk), 2)
    return m


# ---------------------------------------------------------------- selection rules
def eligible(m):
    return (m.get("trades", 0) >= 60 and m.get("pf", 0) >= 1.20 and m.get("drop_%", -999) > -30
            and m.get("losing_years", 99) <= 6)


def stable(v, res):
    return all(res[n.key].get("pf", 0) >= 1.0 and abs(res[n.key].get("pf", 0) - res[v.key]["pf"]) <= 0.25
               for n in neighbours(v))


def ranked(vs, res):
    vs = sorted(vs, key=lambda v: -res[v.key].get("pf", 0))
    if not vs:
        return []
    top = res[vs[0].key].get("pf", 0)
    tied = [v for v in vs if top - res[v.key].get("pf", 0) <= 0.05]
    tied.sort(key=lambda v: (res[v.key]["losing_years"], -res[v.key]["drop_%"]))
    return tied + [v for v in vs if v not in tied]


def table(res, keys):
    return pd.DataFrame([{"id": k, **{c: res[k].get(c) for c in COLS}} for k in keys])


# ---------------------------------------------------------------- commands
def cmd_data():
    d = daily()
    rows = []
    for y, g in d.groupby(d.time.dt.year):
        rows.append({"year": int(y), "days": len(g), "median_close": round(float(g.close.median()), 1),
                     "median_ATR20": round(float(g.atr.median()), 2), "median_spread": round(float(g.spread.median()), 2),
                     "2xATR_stop_in_%_of_$500_at_0.01_lot": round(100 * 2 * float(g.atr.median()) / 500, 1)})
    print(md(pd.DataFrame(rows)))
    print(f"\nD1 {len(d):,} candles {d.time.iat[0].date()} - {d.time.iat[-1].date()}; split index {split_index(d)}; "
          f"H1 {len(load('H1')):,}; M30 {len(load('M30')):,}")
    gaps = d.time.diff().dt.days.value_counts().sort_index()
    print("gaps between daily candles (days: count):", gaps.to_dict())


def cmd_train():
    if os.path.exists(HOLDOUT_FILE):
        raise SystemExit("Holdout already evaluated; train selection is frozen.")
    os.makedirs(OUT, exist_ok=True)
    d = daily()
    hi = split_index(d) - 1
    intr = intraday(SPLIT)
    res, trades = {}, {}
    for v in grid() + grid(long_only=True):
        t = swing.run(d, v, hi, intraday=intr)
        trades[v.key], res[v.key] = t, measure(d, t, 0, hi)
        print(f"  {v.key}: {res[v.key].get('trades')} trades, PF {res[v.key].get('pf')}", flush=True)
    print("intraday resolution (train, S2 3R):", intr.counts)

    main = grid()
    best = {f: ranked([v for v in main if v.family == f], res)[0] for f in ("S1", "S2", "S3")}
    s4 = [best["S1"].with_(long_only=True), best["S2"].with_(long_only=True)]
    cands = main + s4
    for v in cands:
        res[v.key]["eligible"] = eligible(res[v.key])
        res[v.key]["stable"] = stable(v, res) if res[v.key]["eligible"] else None
    ok = [v for v in cands if res[v.key]["eligible"] and res[v.key]["stable"]]
    picked, fams = [], set()
    for v in ranked(ok, res):
        if family(v) in fams:
            continue
        picked.append(v)
        fams.add(family(v))
        if len(picked) == 3:
            break
    best["S4"] = ranked(s4, res)[0]

    print("\n## Train (2003-05-05 - 2018-12-31)\n")
    tb = table(res, [v.key for v in cands])
    tb["eligible"] = [res[v.key]["eligible"] for v in cands]
    tb["stable"] = [res[v.key]["stable"] for v in cands]
    print(md(tb))
    print("\n### Long-only versions of every S1/S2 point (stability reference for S4)\n")
    print(md(table(res, [v.key for v in grid(long_only=True)])))
    bh = swing.buy_hold(d, 0, hi)
    bh_sw = swing.buy_hold(d, 0, hi, swap=swing.SWAP)
    print("\nbuy-and-hold train, spot:", bh, "\nbuy-and-hold train, with 0.02%/night:", bh_sw)
    print("\nbest per family (ranking rule):", {f: v.key for f, v in best.items()})
    print("Finalists:", [v.key for v in picked] or "none")
    for v in [*picked, *[b for b in best.values() if b not in picked]]:
        print(f"\n### Per year, train: {v.key}\n")
        print(md(swing.per_year(trades[v.key])))
    with open(FINALISTS_FILE, "w") as f:
        json.dump({"frozen": pd.Timestamp.now(tz="UTC").isoformat(), "finalists": [v.__dict__ for v in picked],
                   "best": {k: v.__dict__ for k, v in best.items()}, "train": res,
                   "buy_hold": {"spot": bh, "swap": bh_sw}}, f, indent=1, default=str)
    print(f"\nFrozen -> {FINALISTS_FILE}")


def stop_k(v):
    return v.k if v.family == "S1" else (2.0 if v.family == "S2" else 3.0)


def cmd_holdout():
    if os.path.exists(HOLDOUT_FILE):
        print(open(HOLDOUT_FILE).read())
        raise SystemExit("Holdout already evaluated once (shown above). Not re-running.")
    frozen = json.load(open(FINALISTS_FILE))
    d = daily()
    lo, hi = split_index(d), len(d) - 1
    intr = intraday()

    def hold(v, cost_mult=1.0):
        t = swing.run(d, v, hi, intraday=intr, cost_mult=cost_mult)
        t = t[t.entry_i >= lo].reset_index(drop=True) if not t.empty else t
        return t, measure(d, t, lo, hi, cost_mult)

    out = {"run": pd.Timestamp.now(tz="UTC").isoformat(),
           "buy_hold": {"spot": swing.buy_hold(d, lo, hi), "swap": swing.buy_hold(d, lo, hi, swap=swing.SWAP)},
           "rows": {}, "years": {}, "robust": {}, "reference": {}}
    bh = out["buy_hold"]["spot"]
    finalists = [V(**x) for x in frozen["finalists"]]
    def battery(v, m, t):
        _, stress = hold(v, 1.5)
        rnd = swing.random_entry(d, t, lo, hi, stop_k(v))
        r = {"cost_x1.5": stress, "random": rnd,
             "perturb": {n.key: hold(n)[1] for n in neighbours(v)}}
        if v.long_only:
            r["random_long_only_extra"] = swing.random_entry(d, t, lo, hi, stop_k(v), long_only=True)
        checks = {"pf>1.2": m.get("pf", 0) > 1.2, ">=40 trades": m.get("trades", 0) >= 40,
                  "mtm drop<30%": m.get("mtm_drop_%", -999) > -30, "beats 90% random": rnd["percentile"] >= 90,
                  "cost x1.5 pf>1": stress.get("pf", 0) > 1.0,
                  "adds over buy-and-hold": m.get("ret_per_drop", 0) > bh["ret_per_drop"]
                  or (m.get("short_n", 0) >= 15 and (m.get("short_pf") or 0) > 1.0)}
        r["checks"], r["all_pass"] = checks, all(checks.values())
        return r

    for v in finalists:
        t, m = hold(v)
        out["rows"][v.key], out["years"][v.key] = m, swing.per_year(t).to_dict("records")
        r = battery(v, m, t)
        r["verdict"] = "Robust" if r["all_pass"] else "Not robust"
        out["robust"][v.key] = r
        print(v.key, r["verdict"], flush=True)
    if not finalists:  # reference rows only, NO verdict (docs/swing-research.md, addendum)
        refs = {f: V(**x) for f, x in frozen["best"].items()}
        refs["S4 (2nd eligible)"] = V("S2", trend="50>200", exit="trail", k=2.0, long_only=True)
        for f, v in refs.items():
            t, m = hold(v)
            out["reference"][v.key] = {"family": f, **m}
            out["years"][v.key] = swing.per_year(t).to_dict("records")
            out["robust"][v.key] = battery(v, m, t)
            out["robust"][v.key]["verdict"] = "none (not a finalist)"
            print(v.key, "checks:", out["robust"][v.key]["checks"], flush=True)
    out["intraday"] = intr.counts
    with open(HOLDOUT_FILE, "w") as f:
        json.dump(out, f, indent=1, default=str)
    print(json.dumps(out, indent=1, default=str))


def cmd_train_random():
    """Diagnostic, TRAIN only: random-entry benchmark for the best point of each family + 2nd eligible."""
    frozen = json.load(open(FINALISTS_FILE))
    d = daily()
    hi = split_index(d) - 1
    intr = intraday(SPLIT)
    refs = [V(**x) for x in frozen["best"].values()] + [V("S2", trend="50>200", exit="trail", k=2.0, long_only=True)]
    for v in refs:
        t = swing.run(d, v, hi, intraday=intr)
        r = swing.random_entry(d, t, 0, hi, stop_k(v))
        extra = swing.random_entry(d, t, 0, hi, stop_k(v), long_only=True) if v.long_only else None
        print(v.key, r, "| long-only random:", extra)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["data", "train", "train_random", "holdout"])
    args = ap.parse_args()
    pd.set_option("display.width", 220)
    {"data": cmd_data, "train": cmd_train, "train_random": cmd_train_random, "holdout": cmd_holdout}[args.cmd]()


if __name__ == "__main__":
    main()
