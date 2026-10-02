"""Experiments for docs/news-research.md. Run in this order:

    python -m research.news_calendar        # official calendar -> research/news/us_events.csv
    python -m research.news build           # minute bid/ask cache from data/dukascopy (no download)
    python -m research.news_null            # engine checks on fake prices
    python -m research.run_news data        # data notes (no rule results)
    python -m research.run_news train       # all pre-registered variants, TRAIN only; freezes finalists
    python -m research.run_news holdout     # finalists (or reference rows) on the HOLDOUT, once

Results are printed as markdown and saved to research/news/results/.
"""
import argparse
import json
import os
import sys
from datetime import date
from functools import lru_cache

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from research import news  # noqa: E402
from research.news import V, md  # noqa: E402

OUT = os.path.join(ROOT, "research", "news", "results")
FINALISTS_FILE = os.path.join(OUT, "finalists.json")
HOLDOUT_FILE = os.path.join(OUT, "holdout.json")
SPLIT_DATE = date(2019, 1, 1)
RANDOM_RUNS = 1000
EXTRAS = [V("N1", "FOMC", 30, 0.5, "ext", "2R"),
          V("N4", "ALL", 30, 1.0, "2ATR", "EOS", trend=True, base="N1")]
TABLE = ("trades", "win_%", "pf", "total_R", "result_$", "drop_%", "losing_years", "years", "loss_streak",
         "spread_R", "slip_R", "gross_R", "skip_lots", "longs")


# ---------------------------------------------------------------- data
@lru_cache(maxsize=None)
def minutes():
    return news.load_minutes()


@lru_cache(maxsize=None)
def trend():
    return news.daily_trend(pd.read_parquet(news.D1_FILE))


def make_events(ev_df):
    M, tr = minutes(), trend()
    out = []
    for r in ev_df.itertuples():
        d_utc = pd.Timestamp(r.T, unit="s", tz="UTC").date()
        out.append(news.Event(M.day(r.date), int(r.T), r.type, r.date, news.trend_before(tr, d_utc)))
    return out


@lru_cache(maxsize=None)
def events(period):
    ev = news.load_events()
    ev = ev[ev.date < SPLIT_DATE] if period == "train" else ev[ev.date >= SPLIT_DATE]
    return tuple(make_events(ev))


@lru_cache(maxsize=None)
def non_events(period, scope):
    """Pseudo-events at the release clock time on weekdays without any NFP / CPI / FOMC release."""
    ev = news.load_events()
    busy = set(ev.date)
    days = [d.date() for d in pd.bdate_range(news.START if period == "train" else SPLIT_DATE,
                                             SPLIT_DATE if period == "train" else date(2026, 9, 30))]
    days = [d for d in days if d not in busy and (d < SPLIT_DATE) == (period == "train")]
    times = {"NFP": ["08:30"], "CPI": ["08:30"], "FOMC": ["14:00"], "ALL": ["08:30", "14:00"]}[scope]
    rows = [(d, t, "NONE") for d in days for t in times]
    df = pd.DataFrame(rows, columns=["date", "time_et", "type"])
    df["T"] = [news.release_ts(d, t) for d, t in zip(df.date, df.time_et)]
    return tuple(make_events(df.sort_values("T")))


def scoped(evs, scope):
    return list(evs) if scope in ("ALL",) else [e for e in evs if e.type in (scope, "NONE")]


def trades(v, period="train", cm=1.0, keep_sig=False, pool=None):
    evs = pool if pool is not None else events(period)
    return news.run(scoped(evs, v.scope), v, cm=cm, keep_sig=keep_sig)


def row(v, df):
    m = news.metrics(df)
    return {"id": v.key, **{k: m.get(k) for k in TABLE}}


# ---------------------------------------------------------------- selection
def eligible(r):
    return (r["trades"] or 0) >= 80 and (r["pf"] or 0) >= 1.15 and r["drop_%"] > -30 and \
        r["losing_years"] <= 6


