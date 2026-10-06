"""Experiments for docs/london-squeeze-research.md.

    python -m research.intraday2 build          # once: minute cache + mid bars (no download)
    python -m research.intraday2_null           # engine checks on fake prices
    python -m research.run_intraday2 data       # data facts (no strategy results)
    python -m research.run_intraday2 train      # all variants on 2003-05-05..2018-12-31 -> finalists.json
    python -m research.run_intraday2 handcheck  # one real train trade recomputed by plain loops
    python -m research.run_intraday2 holdout    # finalists once on 2019-01-01..2026-09-30 (refuses a 2nd run)
"""
import json
import os
import sys
from datetime import date

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import intraday2 as core  # noqa: E402
from research import london, squeeze  # noqa: E402

RES = core.RES
FINALISTS = os.path.join(RES, "finalists.json")
HOLDOUT = os.path.join(RES, "holdout.json")
TRAIN_YEARS = (pd.Timestamp("2019-01-01") - pd.Timestamp("2003-05-05")).days / 365.25
HOLD_YEARS = (pd.Timestamp("2026-10-01") - pd.Timestamp("2019-01-01")).days / 365.25
ELIG_TRADES, ELIG_PF, ELIG_DROP, ELIG_LOSING = 100, 1.15, -30.0, 6
STAB_PF, STAB_GAP = 1.0, 0.15


def out(path, text):
    with open(os.path.join(RES, path), "w", encoding="utf-8") as f:
        f.write(text)


# ---------------------------------------------------------------- variants and candidates
def all_variants():
    return {v.key: v for v in london.grid() + squeeze.grid()}


def neighbours(v):
    return london.neighbours(v) if isinstance(v, london.AV) else squeeze.neighbours(v)


def family(v):
    return "A" if isinstance(v, london.AV) else "B"


_prepared = {}


def prepared():
    if not _prepared:
        d1t = core.daily_table(core.load_d1())
        b15 = london.prepare(core.load_bars("M15"), d1t)
        _prepared["A"] = (b15, {a: london.ranges(b15, a) for a in london.ASIAS})
        for tf in squeeze.TFS:
            b = squeeze.prepare(core.load_bars(tf), tf, d1t)
            _prepared[tf] = (b, {n: squeeze.setups(b, n) for n in squeeze.NS})
        _prepared["NY"] = core.ny_prepare(core.load_bars("M30"), d1t)
    return _prepared


def candidates(v):
    p = prepared()
    if isinstance(v, london.AV):
        b, rngs = p["A"]
        return london.candidates(b, v, rngs[v.asia])
    b, sets = p[v.tf]
    return squeeze.candidates(b, v, sets[v.n])


def run(keys_or_variants, part, cm=1.0):
    vs = [all_variants()[k] if isinstance(k, str) else k for k in keys_or_variants]
    cs = {v.key: candidates(v) for v in vs}
    fl = {v.key: True for v in vs}
    lo, hi = (None, core.SPLIT_T) if part == "train" else (core.SPLIT_T, None)
    return core.run_many(cs, fl, core.load_release_times(), cm=cm, t_from=lo, t_to=hi)


def run_ny(part, cm=1.0):
    lo, hi = (None, core.SPLIT_T) if part == "train" else (core.SPLIT_T, None)
    c = core.ny_candidates(prepared()["NY"])
    return core.run_many({"NY live": c}, {"NY live": False}, core.load_release_times(), cm=cm, t_from=lo, t_to=hi)["NY live"]


