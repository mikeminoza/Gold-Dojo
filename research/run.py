"""Experiments for docs/strategy-research.md. Run in this order:

    python -m research.dukascopy            # data (cached download) -> data/xauusd_*.parquet
    python -m research.run data             # candle counts, spread stats, price check vs PAXG
    python -m research.run train            # all pre-registered variants, TRAIN only; freezes finalists
    python -m research.run holdout          # finalists + baseline on the HOLDOUT, once (refuses a 2nd run)
    python -m research.run sanity           # current strategy on Dukascopy vs Binance PAXG (2020-2026)
    python -m research.run verify           # engine == backtest.run on Dukascopy data

Results are printed as markdown tables and saved to data/research_*.json.
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

import backtest  # noqa: E402
import config  # noqa: E402
import strategy  # noqa: E402
from research import engine  # noqa: E402
from research.strategies import Params, ResearchBreakout, add_signals, daily_features  # noqa: E402

DATA = os.path.join(ROOT, "data")
SPLIT = pd.Timestamp("2019-01-01", tz="UTC")
SECONDS = {"M30": 1800, "H1": 3600}
FINALISTS_FILE = os.path.join(DATA, "research_finalists.json")
HOLDOUT_FILE = os.path.join(DATA, "research_holdout.json")
POINT = 1.0  # spread column is already in $ per oz

# ---------------------------------------------------------------- pre-registered variants
A0 = Params()
GRIDS = {
    "B": ("trend_min", [0.5, 1.0, 1.5]),
    "C": ("atr_ratio_min", [0.8, 1.0, 1.2]),
    "D2": ("trail_mult", [0.5, 1.0, 1.5]),
}
E_T, E_TARGET = [0.5, 1.0], ["range", "1.5R"]


def variants():
    v = {"A0": A0, "A1": A0.with_(name="A1 baseline H1", timeframe="H1"),
         "A2": A0.with_(name="A2 London+NY", london=True), "D1": A0.with_(name="D1 half at 1R + BE", exit="half_be")}
    for key, (field, values) in GRIDS.items():
        for x in values:
            extra = {"exit": "trail"} if key == "D2" else {}
            v[f"{key} {x:g}"] = A0.with_(name=f"{key} {field}={x:g}", **{field: x}, **extra)
    for t in E_T:
        for tg in E_TARGET:
            v[f"E {t:g} {tg}"] = A0.with_(name=f"E fade S<{t:g} target {tg}", kind="fade",
                                          fade_trend_max=t, fade_target=tg)
    return v


def neighbours(key):
    """Immediate grid neighbours of a variant key (for the stability rule)."""
    parts = key.split()
    if parts[0] in GRIDS:
        vals = GRIDS[parts[0]][1]
        k = vals.index(float(parts[1]))
        return [f"{parts[0]} {vals[j]:g}" for j in (k - 1, k + 1) if 0 <= j < len(vals)]
    if parts[0] == "E":
        t, tg = float(parts[1]), parts[2]
        k = E_T.index(t)
        out = [f"E {E_T[j]:g} {tg}" for j in (k - 1, k + 1) if 0 <= j < len(E_T)]
        return out + [f"E {t:g} {x}" for x in E_TARGET if x != tg]
    return []


# ---------------------------------------------------------------- data + prepare
@lru_cache(maxsize=None)
def load(tf):
    return pd.read_parquet(os.path.join(DATA, f"xauusd_{tf}.parquet"))


@lru_cache(maxsize=None)
def base(tf, london):
    """SessionBreakout.prepare + daily features (no signals yet). Expensive; cached per tf/sessions."""
    strat = ResearchBreakout(A0.with_(timeframe=tf, london=london), SECONDS[tf])
    df = strategy.SessionBreakout.prepare(strat, load(tf), load("D1"))
    df = pd.merge_asof(df.sort_values("time"), daily_features(load("D1")).sort_values("d_available"),
                       left_on="time", right_on="d_available", direction="backward")
    return df.reset_index(drop=True)


def replay(p, part, spread_mult=1.0):
    """Trades of variant p in 'train' (before SPLIT) or 'holdout' (from SPLIT) or 'all'."""
    df = add_signals(base(p.timeframe, p.london), p, pd.Timedelta(seconds=SECONDS[p.timeframe]))
    if part == "train":
        df = df[df["time"] < SPLIT].reset_index(drop=True)  # the engine never sees holdout candles
    t = engine.run(df, p, SECONDS[p.timeframe], point=POINT, spread_mult=spread_mult)
    if t.empty:
        return t, df
    if part == "holdout":
        t = t[t["entry_time"] >= SPLIT].reset_index(drop=True)
    return t, df


# ---------------------------------------------------------------- metrics
def pf(pnl):
    loss = -pnl[pnl <= 0].sum()
    return float(pnl[pnl > 0].sum() / loss) if loss > 0 else float("inf")


def streak(pnl):
    best = cur = 0
    for x in pnl:
        cur = cur + 1 if x <= 0 else 0
        best = max(best, cur)
    return best


def metrics(t, start, end):
    weeks = max((end - start).days / 7, 1)
    if t.empty:
        return {"trades": 0}
    by_year = t.groupby(t["entry_time"].dt.year)
    yearly = by_year["pnl_usd"].sum()
    return {
        "trades": len(t),
        "per_week": round(len(t) / weeks, 2),
        "win_%": round(100 * float((t.pnl > 0).mean()), 1),
        "pf": round(pf(t.pnl), 2),
        "total_R": round(float(t.r.sum()), 1),
        "result_$": round(float(t.pnl_usd.sum()), 2),
        "worst_drop_%": round(float(100 * backtest._drawdown(t.pnl_usd.reset_index(drop=True)) / config.ACCOUNT_BALANCE), 1),
        "losing_years": int((yearly < 0).sum()),
        "years": int(len(yearly)),
        "loss_streak": streak(t.pnl.tolist()),
        "over_limit": int((t.verdict == "skip").sum()),
    }


def per_year(t):
    rows = []
    for y, g in t.groupby(t["entry_time"].dt.year):
        rows.append({"year": int(y), "trades": len(g), "win_%": round(100 * float((g.pnl > 0).mean()), 1),
                     "pf": round(pf(g.pnl), 2), "R": round(float(g.r.sum()), 1), "result_$": round(float(g.pnl_usd.sum()), 2)})
    return pd.DataFrame(rows)


def md(df):
    cols = list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    for r in df.itertuples(index=False):
        lines.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(lines)


def period(part):
    d = load("M30")["time"]
    return (d.iat[0], SPLIT) if part == "train" else (SPLIT, d.iat[-1])


# ---------------------------------------------------------------- commands
def cmd_data():
    rows = []
    m30, d1 = load("M30"), load("D1")
    for y, g in m30.groupby(m30["time"].dt.year):
        s = g["spread"]
        rows.append({"year": int(y), "M30": len(g), "D1": int((d1["time"].dt.year == y).sum()),
                     "first": str(g["time"].iat[0].date()), "median_close": round(float(g["close"].median()), 1),
                     "spread_med": round(float(s.median()), 3), "spread_p90": round(float(s.quantile(0.9)), 3),
                     "NY_session_spread_med": round(float(s[g["time"].dt.tz_convert("America/New_York").dt.hour.between(8, 11)].median()), 3),
                     "M30_minutes_med": int(g["minutes"].median())})
    print(md(pd.DataFrame(rows)))
    print(f"\nM30 {len(m30):,} candles {m30['time'].iat[0]} - {m30['time'].iat[-1]}; H1 {len(load('H1')):,}; D1 {len(d1):,}")
    # price level check against the cached Binance PAXG history (no strategy results)
    paxg = os.path.join(DATA, "history_M30.parquet")
    if os.path.exists(paxg):
        p = pd.read_parquet(paxg)[["time", "close"]].rename(columns={"close": "paxg"})
        j = m30[["time", "close"]].merge(p, on="time")
        j = j[j["time"] >= "2021-01-01"]
        diff = j["paxg"] - j["close"]
        print(f"PAXG vs Dukascopy XAUUSD bid, same M30 candles since 2021 ({len(j):,}): "
              f"PAXG - XAU median {diff.median():+.2f}, IQR {diff.quantile(.25):+.2f}..{diff.quantile(.75):+.2f}; "
              f"corr of 30-min returns {j['close'].pct_change().corr(j['paxg'].pct_change()):.3f}")


def cmd_verify():
    """engine.run == backtest.run on Dukascopy data (fixed exits)."""
    for key in ("A0", "B 1", "C 1", "A2"):
        p = variants()[key]
        strat = ResearchBreakout(p, SECONDS[p.timeframe])
        df = strat.prepare(load(p.timeframe), load("D1"))
        ref = backtest.run(strat, df, POINT, SECONDS[p.timeframe])
        mine = engine.run(df, p, SECONDS[p.timeframe], point=POINT)
        same = len(ref) == len(mine) and np.allclose(ref.pnl, mine.pnl) and np.allclose(ref.pnl_usd, mine.pnl_usd)
        print(f"{key}: backtest.run {len(ref)} trades, engine {len(mine)} trades, identical: {same}")
    # and the research class with default params == the live strategy class
    live = strategy.create("orb", 1800)
    ref = backtest.run(live, live.prepare(load("M30"), load("D1")), POINT, 1800)
    mine, _ = replay(A0, "all")
    print(f"live SessionBreakout {len(ref)} trades vs research A0 {len(mine)}: identical "
          f"{len(ref) == len(mine) and np.allclose(ref.pnl, mine.pnl)}")


def train_table():
    start, end = period("train")
    res, trades = {}, {}
    for key, p in variants().items():
        t, _ = replay(p, "train")
        trades[key] = t
        res[key] = metrics(t, start, end)
        print(f"  {key}: {res[key].get('trades')} trades, PF {res[key].get('pf')}", flush=True)
    return res, trades


def eligible(m):
    return m.get("trades", 0) >= 100 and m.get("pf", 0) >= 1.10


def stable(key, res):
    nb = neighbours(key)
    return all(res[n].get("pf", 0) >= 1.0 and abs(res[n].get("pf", 0) - res[key]["pf"]) <= 0.15 for n in nb)


def best_of(keys, res):
    """Rank rule: PF, then fewer losing years, then smaller drop (PF ties within 0.03)."""
    keys = sorted(keys, key=lambda k: -res[k]["pf"])
    if not keys:
        return []
    top = res[keys[0]]["pf"]
    tied = [k for k in keys if top - res[k]["pf"] <= 0.03]
    tied.sort(key=lambda k: (res[k]["losing_years"], -res[k]["worst_drop_%"]))
    return tied + [k for k in keys if k not in tied]


def build_f(res):
    """F from train results only (rules in the doc)."""
    filters = [k for k in res if k.split()[0] in ("B", "C")]
    fbest = best_of(filters, res)[0]
    exits = [k for k in res if k == "D1" or k.startswith("D2")]
    ebest = best_of(exits, res)[0]
    p = dict(variants()[fbest].__dict__)
    p.pop("name")
    if res[ebest]["pf"] > res["A0"]["pf"]:
        ex = variants()[ebest]
        p.update(exit=ex.exit, trail_mult=ex.trail_mult)
    fades = [k for k in res if k.startswith("E ")]
    target = variants()[best_of(fades, res)[0]].fade_target
    p.update(kind="combo", fade_target=target)
    params = Params(name=f"F = {fbest} + exit {p['exit']}"
                         f"{' m=' + format(p['trail_mult'], 'g') if p['exit'] == 'trail' else ''} + fade({target}) on filter-off days", **p)
    return params, fbest, ebest


def cmd_train():
    if os.path.exists(HOLDOUT_FILE):
        raise SystemExit("Holdout already evaluated; train selection is frozen.")
    res, trades = train_table()
    fparams, fbest, ebest = build_f(res)
    start, end = period("train")
    tf, _ = replay(fparams, "train")
    res["F"] = metrics(tf, start, end)
    trades["F"] = tf
    print(f"  F: {fparams.name}: {res['F'].get('trades')} trades, PF {res['F'].get('pf')}")

    table = pd.DataFrame([{"id": k, **{c: m.get(c) for c in ("trades", "per_week", "win_%", "pf", "total_R", "result_$",
                                                                "worst_drop_%", "losing_years", "years", "loss_streak", "over_limit")},
                           "eligible": eligible(m), "stable": stable(k, res) if eligible(m) else None}
                          for k, m in res.items()])
    print("\n## Train results (start - 2018-12-31)\n")
    print(md(table))

    ok = [k for k in res if eligible(res[k]) and stable(k, res)]
    ranked, picked, letters = best_of(ok, res), [], set()
    for k in ranked:
        letter = k.split()[0][0]
        if letter in letters:
            continue
        picked.append(k)
        letters.add(letter)
        if len(picked) == 3:
            break
    allv = {**variants(), "F": fparams}
    print(f"\nFinalists: {picked or 'none'}")
    for k in ["A0"] + picked:
        print(f"\n### Per year, train: {k}\n")
        print(md(per_year(trades[k])))
    with open(FINALISTS_FILE, "w") as f:
        json.dump({"frozen": pd.Timestamp.now(tz="UTC").isoformat(), "finalists": picked,
                   "params": {k: allv[k].__dict__ for k in ["A0"] + picked}, "F": fparams.__dict__,
                   "F_from": [fbest, ebest], "train": res}, f, indent=1, default=str)
    print(f"\nFrozen -> {FINALISTS_FILE}")


def perturbations(key, frozen):
    """+/-1 grid step versions of a finalist (for holdout reporting only)."""
    p = Params(**frozen["params"][key])
    parts = key.split()
    out = {}
    if parts[0] in GRIDS:
        out = {n: variants()[n] for n in neighbours(key) if n.split()[1] != parts[1] or n.split()[0] != parts[0]}
    elif parts[0] == "E":
        out = {n: variants()[n] for n in neighbours(key) if n.split()[2] == parts[2]}
    elif key == "F":
        fbest = frozen["F_from"][0]
        field, vals = GRIDS[fbest.split()[0]]
        k = vals.index(getattr(p, field))
        for j in (k - 1, k + 1):
            if 0 <= j < len(vals):
                out[f"F with {field}={vals[j]:g}"] = p.with_(**{field: vals[j]})
    return out


def random_direction(t, df, p, runs=1000, seed=7):
    sides = engine.both_sides(df, t, p, SECONDS[p.timeframe], point=POINT)
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, 2, size=(runs, len(t)))
    pnl = sides[np.arange(len(t)), pick, 0]  # runs x trades
    gains = np.where(pnl > 0, pnl, 0).sum(1)
    losses = -np.where(pnl <= 0, pnl, 0).sum(1)
    pfs = gains / np.maximum(losses, 1e-9)
    real = pf(t.pnl)
    return {"real_pf": round(real, 2), "random_median_pf": round(float(np.median(pfs)), 2),
            "random_p90_pf": round(float(np.quantile(pfs, 0.9)), 2),
            "percentile": round(100 * float((pfs < real).mean()), 1)}


def guarded(t):
    """Extra, not used for selection: the live bot's loss limits (loss_guard.py, config LOSS_*)
    applied to a trade list. Exact here because trades never overlap (one per session, closed by
    session end), so skipping one doesn't change the others."""
    import loss_guard
    keep, closes = [], []
    for k, x in enumerate(t.itertuples()):
        now = x.entry_time.timestamp()
        if loss_guard.pause(closes, now):
            continue
        keep.append(k)
        closes.append((x.exit_time.timestamp(), loss_guard.r_multiple(x.pnl, x.risk)))
    return t.iloc[keep].reset_index(drop=True)