def rank_key(r):
    return (-(r["pf"] or 0), r["losing_years"] if r["losing_years"] is not None else 99, -(r["drop_%"] or -999))


def ranked(rows):
    """Sort by PF, but PFs within 0.05 of each other are ordered by fewer losing years, then smaller drop."""
    rows = sorted(rows, key=rank_key)
    out = []
    while rows:
        top = rows[0]
        tie = [r for r in rows if (top["pf"] or 0) - (r["pf"] or 0) <= 0.05]
        tie.sort(key=lambda r: (r["losing_years"], -(r["drop_%"] or -999)))
        out.append(tie[0])
        rows.remove(tie[0])
    return out


def best_for_n4(table, scope):
    cands = [r for r in table.values() if r["_v"].scope == scope and r["_v"].family in ("N1", "N3")]
    big = [r for r in cands if (r["trades"] or 0) >= 80]
    return ranked(big or cands)[0]["_v"]


# ---------------------------------------------------------------- commands
def cmd_data():
    M = minutes()
    t = pd.to_datetime(M.t, unit="s", utc=True)
    print(f"minutes 06:00-17:00 ET: {len(M.t):,}, {t[0]} - {t[-1]}, {len(M.days):,} ET days")
    ev = news.load_events()
    allev = make_events(ev)
    print("\nevents from 2003-05-05 (usable / skipped and why):")
    for typ in ("NFP", "CPI", "FOMC"):
        e = [x for x in allev if x.type == typ]
        why = pd.Series([x.why for x in e if not x.ok]).value_counts().to_dict()
        tr = sum(x.date < SPLIT_DATE for x in e if x.ok)
        print(f"  {typ}: {len(e)} events, {sum(x.ok for x in e)} usable ({tr} train, {sum(x.ok for x in e) - tr} holdout); skipped {why}")
    # spreads: release minute and +1..+4 vs the same clock minute on days without events
    rows = []
    ne = {s: non_events("train", s) + non_events("holdout", s) for s in ("NFP", "FOMC")}
    for typ in ("NFP", "CPI", "FOMC"):
        e = [x for x in allev if x.type == typ and x.ok]
        base = ne["FOMC" if typ == "FOMC" else "NFP"]
        for era, lo, hi in (("2003-2008", 2003, 2008), ("2009-2018", 2009, 2018), ("2019-2026", 2019, 2026)):
            def spreads(evs, off):
                out = []
                for x in evs:
                    if not (lo <= x.date.year <= hi) or not x.ok:
                        continue
                    i = x.day.first_at(x.T + 60 * off, x.T + 60 * off + 60)
                    if i >= 0:
                        out.append(x.day.ao[i] - x.day.bo[i])
                return np.median(out) if out else np.nan, np.percentile(out, 90) if out else np.nan
            pre, rel, p5, p15 = spreads(e, -5), spreads(e, 0), spreads(e, 5), spreads(e, 15)
            norm = spreads([x for x in base if x.ok], 0)
            atr = np.median([x.atr for x in e if lo <= x.date.year <= hi])
            rows.append({"type": typ, "years": era, "T-5 spread": round(pre[0], 2), "T (open) median / p90": f"{rel[0]:.2f} / {rel[1]:.2f}",
                         "T+5": round(p5[0], 2), "T+15": round(p15[0], 2), "same time, no-event days": round(norm[0], 2),
                         "pre-release M5 ATR": round(atr, 2)})
    print("\nspread ($/oz, ask - bid at the minute's open) and pre-release ATR, medians:")
    print(md(pd.DataFrame(rows)))