# ---------------------------------------------------------------- data facts
def cmd_data():
    lines = ["# Data facts (no strategy results)\n"]
    b15 = core.add_local(core.load_bars("M15"), 900)
    b15["year"] = pd.to_datetime(b15.t, unit="s", utc=True).dt.year
    b15["atr"] = core.wilder_atr(b15.h.to_numpy(), b15.l.to_numpy(), b15.c.to_numpy(), 14)
    d1 = core.load_d1()
    d1t = core.daily_table(d1)
    d1t["year"] = pd.to_datetime(d1t.date).dt.year
    rows = []
    for y, g in b15.groupby("year"):
        lm = g.lon_min
        asia = g[lm < 420].groupby("lon_date").agg(h=("h", "max"), l=("l", "min"), n=("h", "size"))
        asia = asia[asia.n >= 14]
        rows.append({"year": y, "M15 bars": len(g), "median close": round(g.c.median(), 0),
                     "M15 ATR14": round(g.atr.median(), 2),
                     "D1 ATR14": round(d1t[d1t.year == y].atr.median(), 2),
                     "A1 range width": round((asia.h - asia.l).median(), 2),
                     "spread 23-07 Lon": round(g[(lm < 420) | (lm >= 1380)].spread.median(), 3),
                     "spread 07-10 Lon": round(g[(lm >= 420) & (lm < 600)].spread.median(), 3),
                     "spread 10-20 Lon": round(g[(lm >= 600) & (lm < 1200)].spread.median(), 3),
                     "spread 21-23 UTC": round(g[pd.to_datetime(g.t, unit="s", utc=True).dt.hour.isin([21, 22])].spread.median(), 3)})
    lines.append(core.md(pd.DataFrame(rows)))
    for tf in squeeze.TFS:
        b = squeeze.prepare(core.load_bars(tf), tf, d1t)
        lines.append(f"\n{tf}: {len(b):,} bars, squeeze bars {100 * b.sq.mean():.1f}%, median ATR14 "
                     f"{np.nanmedian(b.atr):.2f}")
    rel = core.load_release_times()
    lines.append(f"\nnews releases in the calendar: {len(rel)} ({pd.Timestamp(rel[0], unit='s')} - {pd.Timestamp(rel[-1], unit='s')} UTC)")
    txt = "\n".join(lines)
    out("data_output.md", txt)
    print(txt)


# ---------------------------------------------------------------- train
def eligible(m):
    return (m.get("trades", 0) >= ELIG_TRADES and m["pf"] >= ELIG_PF and m["drop_%"] > ELIG_DROP
            and m["losing_years"] <= ELIG_LOSING)


def stable(v, res):
    pf0 = res[v.key]["pf"]
    bad = []
    for nb in neighbours(v):
        p = res[nb.key].get("pf", np.nan)
        if not (p >= STAB_PF and abs(p - pf0) <= STAB_GAP):
            bad.append(f"{nb.key} {p}")
    return not bad, bad


def rank(keys, res):
    """By PF; ties within 0.05 broken by fewer losing years, then smaller worst drop (R)."""
    ks = sorted(keys, key=lambda k: -res[k]["pf"])
    out_ = []
    while ks:
        top = res[ks[0]]["pf"]
        tie = [k for k in ks if top - res[k]["pf"] <= 0.05]
        tie.sort(key=lambda k: (res[k]["losing_years"], -res[k]["drop_%"]))
        out_.append(tie[0])
        ks.remove(tie[0])
    return out_


COLS = ["trades", "per_yr", "win_%", "pf", "total_R", "avg_R", "drop_%", "result_$", "drop_$%", "losing_years",
        "years", "loss_streak", "spread_R", "tp_%", "floored", "skip_lots"]


def table(res, keys, extra=None):
    rows = []
    for k in keys:
        m = res[k]
        r = {"id": k}
        r.update({c: m.get(c, "-") for c in COLS})
        if extra:
            r.update(extra(k))
        rows.append(r)
    return core.md(pd.DataFrame(rows))


