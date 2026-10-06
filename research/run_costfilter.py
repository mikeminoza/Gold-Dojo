"""Experiments for docs/cost-filter-research.md.

    python -m research.costfilter_null        # engine checks on fake prices
    python -m research.run_costfilter runs    # all 40 specs x 4 cost settings, 2003-2026 -> cache/ (trades)
    python -m research.run_costfilter repro   # X=none, m=$2 on train vs the earlier study's numbers
    python -m research.run_costfilter train   # train grid + frozen train choices (train_choices.json)
    python -m research.run_costfilter wf      # walk-forward 2008-2026 (main evidence) + verdicts
    python -m research.run_costfilter holdout # train choices on 2019-2026 (contaminated holdout)
Each report command takes an optional cost scenario: base (default) or low (low-cost broker scenario).
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import costfilter as cf  # noqa: E402
from research import intraday2 as core  # noqa: E402

RES, CACHE = cf.RES, cf.CACHE
COSTS = ["base", "x1.5", "low", "low_x1.5"]
TRAIN_END = 2018
TRAIN_YEARS = (pd.Timestamp("2019-01-01") - pd.Timestamp("2003-05-05")).days / 365.25
HOLD_YEARS = (pd.Timestamp("2026-10-01") - pd.Timestamp("2019-01-01")).days / 365.25
WF_YEARS = list(range(2008, 2027))
WF_SPAN = (pd.Timestamp("2026-10-01") - pd.Timestamp("2008-01-01")).days / 365.25
X_ORDER = [None, 0.12, 0.08, 0.05]          # least filtering first (tie rule)
X_LINE = [0.05, 0.08, 0.12, None]           # neighbour order
SHOW = ["trades", "per_yr", "win_%", "pf", "gross_pf", "total_R", "cost_R", "drop_%", "result_$", "drop_$%",
        "losing_years", "years"]


def out(name, text):
    with open(os.path.join(RES, name), "w", encoding="utf-8") as f:
        f.write(text)


def path(cost, key):
    return os.path.join(CACHE, cost, key.replace(" ", "_").replace("%", "pct").replace("=", "") + ".parquet")


def cmd_runs():
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, ".gitignore"), "w") as f:
        f.write("*\n")
    cands = cf.real_candidates()
    rel = core.load_release_times()
    for cost in COSTS:
        os.makedirs(os.path.join(CACHE, cost), exist_ok=True)
        res = cf.run_many(cands, cf.all_specs(), rel, cost=cost)
        skipped = {}
        for k, df in res.items():
            skipped[k] = df.attrs["skipped"]
            df.attrs = {}
            df.drop(columns=["group"]).to_parquet(path(cost, k))
        with open(os.path.join(CACHE, cost, "skipped.json"), "w") as f:
            json.dump(skipped, f, indent=1)
        print(f"{cost}: done ({sum(len(d) for d in res.values()):,} trades over 40 specs)", flush=True)


_loaded = {}


def load(cost):
    if cost not in _loaded:
        _loaded[cost] = {sp.key: pd.read_parquet(path(cost, sp.key)) for sp in cf.all_specs()}
    return _loaded[cost]


def part(df, y0, y1):
    if not len(df):
        return df
    y = cf.year_of(df)
    return df[(y >= y0) & (y <= y1)].reset_index(drop=True)


def row(label, df, span, **extra):
    m = cf.metrics(df, span)
    r = {"id": label}
    r.update({c: m.get(c, "-") for c in SHOW})
    r.update(extra)
    return r


def key(strat, m, x):
    return cf.Spec(strat, m, x).key


def per_year_table(dfs, years):
    """{label: df} -> R (trades) per year."""
    rows = []
    for y in years:
        r = {"year": y}
        for lab, df in dfs.items():
            d = df[cf.year_of(df) == y] if len(df) else df
            r[lab] = f"{d.R.sum():+.1f} ({len(d)})" if len(d) else "0 (0)"
        rows.append(r)
    return core.md(pd.DataFrame(rows))


# ---------------------------------------------------------------- reproduction
def cmd_repro():
    res = load("base")
    want = {"NY": (1161, 0.61, -227.3), "S1": (309, 0.98, -3.1), "S2": (309, 1.01, 1.0), "S3": (309, 0.99, -1.3),
            "S4": (309, 0.98, -3.5)}
    lines = ["# Reproduction: X = none, m = $2, train 2003-05-05 - 2018-12-31, vs docs/london-squeeze-research.md\n"]
    rows = []
    for s, (n, p, r) in want.items():
        df = part(res[key(s, 2.0, None)], 2003, TRAIN_END)
        rows.append({"rule": s, "trades (earlier)": n, "trades": len(df), "PF (earlier)": p,
                     "PF": round(core.pf(df.R), 2), "total R (earlier)": r, "total R": round(df.R.sum(), 1),
                     "match": "yes" if (len(df) == n and abs(core.pf(df.R) - p) < 0.006 and abs(df.R.sum() - r) < 0.06) else "NO"})
    txt = "\n".join(lines) + core.md(pd.DataFrame(rows))
    out("repro_output.md", txt)
    print(txt)


# ---------------------------------------------------------------- train
def train_choice(res, strat, m):
    best, br = None, None
    for x in X_ORDER:
        df = part(res[key(strat, m, x)], 2003, TRAIN_END)
        r = float(df.R.sum()) if len(df) else 0.0
        if best is None or r > br + 1e-9:
            best, br = x, r
    return best


def cmd_train(scen="base"):
    res = load(scen)
    rows = [row(sp.key, part(res[sp.key], 2003, TRAIN_END), TRAIN_YEARS) for sp in cf.all_specs()]
    choices = {f"{s} m={m:g}": cf.xlabel(train_choice(res, s, m)) for s in cf.STRATS for m in cf.MIN_STOPS}
    txt = (f"# Train 2003-05-05 - 2018-12-31, cost scenario: {scen} (run {pd.Timestamp.now('UTC'):%Y-%m-%d %H:%M} UTC)\n\n"
           "PF / R net of costs; gross_pf before costs; cost_R = average spread + slippage (+ commission) per trade in R; "
           "drop_% = worst fall of cumulative R at 1% risk (% of $500); result_$ / drop_$% = live sizing on $500.\n\n"
           + core.md(pd.DataFrame(rows))
           + "\n\n## Train choice of X per (rule, m) (highest train total R; ties -> less filtering)\n\n"
           + "\n".join(f"- {k}: X = {v}" for k, v in choices.items()))
    out(f"train_{scen}.md", txt)
    with open(os.path.join(RES, f"train_choices_{scen}.json"), "w") as f:
        json.dump({"frozen_utc": f"{pd.Timestamp.now('UTC'):%Y-%m-%d %H:%M}", "choices": choices}, f, indent=1)
    print(txt)


# ---------------------------------------------------------------- walk-forward
def verdict_checks(wf, wf_stress, fixed_pfs, modal_x):
    m = cf.metrics(wf, WF_SPAN)
    n = m.get("trades", 0)
    pf = m.get("pf", np.nan) if n else np.nan
    yrs = m.get("years", 0)
    c1 = n >= 150 and pf > 1.15
    c2 = yrs > 0 and m["losing_years"] <= 0.4 * yrs
    i = X_LINE.index(modal_x)
    neigh = [X_LINE[j] for j in (i - 1, i, i + 1) if 0 <= j < len(X_LINE)]
    c3 = all(fixed_pfs[x] > 1.0 for x in neigh)
    pf15 = core.pf(wf_stress.R) if len(wf_stress) else np.nan
    c4 = bool(pf15 > 1.0)
    return {"PF>1.15 & >=150": f"{pf:.2f} / {n} {'pass' if c1 else 'FAIL'}",
            "losing yrs <=40%": f"{m.get('losing_years', '-')} / {yrs} {'pass' if c2 else 'FAIL'}",
            "neighbour X PF>1": f"{' '.join(f'{cf.xlabel(x)}:{fixed_pfs[x]:.2f}' for x in neigh)} {'pass' if c3 else 'FAIL'}",
            "PF costs x1.5": f"{pf15:.2f} {'pass' if c4 else 'FAIL'}",
            "verdict": "Worth paper-tracking" if (c1 and c2 and c3 and c4) else "Not worth it"}


def cmd_wf(scen="base"):
    res, stress = load(scen), load("x1.5" if scen == "base" else "low_x1.5")
    lines = [f"# Walk-forward 2008-2026, cost scenario: {scen} (run {pd.Timestamp.now('UTC'):%Y-%m-%d %H:%M} UTC)\n",
             "Each year Y: X chosen by the highest total R over Y-5..Y-1 (ties -> less filtering). 2019-2026 years were "
             "seen by earlier studies (contaminated).\n"]
    summary, checks, choice_rows, wf_dfs = [], [], [], {}
    for s in cf.STRATS:
        for m in cf.MIN_STOPS:
            keys = [key(s, m, x) for x in X_ORDER]
            wf, ch = cf.walk_forward(res, keys, WF_YEARS)
            wfs, _ = cf.walk_forward(stress, keys, WF_YEARS, choices=ch)
            lab = f"{s} m={m:g}"
            wf_dfs[lab] = wf
            xs = {y: k.split("X=")[1] for y, k in ch.items()}
            choice_rows.append({"rule": lab, **{str(y): xs[y] for y in WF_YEARS}})
            modal = pd.Series(list(xs.values())).value_counts()
            modal_lab = modal.index[0]
            modal_x = next(x for x in X_LINE if cf.xlabel(x) == modal_lab)
            fixed = {x: core.pf(part(res[key(s, m, x)], 2008, 2026).R) if len(part(res[key(s, m, x)], 2008, 2026)) else np.nan
                     for x in X_LINE}
            summary.append(row(f"WF {lab}", wf, WF_SPAN))
            summary.append(row(f"  WF {lab} 2008-2018", part(wf, 2008, 2018), 11.0))
            summary.append(row(f"  WF {lab} 2019-2026 (contaminated)", part(wf, 2019, 2026), HOLD_YEARS))
            for x in X_LINE:
                summary.append(row(f"  fixed X={cf.xlabel(x)} 2008-2026", part(res[key(s, m, x)], 2008, 2026), WF_SPAN))
            checks.append({"rule": lab, "modal X": modal_lab, **verdict_checks(wf, wfs, fixed, modal_x)})
    # family-level walk-forwards (information only)
    fam = {"NY family (m, X)": [key("NY", m, x) for m in cf.MIN_STOPS for x in X_ORDER],
           "Squeeze family (rule, m, X)": [key(s, m, x) for s in cf.SQ for m in cf.MIN_STOPS for x in X_ORDER]}
    fam_rows, fam_choice = [], []
    for lab, keys in fam.items():
        wf, ch = cf.walk_forward(res, keys, WF_YEARS)
        wfs, _ = cf.walk_forward(stress, keys, WF_YEARS, choices=ch)
        fam_rows.append(row(f"WF {lab}", wf, WF_SPAN, pf_x15=round(core.pf(wfs.R), 2) if len(wfs) else "-"))
        fam_choice.append({"family": lab, **{str(y): ch[y] for y in WF_YEARS}})
        wf_dfs[lab] = wf
    lines += ["## Walk-forward results (stitched out-of-sample) and fixed-X references over the same years\n",
              core.md(pd.DataFrame(summary)),
              "\n## X chosen each year\n", core.md(pd.DataFrame(choice_rows)),
              "\n## Verdict checks (pre-registered)\n", core.md(pd.DataFrame(checks)),
              "\n## Family-level walk-forwards (information only)\n", core.md(pd.DataFrame(fam_rows)),
              "\n", core.md(pd.DataFrame(fam_choice)),
              "\n## R (trades) per year, walk-forward\n", per_year_table(wf_dfs, WF_YEARS)]
    txt = "\n".join(lines)
    out(f"wf_{scen}.md", txt)
    print(txt)


# ---------------------------------------------------------------- contaminated holdout
def cmd_holdout(scen="base"):
    res, stress = load(scen), load("x1.5" if scen == "base" else "low_x1.5")
    with open(os.path.join(RES, f"train_choices_{scen}.json")) as f:
        ch = json.load(f)["choices"]
    rows, dfs = [], {}
    for s in cf.STRATS:
        for m in cf.MIN_STOPS:
            lab = f"{s} m={m:g}"
            x = next(x for x in X_ORDER if cf.xlabel(x) == ch[lab])
            df = part(res[key(s, m, x)], 2019, 2026)
            ds = part(stress[key(s, m, x)], 2019, 2026)
            rows.append(row(f"{lab} X={ch[lab]} (train choice)", df, HOLD_YEARS,
                            pf_x15=round(core.pf(ds.R), 2) if len(ds) else "-"))
            if x is not None:
                d0 = part(res[key(s, m, None)], 2019, 2026)
                rows.append(row(f"  {lab} X=none (unfiltered)", d0, HOLD_YEARS))
            dfs[f"{lab} X={ch[lab]}"] = df
    txt = (f"# 2019-01-01 - 2026-09-30, CONTAMINATED HOLDOUT (seen by four earlier studies), weak evidence; "
           f"cost scenario: {scen}\n\n" + core.md(pd.DataFrame(rows))
           + "\n\n## R (trades) per year\n\n" + per_year_table(dfs, range(2019, 2027)))
    out(f"holdout_{scen}.md", txt)
    print(txt)


# ---------------------------------------------------------------- post-hoc diagnostics (no verdict weight)
def cmd_diag():
    """Written after the walk-forward, to understand the NY pass. Base costs."""
    res = load("base")
    ny0, ny8, ny12 = (res[key("NY", 2.0, x)] for x in (None, 0.08, 0.12))
    wf, ch = cf.walk_forward(res, [key("NY", 2.0, x) for x in X_ORDER], WF_YEARS)
    L = ["# Post-hoc diagnostics for the New York walk-forward (base costs, no verdict weight)\n"]
    # 1. per year: unfiltered vs filtered, median stop
    rows = []
    for y in range(2003, 2027):
        r = {"year": y}
        for lab, df in (("none", ny0), ("12%", ny12), ("8%", ny8)):
            d = df[cf.year_of(df) == y]
            r[f"{lab} trades"] = len(d)
            r[f"{lab} R"] = round(d.R.sum(), 1)
        d = ny0[cf.year_of(ny0) == y]
        r["median stop $"] = round(d.risk.median(), 2) if len(d) else "-"
        r["median exp. cost $"] = round(d.est_cost.median(), 2) if len(d) else "-"
        w = wf[cf.year_of(wf) == y] if len(wf) and y >= 2008 else wf.iloc[:0] if len(wf) else wf
        r["WF X"] = ch[y].split("X=")[1] if y in ch else "-"
        r["WF R"] = round(w.R.sum(), 1) if len(w) else 0
        rows.append(r)
    L += ["## 1. New York breakout per year: unfiltered vs X=12% vs X=8% (m=$2), and the walk-forward\n",
          core.md(pd.DataFrame(rows))]
    # 2. gross and net R by expected-cost bucket, unfiltered NY
    b = pd.cut(ny0.est_cost_pct, [0, 5, 8, 12, 20, 1000], labels=["<5%", "5-8%", "8-12%", "12-20%", ">20%"])
    rows = []
    for per, sel in (("2003-2018", cf.year_of(ny0) <= 2018), ("2019-2026", cf.year_of(ny0) >= 2019)):
        for lab in b.cat.categories:
            d = ny0[sel & (b == lab)]
            if len(d):
                rows.append({"period": per, "exp. cost / stop": lab, "trades": len(d),
                             "gross R/trade": round(float((d.R + d.cost_R).mean()), 3),
                             "cost R/trade": round(float(d.cost_R.mean()), 3), "net R/trade": round(float(d.R.mean()), 3),
                             "net PF": round(core.pf(d.R), 2)})
    L += ["\n## 2. Unfiltered New York trades by expected cost / stop: gross edge, cost and net\n", core.md(pd.DataFrame(rows))]
    # 3. random same-year subsets of the unfiltered trades
    rng = np.random.default_rng(17)
    years = cf.year_of(wf).to_numpy()
    pools = {y: ny0[cf.year_of(ny0) == y].R.to_numpy() for y in set(years)}
    need = {y: int((years == y).sum()) for y in set(years)}
    pfs = []
    for _ in range(2000):
        rr = np.concatenate([rng.choice(pools[y], min(need[y], len(pools[y])), replace=False) for y in need])
        pfs.append(core.pf(rr))
    pfs = np.array(pfs)
    real = core.pf(wf.R)
    L += ["\n## 3. Random benchmark: same number of trades per year drawn at random from the unfiltered New York trades "
          "of that year (2,000 draws)\n",
          f"Walk-forward PF {real:.2f}; random subsets: median {np.median(pfs):.2f}, 90th pct {np.percentile(pfs, 90):.2f}; "
          f"walk-forward beats {100 * (pfs < real).mean():.1f}% of them."]
    # 4. concentration and sizing
    yr = wf.groupby(cf.year_of(wf)).R.sum()
    L += ["\n## 4. Concentration and live sizing (walk-forward New York trades)\n",
          f"- total R {wf.R.sum():+.1f}; best year {yr.idxmax()} {yr.max():+.1f} R ({100 * yr.max() / wf.R.sum():.0f}% of total); "
          f"2019-2026 share of trades {100 * (cf.year_of(wf) >= 2019).mean():.0f}%; years with no trade "
          f"{sum(1 for y in WF_YEARS if y not in yr.index)} of {len(WF_YEARS)}",
          f"- median stop ${wf.risk.median():.2f}; lot_size 'skip' (0.01 lot risks > 2% of $500) on {int((wf.verdict == 'skip').sum())} "
          f"of {len(wf)} trades (counted at 0.01 lot); 'high' on {int((wf.verdict == 'high').sum())}",
          f"- live-sizing $ by year: " + ", ".join(f"{y} {v:+.0f}" for y, v in wf.groupby(cf.year_of(wf)).usd.sum().items())]
    txt = "\n".join(L)
    out("diag_ny.md", txt)
    print(txt)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    scen = sys.argv[2] if len(sys.argv) > 2 else "base"
    if cmd in ("runs", "repro", "diag"):
        {"runs": cmd_runs, "repro": cmd_repro, "diag": cmd_diag}[cmd]()
    else:
        {"train": cmd_train, "wf": cmd_wf, "holdout": cmd_holdout}[cmd](scen)