def cmd_train():
    os.makedirs(OUT, exist_ok=True)
    table = {}
    for sc in news.SCOPES:
        for v in news.grid(sc):
            df = trades(v)
            table[v.key] = {**row(v, df), "_v": v, "_skipped": df.attrs["skipped"]}
        print(f"  {sc}: {len(news.grid(sc))} grid points done", flush=True)
    n4 = {}
    for sc in news.SCOPES:
        parent = best_for_n4(table, sc)
        v4 = parent.with_(family="N4", base=parent.family, trend=True)
        n4[sc] = v4
        for v in [v4] + news.neighbours(v4):
            if v.key not in table:
                df = trades(v)
                table[v.key] = {**row(v, df), "_v": v, "_skipped": df.attrs["skipped"]}
    # eligibility, stability (stability only for the candidates: grid points and the four N4 rows)
    grid_ids = [v.key for sc in news.SCOPES for v in news.grid(sc)] + [n4[sc].key for sc in news.SCOPES]
    for r in table.values():
        r["eligible"] = eligible(r)
    for k in grid_ids:
        r = table[k]
        v = r["_v"]
        if r["eligible"]:
            nb = [table[x.key] for x in news.neighbours(v)]
            bad = [f"{x['id']} {x['pf']}" for x in nb if (x["pf"] or 0) < 1.0 or abs((x["pf"] or 0) - r["pf"]) > 0.25]
            r["stable"], r["unstable_because"] = not bad, bad
    cands = ranked([table[k] for k in grid_ids if table[k]["eligible"] and table[k].get("stable")])
    finalists, fams = [], set()
    for r in cands:
        if r["_v"].family not in fams and len(finalists) < 3:
            finalists.append(r)
            fams.add(r["_v"].family)
    # best point of each family (all scopes), for reference rows if there are no finalists
    best = {}
    for fam in ("N1", "N2", "N3", "N4"):
        rows = [table[k] for k in grid_ids if table[k]["_v"].family == fam and (table[k]["trades"] or 0) > 0]
        best[fam] = ranked(rows)[0]
    save = {"finalists": [r["_v"].__dict__ for r in finalists], "n4": {k: v.__dict__ for k, v in n4.items()},
            "best_per_family": {k: r["_v"].__dict__ for k, r in best.items()},
            "frozen": pd.Timestamp.now("UTC").isoformat()}
    with open(FINALISTS_FILE, "w") as f:
        json.dump(save, f, indent=1)
    # output
    lines = []
    cols = ["id"] + list(TABLE) + ["eligible"]
    for sc in news.SCOPES:
        ids = [v.key for v in news.grid(sc)] + [k for k in table if table[k]["_v"].scope == sc and table[k]["_v"].trend]
        df = pd.DataFrame([{c: table[k][c] for c in cols} for k in ids])
        lines += [f"\n### {sc}\n", md(df)]
    lines.append("\n### Eligible points and stability\n")
    for k in grid_ids:
        r = table[k]
        if r["eligible"]:
            lines.append(f"- {k}: PF {r['pf']}, {r['trades']} trades, drop {r['drop_%']}%, losing years "
                         f"{r['losing_years']}/{r['years']}; stable: {r['stable']}"
                         + (f" (fails: {'; '.join(r['unstable_because'])})" if not r["stable"] else ""))
    lines.append("\nN4 parents: " + "; ".join(f"{sc}: {v.key}" for sc, v in n4.items()))
    lines.append("\nFinalists: " + (", ".join(r["id"] for r in finalists) or "none"))
    lines.append("Best point per family: " + "; ".join(f"{f}: {r['id']} (PF {r['pf']}, {r['trades']} trades)" for f, r in best.items()))
    skipped = {k: table[k]["_skipped"] for k in grid_ids[:3]}
    lines.append(f"\nSkip reasons (examples): {skipped}")
    text = "\n".join(lines)
    with open(os.path.join(OUT, "train_output.md"), "w") as f:
        f.write(text)
    print(text)
    # per-year for the best points
    for fam, r in best.items():
        print(f"\nper year, train, {r['id']}:\n" + md(news.per_year(trades(r["_v"])).reset_index()))


