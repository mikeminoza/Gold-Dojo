"""Designing a new gold strategy from the data without fooling ourselves.

What the 23 years taught us: on gold only trend-following survives costs. So the new design is a
trend ENSEMBLE: instead of one breakout level, 7 trend votes over different horizons, so no single
lookback has to be right:
    close above its 50 / 100 / 200-day average, and 20 / 60 / 120 / 250-day return above zero.
Score = votes (0-7). Buy at the next open when the score reaches ENTER after being below it; sell at the
next open when it drops to EXIT or below, or when a K x ATR20 chandelier stop is hit (whichever first).

Protocol (the important part):
  1. Choose ENTER / EXIT / K using ONLY 2003-2018 (small grid, ranked by return per unit of drawdown,
     requiring at least 40 trades).
  2. Run the chosen setting ONCE on 2019-2026 and report it, whatever it shows.
  3. Compare with the existing Daily trend breakout, with random entries (same hold times, 200 runs),
     and show how often the two strategies are in the market together.
Run: .venv/Scripts/python -m research.dojo_ensemble
"""
import numpy as np
import pandas as pd

import trend_daily
from research.h4_drift import SPLIT, stats
from research.swing3 import SLIP, SPREAD, SWAP, atr

D1 = "data/xauusd_D1.parquet"


def votes(d):
    c = d["close"]
    v = [c > c.rolling(n).mean() for n in (50, 100, 200)] + [c > c.shift(n) for n in (20, 60, 120, 250)]
    return sum(x.astype(int) for x in v)


def run(d, score, enter, exit_, k):
    o, h, lo = d["open"].to_numpy(), d["high"].to_numpy(), d["low"].to_numpy()
    a, sc, t = d["atr"].to_numpy(), score.to_numpy(), d["time"]
    out, pos, pending, leave = [], None, False, False
    for i in range(251, len(d)):
        if pos is not None and leave:
            out.append(close(pos, o[i], t.iat[i], "score"))
            pos, leave = None, False
        if pos is None and pending:
            dist = k * a[i - 1]
            pos = {"entry": o[i], "stop": o[i] - dist, "risk": dist, "best": o[i], "opened": t.iat[i], "i": i}
        pending = False
        if pos is not None:
            if t.iat[i] > pos["opened"] and o[i] <= pos["stop"]:
                out.append(close(pos, o[i], t.iat[i], "stop"))
                pos = None
            elif lo[i] <= pos["stop"]:
                out.append(close(pos, pos["stop"], t.iat[i], "stop"))
                pos = None
            else:
                pos["best"] = max(pos["best"], h[i])
                pos["stop"] = max(pos["stop"], pos["best"] - k * a[i])
                leave = sc[i] <= exit_
        if pos is None and sc[i] >= enter and sc[i - 1] < enter:
            pending = True
    return pd.DataFrame(out)


def close(pos, px, when, why):
    nights = max(0, (when.normalize() - pos["opened"].normalize()).days)
    net = px - pos["entry"] - SPREAD - 2 * SLIP - SWAP * pos["entry"] * nights
    return {"opened": pos["opened"], "closed": when, "r": net / pos["risk"], "nights": nights, "why": why,
            "i": pos["i"]}


def ret_dd(s):
    return s["total_R"] / max(0.5, -s["max_dd_R"]) if s.get("trades") else -np.inf


def random_null(d, trades, runs=200, seed=7):
    """Same number of trades and hold lengths, random start days, same costs: what luck alone makes."""
    rng = np.random.default_rng(seed)
    o, a = d["open"].to_numpy(), d["atr"].to_numpy()
    holds = np.maximum(1, trades["nights"].to_numpy() * 5 // 7)
    totals = []
    for _ in range(runs):
        tot = 0.0
        for hold in holds:
            i = rng.integers(251, len(d) - hold - 1)
            entry, exit_px = o[i], o[i + hold]
            nights = (d["time"].iat[i + hold] - d["time"].iat[i]).days
            risk = 3 * a[i - 1]
            tot += (exit_px - entry - SPREAD - 2 * SLIP - SWAP * entry * nights) / risk
        totals.append(tot)
    return np.array(totals)


def main():
    pd.set_option("display.width", 220)
    d = pd.read_parquet(D1)[["time", "open", "high", "low", "close"]].sort_values("time").reset_index(drop=True)
    d["atr"] = atr(d)
    score = votes(d)
    train_d = d[d["time"] < SPLIT].reset_index(drop=True)
    train_score = score[: len(train_d)].reset_index(drop=True)

    # 1) design on 2003-2018 only
    grid = []
    for enter in (5, 6, 7):
        for exit_ in (2, 3, 4):
            if exit_ >= enter:
                continue
            for k in (3.0, 4.0, 5.0):
                s = stats(run(train_d, train_score, enter, exit_, k), "train")
                grid.append({"enter": enter, "exit": exit_, "k": k, **s, "ret/dd": round(ret_dd(s), 2)})
    g = pd.DataFrame(grid)
    print("1) Design grid, 2003-2018 only")
    print(g[["enter", "exit", "k", "trades", "win%", "PF", "total_R", "max_dd_R", "ret/dd"]].to_string(index=False))
    ok = g[g["trades"] >= 40]
    best = ok.sort_values("ret/dd", ascending=False).iloc[0]
    print(f"\nChosen on 2003-2018: enter at {best.enter}/7, exit at {best.exit}/7 or below, stop {best.k:g} x ATR")
    profitable_share = (g["PF"] > 1).mean()
    print(f"Share of all {len(g)} grid settings profitable in 2003-2018: {100 * profitable_share:.0f}%")

    # 2) the one unseen test
    full = run(d, score, int(best.enter), int(best.exit), float(best.k))
    tr, te = full[full["opened"] < SPLIT], full[full["opened"] >= SPLIT]
    print("\n2) The chosen setting, train vs the one-time unseen test")
    rows = [stats(tr, "train 2003-18"), stats(te, "unseen 2019-26"), stats(full, "all")]
    years = full.groupby(full["closed"].dt.year)["r"].sum()
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"Profitable years: {(years > 0).sum()}/{len(years)}; average hold {full['nights'].mean():.0f} nights")

    # 3) comparisons
    null = random_null(d, full)
    print(f"\n3) Random entries, same holds and costs (200 runs): median {np.median(null):+.1f}R, "
          f"95th pct {np.percentile(null, 95):+.1f}R  vs  ensemble {full['r'].sum():+.1f}R "
          f"(beats {100 * (null < full['r'].sum()).mean():.0f}% of random runs)")
    dt = trend_daily.replay(d[["time", "open", "high", "low", "close"]])
    for rule, trades in dt.items():
        t = pd.DataFrame(trades)
        print(f"   Daily trend {trend_daily.NAMES[rule]}: {len(t)} trades, {t['r'].sum():+.1f}R")
    in_mkt = np.zeros(len(d), bool)
    for _, x in full.iterrows():
        in_mkt[(d["time"] >= x["opened"]) & (d["time"] < x["closed"])] = True
    bo = np.zeros(len(d), bool)
    for x in dt["breakout"]:
        o, c = (pd.Timestamp(x[k], unit="s", tz="UTC") for k in ("opened", "closed"))
        bo[(d["time"] >= o) & (d["time"] < c)] = True
    both = (in_mkt & bo).sum() / max(1, in_mkt.sum())
    print(f"   Time in the market: ensemble {100 * in_mkt.mean():.0f}% of days, 100-day breakout {100 * bo.mean():.0f}%; "
          f"when the ensemble is in, the breakout is too {100 * both:.0f}% of the time")


if __name__ == "__main__":
    main()