def cmd_train():
    vs = all_variants()
    tr = run(list(vs), "train")
    res = {k: core.metrics(df, TRAIN_YEARS) for k, df in tr.items()}
    ny = run_ny("train")
    res_ny = core.metrics(ny, TRAIN_YEARS)
    elig = [k for k in vs if eligible(res[k])]
    stab = {k: stable(vs[k], res) for k in elig}
    ok = [k for k in elig if stab[k][0]]
    finalists, per_fam = [], {}
    for k in rank(ok, res):
        f = family(vs[k])
        if len(finalists) < 3 and per_fam.get(f, 0) < 2:
            finalists.append(k)
            per_fam[f] = per_fam.get(f, 0) + 1
    best = {f: rank([k for k in vs if family(vs[k]) == f and res[k].get("trades", 0) > 0], res)[0] for f in ("A", "B")}
    best100 = {f: rank([k for k in vs if family(vs[k]) == f and res[k].get("trades", 0) >= ELIG_TRADES], res)[0]
               for f in ("A", "B")}
    lines = [f"# Train 2003-05-05 - 2018-12-31 (run {pd.Timestamp.utcnow():%Y-%m-%d %H:%M} UTC)\n",
             "R, PF net of spread and $0.10 slippage per fill; drop_% = worst fall of cumulative R at 1% risk "
             "per trade (1 R = 1% of $500); result_$ / drop_$% = live sizing (lot_size, $500 standard account).\n",
             "## All variants\n",
             table(res, list(vs), lambda k: {"elig": "yes" if k in elig else "no",
                                               "stable": ("yes" if stab[k][0] else "no") if k in elig else "-"}),
             "\n## Reference: live New York breakout (same engine and costs, no floor: stops < $2 skipped)\n",
             table({"NY live": res_ny}, ["NY live"]),
             "\n## Skipped candidates (first 6 variants)\n"]
    for k in list(vs)[:6]:
        lines.append(f"- {k}: {tr[k].attrs['skipped']}")
    lines.append("\n## Eligible and stability\n")
    for k in elig:
        lines.append(f"- {k}: PF {res[k]['pf']}; stable={stab[k][0]}; failing neighbours: {stab[k][1] or '-'}")
    lines.append(f"\n## Finalists: {finalists or 'none'}\n")
    lines.append(f"Best-ranked per family (any trades): {best}; with >= {ELIG_TRADES} trades: {best100}\n")
    for k in finalists or list(dict.fromkeys(best100.values())):
        lines.append(f"\n### Per year (train): {k}\n")
        lines.append(core.md(core.per_year(tr[k]).reset_index().rename(columns={"entry_time": "year"})))
    lines.append("\n### Per year (train): NY live\n")
    lines.append(core.md(core.per_year(ny).reset_index().rename(columns={"entry_time": "year"})))
    # family summary
    lines.append("\n## Family summary\n")
    for f in ("A", "B"):
        ks = [k for k in vs if family(vs[k]) == f]
        pfs = [res[k]["pf"] for k in ks if res[k].get("trades", 0)]
        lines.append(f"- {f}: {len(ks)} points, PF median {np.median(pfs):.2f}, min {min(pfs):.2f}, max {max(pfs):.2f}, "
                     f"PF > 1.0: {sum(p > 1 for p in pfs)}, eligible {sum(k in elig for k in ks)}")
    txt = "\n".join(lines)
    out("train_output.md", txt)
    with open(FINALISTS, "w") as f:
        json.dump({"frozen_utc": f"{pd.Timestamp.utcnow():%Y-%m-%d %H:%M}", "finalists": finalists,
                   "best_per_family": best, "best_per_family_100": best100,
                   "train": {k: res[k] for k in vs}, "ny_train": res_ny}, f, indent=1, default=str)
    print(txt)