def costs(t):
    """Diagnostic: result before the spread, and how big the spread is next to the stop."""
    g = t.assign(gross=t.pnl + t.spread, cost_r=t.spread / t.risk)
    return {"gross_pf": round(pf(g.gross), 2), "gross_R_per_trade": round(float((g.gross / g.risk).mean()), 3),
            "median_spread_$": round(float(g.spread.median()), 2), "median_stop_$": round(float(g.risk.median()), 2),
            "median_spread_in_R": round(float(g.cost_r.median()), 3)}


def cmd_costs():
    """Diagnostic for A0 on TRAIN only: per-year result before spread and spread size vs stop."""
    t, _ = replay(A0, "train")
    rows = [{"year": int(y), **costs(g)} for y, g in t.groupby(t.entry_time.dt.year)]
    print(md(pd.DataFrame(rows)))
    print("all train:", costs(t))


def cmd_holdout():
    if os.path.exists(HOLDOUT_FILE):
        print(open(HOLDOUT_FILE).read())
        raise SystemExit("Holdout already evaluated once (shown above). Not re-running.")
    frozen = json.load(open(FINALISTS_FILE))
    start, end = period("holdout")
    out = {"run": pd.Timestamp.now(tz="UTC").isoformat(), "rows": {}, "years": {}, "robust": {}}
    keys = ["A0"] + frozen["finalists"]
    for k in keys:
        p = Params(**frozen["params"][k])
        t, df = replay(p, "holdout")
        m = metrics(t, start, end)
        out["rows"][k] = m
        out["years"][k] = per_year(t).to_dict("records")
        out.setdefault("extra_loss_limits", {})[k] = metrics(guarded(t), start, end)
        out.setdefault("extra_costs", {})[k] = costs(t)
        if k == "A0":
            continue
        stress, _ = replay(p, "holdout", spread_mult=1.5)
        r = {"spread_x1.5": metrics(stress, start, end), "random": random_direction(t, df, p),
             "perturb": {n: metrics(replay(q, "holdout")[0], start, end) for n, q in perturbations(k, frozen).items()}}
        base_drop = out["rows"]["A0"]["worst_drop_%"]
        checks = {"pf>1.15": m["pf"] > 1.15, "drop better than A0": m["worst_drop_%"] > base_drop,
                  ">=80 trades": m["trades"] >= 80, "beats 90% random": r["random"]["percentile"] >= 90,
                  "spread+50% pf>1": r["spread_x1.5"].get("pf", 0) > 1.0}
        r["checks"] = checks
        r["verdict"] = "Robust" if all(checks.values()) else "Not robust"
        out["robust"][k] = r
    with open(HOLDOUT_FILE, "w") as f:
        json.dump(out, f, indent=1, default=str)
    print(json.dumps(out, indent=1, default=str))