def random_pctl(df, cm=1.0, runs=RANDOM_RUNS, seed=0):
    """Same entry minutes, stop distance, target distance and exit rule; random side."""
    both = np.zeros((len(df), 2))
    for k, t in enumerate(df.to_dict("records")):
        tdist = abs(t["target"] - t["entry"]) if np.isfinite(t["target"]) else None
        for j, s in enumerate((1, -1)):
            tr, _ = news.simulate(t["_ev"], t["_sig"], cm, side=s, risk=t["risk"], tdist=tdist)
            both[k, j] = tr["R"]
    rng = np.random.default_rng(seed)
    pfs = np.array([news.pf(both[np.arange(len(df)), rng.integers(0, 2, len(df))]) for _ in range(runs)])
    actual = news.pf(df.R)
    return float(100 * (pfs < actual).mean()), float(np.median(pfs)), float(np.percentile(pfs, 90))


def battery(v, label):
    """Holdout metrics + robustness for one variant."""
    df = trades(v, "holdout", keep_sig=True)
    m = row(v, df)
    stress = row(v, trades(v, "holdout", cm=1.5))
    pct, med, p90 = random_pctl(df) if len(df) else (np.nan, np.nan, np.nan)
    ne = news.run(scoped(non_events("holdout", v.scope), v.scope), v)
    ne_m = news.metrics(ne)
    nb = [row(x, trades(x, "holdout")) for x in news.neighbours(v)]
    checks = {"pf>1.2": (m["pf"] or 0) > 1.2, ">=40 trades": (m["trades"] or 0) >= 40,
              "drop<30%": (m["drop_%"] or -999) > -30, "random>=90": pct >= 90,
              "stress pf>1": (stress["pf"] or 0) > 1.0, "beats non-event": (m["pf"] or 0) > (ne_m.get("pf") or 0)}
    return {"label": label, "row": m, "stress": stress, "random": (pct, med, p90), "non_event": ne_m,
            "neighbours": nb, "checks": checks, "robust": all(checks.values()),
            "per_year": news.per_year(df).reset_index().to_dict("records")}