# ---------------------------------------------------------------- hand check on real data
def cmd_handcheck():
    from research import intraday2_null as nul
    fz = json.load(open(FINALISTS))
    v = london.AV("A1", "none", 1.0, "on")
    y = 2010
    M = core.load_year(y)
    d1t = core.daily_table(core.load_d1())
    b15 = london.prepare(core.load_bars("M15"), d1t)
    cands = [c for c in london.candidates(b15, v) if pd.Timestamp(c.tc, unit="s", tz="UTC").year == y]
    tr = core.run_many({v.key: cands}, {v.key: True}, core.load_release_times(), years=[y])[v.key]
    t = tr.iloc[len(tr) // 2]
    d = pd.Timestamp(t.entry_t, unit="s", tz="UTC").tz_convert(core.LON).date()
    a0, a1 = core.local_ts(d, (0, 0), core.LON), core.local_ts(d, (7, 0), core.LON)
    mid_h, mid_l = (M.ah + M.bh) / 2, (M.al + M.bl) / 2
    sel = (M.t >= a0) & (M.t < a1)
    hi, lo = mid_h[sel].max(), mid_l[sel].min()
    i = int(np.searchsorted(M.t, t.sig_t))
    side = int(t.side)
    entry = M.ao[i] + 0.10 if side > 0 else M.bo[i] - 0.10
    b = b15[b15.tc == t.sig_t].iloc[0]
    risk = max(min((entry - lo) if side > 0 else (hi - entry), 1.0 * b.atr), 2.0)
    stop, target = entry - side * risk, entry + side * 2 * risk
    t_exit = core.local_ts(d, (16, 0), core.LON)
    for j in range(i, M.n):
        if M.t[j] >= t_exit:
            px, reason = (M.bo[j] - 0.10 if side > 0 else M.ao[j] + 0.10), "Time"
            break
        if (side > 0 and M.bl[j] <= stop) or (side < 0 and M.ah[j] >= stop):
            px, reason = ((min(stop, M.bo[j]) - 0.10) if side > 0 else (max(stop, M.ao[j]) + 0.10)), "SL"
            break
        if (side > 0 and M.bh[j] >= target) or (side < 0 and M.al[j] <= target):
            px, reason = (target - 0.10 if side > 0 else target + 0.10), "TP"
            break
    R = side * (px - entry) / risk
    txt = (f"hand check on real data ({v.key}, London day {d}, finalists frozen {fz['frozen_utc']}):\n"
           f"  Asia range (mid, 00:00-07:00 London) {lo:.3f} - {hi:.3f}; signal bar close (mid) {b.c:.3f} at "
           f"{pd.Timestamp(t.sig_t, unit='s', tz='UTC').tz_convert(core.LON)}; side {side:+d}; D1 ATR {b.d_atr:.2f} "
           f"(width {hi - lo:.2f}); M15 ATR14 {b.atr:.3f}\n"
           f"  entry minute {pd.Timestamp(M.t[i], unit='s', tz='UTC')} bid/ask open {M.bo[i]:.3f}/{M.ao[i]:.3f} -> fill "
           f"{entry:.3f}; risk {risk:.3f}; stop {stop:.3f}; target {target:.3f}; exit {reason} "
           f"{pd.Timestamp(M.t[j], unit='s', tz='UTC')} at {px:.3f}; R {R:+.4f}\n"
           f"  engine: fill {t.entry:.3f}, risk {t.risk:.3f}, exit {t.reason} at {t.exit_px:.3f}, R {t.R:+.4f} -> "
           f"{'MATCH' if abs(t.R - R) < 1e-9 else 'MISMATCH'}")
    out("handcheck_output.txt", txt)
    print(txt)
    del nul


# ---------------------------------------------------------------- holdout
def daily_R(df, days):
    s = pd.Series(0.0, index=days)
    if len(df):
        g = df.groupby(df.entry_time.dt.tz_convert(core.LON).dt.date)["R"].sum()
        s.loc[g.index] += g.to_numpy()
    return s


def combo_stats(r):
    r = pd.Series(r)
    nz = r[r != 0]
    dd = core.r_drop(r.to_numpy())
    return {"total_R": round(r.sum(), 1), "pf_days": round(core.pf(nz), 2), "drop_R": round(dd, 1),
            "R_per_drop": round(r.sum() / -dd, 2) if dd < 0 else np.inf,
            "sharpe_monthly": round(float(r.groupby(pd.to_datetime(r.index).to_period("M")).sum().pipe(
                lambda m: m.mean() / m.std(ddof=1) * np.sqrt(12))), 2)}


def cmd_holdout():
    if os.path.exists(HOLDOUT):
        raise SystemExit("holdout already run once (research/intraday2_results/holdout.json); refusing a second run")
    fz = json.load(open(FINALISTS))
    vs = all_variants()
    finalists = fz["finalists"]
    role = {k: "finalist" for k in finalists}
    if not finalists:
        for k in dict.fromkeys(fz["best_per_family_100"].values()):
            role[k] = "reference (no verdict weight)"
    keys = list(role)
    nb = {k: [n.key for n in neighbours(vs[k])] for k in keys}
    allk = list(dict.fromkeys(keys + [x for k in keys for x in nb[k]]))
    ho = run(allk, "holdout")
    stress = run(keys, "holdout", cm=1.5)
    ny = run_ny("holdout")
    ny_stress = run_ny("holdout", cm=1.5)
    res = {k: core.metrics(ho[k], HOLD_YEARS) for k in allk}
    res["NY live"] = core.metrics(ny, HOLD_YEARS)
    lines = [f"# Holdout 2019-01-01 - 2026-09-30 (run {pd.Timestamp.utcnow():%Y-%m-%d %H:%M} UTC, once)\n",
             f"finalists frozen {fz['frozen_utc']} UTC: {finalists or 'none'}\n",
             table(res, keys + ["NY live"], lambda k: {"role": role.get(k, "live reference")})]
    checks = {}
    for k in keys:
        df = ho[k]
        m = res[k]
        rnd = core.random_percentile(df) if len(df) else {"pctl": np.nan, "median": np.nan, "p90": np.nan}
        pf_s = round(core.pf(stress[k].R), 2) if len(stress[k]) else np.nan
        yr = df.groupby(df.entry_time.dt.year).R.sum() if len(df) else pd.Series(dtype=float)
        tot = yr.sum()
        share = float(yr.max() / tot) if tot > 0 else np.nan
        c = {"pf>1.2": m.get("pf", 0) > 1.2, "trades>=60": m.get("trades", 0) >= 60,
             "drop<30%": m.get("drop_%", -999) > -30, "random>=90": rnd["pctl"] >= 90,
             "pf_costx1.5>1.0": pf_s > 1.0, "no_year>50%": bool(tot > 0 and share <= 0.5)}
        checks[k] = {"metrics": m, "random": rnd, "pf_cost15": pf_s, "max_year_share": round(share, 2) if share == share else None,
                     "checks": c, "robust": all(c.values()) and role[k] == "finalist"}
    lines.append("\n## Pre-registered checks\n")
    rows = []
    for k in keys:
        ck = checks[k]
        rows.append({"id": k, "role": role[k], "PF": ck["metrics"].get("pf"), "trades": ck["metrics"].get("trades"),
                     "drop_%(R)": ck["metrics"].get("drop_%"),
                     "random pctl (median, p90)": f"{ck['random']['pctl']} ({ck['random']['median']}, {ck['random']['p90']})",
                     "PF costs x1.5": ck["pf_cost15"], "max year share of R": ck["max_year_share"],
                     "passes": sum(ck["checks"].values()), "robust": "yes" if ck["robust"] else "no"})
    lines.append(core.md(pd.DataFrame(rows)))
    lines.append(f"\nNY live with costs x1.5: PF {core.pf(ny_stress.R):.2f}")
    lines.append("\n## Neighbours on the holdout (reported only)\n")
    lines.append(table(res, [x for k in keys for x in nb[k]]))
    lines.append("\n## Per year (holdout), R / $ (trades)\n")
    py = {k: core.per_year(ho[k]) for k in keys}
    py["NY live"] = core.per_year(ny)
    yrs = sorted(set().union(*[set(p.index) for p in py.values() if len(p)]))
    rows = []
    for y in yrs:
        r = {"year": y}
        for k, p in py.items():
            r[k] = f"{p.R[y]:+.1f} / {p['$'][y]:+.2f} ({p.trades[y]})" if y in p.index else "-"
        rows.append(r)
    lines.append(core.md(pd.DataFrame(rows)))
    # correlation and combination with the live NY breakout
    days = pd.bdate_range("2019-01-01", "2026-09-30").date
    ny_d = daily_R(ny, days)
    lines.append("\n## Combination with the live New York breakout (holdout, 1% risk each, R)\n")
    rows = [{"stream": "NY live alone", **combo_stats(ny_d)}]
    corr = {}
    for k in keys:
        kd = daily_R(ho[k], days)
        mo_k = kd.groupby(pd.to_datetime(kd.index).to_period("M")).sum()
        mo_n = ny_d.groupby(pd.to_datetime(ny_d.index).to_period("M")).sum()
        corr[k] = {"daily": round(float(np.corrcoef(kd, ny_d)[0, 1]), 3), "monthly": round(float(np.corrcoef(mo_k, mo_n)[0, 1]), 3),
                   "same_day_trades": int(((kd != 0) & (ny_d != 0)).sum())}
        rows.append({"stream": f"{k} alone", **combo_stats(kd)})
        rows.append({"stream": f"NY live + {k}", **combo_stats(kd + ny_d)})
    lines.append(core.md(pd.DataFrame(rows)))
    lines.append("\nCorrelation with NY live (daily R over all holdout weekdays; monthly R): " + json.dumps(corr))
    txt = "\n".join(lines)
    out("holdout_output.md", txt)
    with open(HOLDOUT, "w") as f:
        json.dump({"run_utc": f"{pd.Timestamp.utcnow():%Y-%m-%d %H:%M}", "role": role, "checks": checks,
                   "ny": res["NY live"], "corr": corr}, f, indent=1, default=str)
    print(txt)


def cmd_diag():
    """After the holdout, no selection weight: gross (before spread and slippage) R per trade on train."""
    vs = all_variants()
    tr = run(list(vs), "train")
    tr["NY live"] = run_ny("train")
    rows = []
    for k, df in tr.items():
        g = df.R + df.spread_R + df.slip_R
        rows.append({"id": k, "trades": len(df), "net PF": round(core.pf(df.R), 2), "net R/trade": round(df.R.mean(), 3),
                     "gross PF": round(core.pf(g), 2), "gross R/trade": round(g.mean(), 3),
                     "costs R/trade": round((df.spread_R + df.slip_R).mean(), 3),
                     "median risk $": round(df.risk.median(), 2)})
    d = pd.DataFrame(rows)
    txt = "# Diagnostics (train, after the holdout, no selection weight)\n\n" + core.md(d)
    for f, sel in (("A", d.id.str.startswith("A ")), ("B", d.id.str.startswith("B "))):
        txt += (f"\n\n{f}: gross PF median {d[sel]['gross PF'].median():.2f} (min {d[sel]['gross PF'].min():.2f}, "
                f"max {d[sel]['gross PF'].max():.2f}); costs median {d[sel]['costs R/trade'].median():.3f} R/trade")
    out("diag_output.md", txt)
    print(txt)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"data": cmd_data, "train": cmd_train, "handcheck": cmd_handcheck, "holdout": cmd_holdout, "diag": cmd_diag}[cmd]()