def cmd_sanity():
    """Current live strategy on Dukascopy over the PAXG backtest's period, vs the PAXG result."""
    m30 = load("M30")
    lo, hi = pd.Timestamp("2020-08-28", tz="UTC"), m30["time"].iat[-1]
    t, df = replay(A0, "all")
    t = t[(t.entry_time >= lo) & (t.entry_time <= hi)].reset_index(drop=True)
    print("Dukascopy XAUUSD:", metrics(t, lo, hi))
    print(md(per_year(t)))
    paxg = os.path.join(DATA, "history_M30.parquet")
    if os.path.exists(paxg):
        m, d = pd.read_parquet(paxg), pd.read_parquet(os.path.join(DATA, "history_D1.parquet"))
        live = strategy.create("orb", 1800)
        pdf = live.prepare(m, d)
        pt = backtest.run(live, pdf, 0.01, 1800)
        pt["r"] = pt.pnl / (pt.entry - pt.sl).abs()
        print("Binance PAXG (cached):", metrics(pt, pdf["time"].iat[0], pdf["time"].iat[-1]))
        print(md(per_year(pt)))
        # same sessions traded?
        a = set(t.entry_time.dt.date)
        b = set(pt.entry_time.dt.date)
        both = a & b
        same_side = sum(1 for x in both if t[t.entry_time.dt.date == x].side.iat[0] == pt[pt.entry_time.dt.date == x].side.iat[0])
        print(f"sessions traded: Dukascopy {len(a)}, PAXG {len(b)}, both {len(both)} (same side {same_side})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["data", "verify", "train", "holdout", "sanity", "costs"])
    args = ap.parse_args()
    pd.set_option("display.width", 220)
    {"data": cmd_data, "verify": cmd_verify, "train": cmd_train, "holdout": cmd_holdout, "sanity": cmd_sanity, "costs": cmd_costs}[args.cmd]()


if __name__ == "__main__":
    main()