def cmd_holdout():
    if os.path.exists(HOLDOUT_FILE):
        raise SystemExit(f"Holdout already run ({HOLDOUT_FILE}). It is evaluated once; delete the file only "
                         "if the plan is pre-registered again.")
    with open(FINALISTS_FILE) as f:
        fz = json.load(f)
    fin = [V(**d) for d in fz["finalists"]]
    ref = [V(**d) for d in fz["best_per_family"].values()]
    targets = [(v, "finalist") for v in fin] or [(v, "reference (no verdict weight)") for v in ref]
    # declared in the doc's addendum before the holdout: eligible-but-unstable points, no verdict weight
    targets += [(v, "extra (no verdict weight)") for v in EXTRAS]
    res = [battery(v, lab) for v, lab in targets]
    with open(HOLDOUT_FILE, "w") as f:
        json.dump({"run": pd.Timestamp.now("UTC").isoformat(), "results": res}, f, indent=1, default=str)
    lines = ["| id | role | trades | win % | PF | total R | result $500 | worst drop | losing yrs | streak | spread R | gross R |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in res:
        m = r["row"]
        lines.append(f"| {m['id']} | {r['label']} | {m['trades']} | {m['win_%']} | {m['pf']} | {m['total_R']} | "
                     f"{m['result_$']} | {m['drop_%']}% | {m['losing_years']} / {m['years']} | {m['loss_streak']} | "
                     f"{m['spread_R']} | {m['gross_R']} |")
    lines += ["", "| id | PF>1.2 | >=40 trades | drop<30% | random pctl (median, p90) | PF costs x1.5 | non-event days (trades, PF) | robust |",
              "|---|---|---|---|---|---|---|---|"]
    for r in res:
        m, c = r["row"], r["checks"]
        ne = r["non_event"]
        lines.append(f"| {m['id']} | {m['pf']} {'pass' if c['pf>1.2'] else 'FAIL'} | {m['trades']} {'pass' if c['>=40 trades'] else 'FAIL'} | "
                     f"{m['drop_%']}% {'pass' if c['drop<30%'] else 'FAIL'} | {r['random'][0]:.1f} ({r['random'][1]:.2f}, {r['random'][2]:.2f}) "
                     f"{'pass' if c['random>=90'] else 'FAIL'} | {r['stress']['pf']} {'pass' if c['stress pf>1'] else 'FAIL'} | "
                     f"{ne.get('trades')}, {ne.get('pf')} {'pass' if c['beats non-event'] else 'FAIL'} | {'yes' if r['robust'] else 'no'} |")
    lines += ["", "Neighbours on the holdout:", "| reference | neighbour | trades | PF | total R | drop |", "|---|---|---|---|---|---|"]
    for r in res:
        for nb in r["neighbours"]:
            lines.append(f"| {r['row']['id']} | {nb['id']} | {nb['trades']} | {nb['pf']} | {nb['total_R']} | {nb['drop_%']}% |")
    for r in res:
        lines += ["", f"Per year (holdout), {r['row']['id']}:", md(pd.DataFrame(r["per_year"]))]
    text = "\n".join(lines)
    with open(os.path.join(OUT, "holdout_output.md"), "w") as f:
        f.write(text)
    print(text)


def cmd_diag():
    """Diagnostics after the holdout (not used for selection): train-period random-entry and
    non-event benchmarks for the finalist, summary of the train grid, sizing notes."""
    with open(FINALISTS_FILE) as f:
        fin = [V(**d) for d in json.load(f)["finalists"]]
    for v in fin + EXTRAS:
        df = trades(v, "train", keep_sig=True)
        pct, med, p90 = random_pctl(df)
        ne = news.metrics(news.run(scoped(non_events("train", v.scope), v.scope), v))
        print(f"{v.key}: train PF {news.pf(df.R):.2f} ({len(df)} trades); random-direction pctl {pct:.1f} "
              f"(median {med:.2f}, p90 {p90:.2f}); non-event days {ne.get('trades')} trades, PF {ne.get('pf')}; "
              f"PF costs x1.5 {news.pf(trades(v, 'train', cm=1.5).R):.2f}")
        for period in ("train", "holdout"):
            d = trades(v, period)
            print(f"   {period}: longs {int((d.side > 0).sum())} R {d.R[d.side > 0].sum():.1f}, shorts "
                  f"{int((d.side < 0).sum())} R {d.R[d.side < 0].sum():.1f}; median risk ${d.risk.median():.2f}; "
                  f"lot 'skip' {int((d.verdict == 'skip').sum())}; exits {d.reason.value_counts().to_dict()}; "
                  f"median spread at entry ${(d.spread_R * d.risk).median():.2f}")
        print("   per year, train:" + chr(10) + md(news.per_year(trades(v, "train")).reset_index()))
    rows = []
    for sc in news.SCOPES:
        for fam in ("N1", "N2", "N3"):
            r = [row(v, trades(v)) for v in news.grid(sc) if v.family == fam]
            r = [x for x in r if x["trades"]]
            big = [x for x in r if x["trades"] >= 80]
            rows.append({"scope": sc, "family": fam, "points": len(r),
                         "trades (median)": int(np.median([x["trades"] for x in r])) if r else 0,
                         "PF median": round(float(np.median([x["pf"] for x in r])), 2) if r else None,
                         "PF > 1.0": sum(x["pf"] > 1 for x in r),
                         "points with >= 80 trades": len(big),
                         "best PF with >= 80 trades": max((x["pf"] for x in big), default=None),
                         "gross R/trade (median)": round(float(np.median([x["gross_R"] for x in r])), 3) if r else None,
                         "spread R (median)": round(float(np.median([x["spread_R"] for x in r])), 3) if r else None})
    print(chr(10) + "train grid summary:" + chr(10) + md(pd.DataFrame(rows)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["data", "train", "holdout", "diag"])
    a = ap.parse_args()
    {"data": cmd_data, "train": cmd_train, "holdout": cmd_holdout, "diag": cmd_diag}[a.cmd]()


if __name__ == "__main__":
    main()
