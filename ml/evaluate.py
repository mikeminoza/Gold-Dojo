"""Phase 2: does the "similar past trades" filter help? Walk-forward test on the trade memory.

    python -m ml.evaluate                 # needs data/trade_memory.parquet (python -m ml.build_memory)
    python -m ml.evaluate --shuffles 200 --randoms 5000

No peeking:
  * a test signal only sees trades whose exit candle is before its signal candle
  * the StandardScaler is fitted on those past trades only (refitted for every signal)
  * memory starts with the first 18 months; test blocks are the following 3-month steps

k-NN: k nearest past trades (Euclidean on standardised features), weighted 1/distance.
Take the signal if weighted win rate >= threshold and weighted average R > min_avg_r.
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest  # noqa: E402
import config  # noqa: E402
from ml.build_memory import MEMORY_FILE  # noqa: E402
from ml.features import FEATURES  # noqa: E402

INITIAL_MONTHS = 18
STEP_MONTHS = 3
K, MIN_WIN_RATE, MIN_AVG_R = 20, 0.50, 0.0


def blocks(memory):
    """[(start, end)] test windows: after the first 18 months, every 3 months to the end."""
    first = memory["entry_time"].min().normalize().replace(day=1)
    start = first + pd.DateOffset(months=INITIAL_MONTHS)
    last = memory["entry_time"].max()
    out = []
    while start <= last:
        end = start + pd.DateOffset(months=STEP_MONTHS)
        out.append((start, end))
        start = end
    return out


def knn_scores(memory, test_idx, k, outcomes=None):
    """Weighted neighbour win rate and avg R for each test trade, using only earlier-closed trades.
    `outcomes` = (won, r) arrays to use for the neighbours (lets the shuffle test swap them)."""
    X = memory[FEATURES].to_numpy(float)
    won, r = outcomes if outcomes is not None else (memory["won"].to_numpy(float), memory["r_multiple"].to_numpy(float))
    exit_t = memory["exit_time"].to_numpy()
    sig_t = memory["signal_time"].to_numpy()
    wr, ar = np.empty(len(test_idx)), np.empty(len(test_idx))
    for n, j in enumerate(test_idx):
        past = np.flatnonzero(exit_t < sig_t[j])
        scaler = StandardScaler().fit(X[past])
        d = np.linalg.norm(scaler.transform(X[past]) - scaler.transform(X[j:j + 1]), axis=1)
        near = np.argsort(d, kind="stable")[:k]
        w = 1 / (d[near] + 1e-6)
        wr[n] = np.sum(w * won[past][near]) / w.sum()
        ar[n] = np.sum(w * r[past][near]) / w.sum()
    return wr, ar


def stats(t):
    """Headline numbers for a set of trades (rows of the memory)."""
    if len(t) == 0:
        return {"trades": 0, "win_rate": np.nan, "pf": np.nan, "result": 0.0, "worst_drop": 0.0, "avg_r": np.nan}
    gains, losses = t.pnl[t.pnl > 0].sum(), -t.pnl[t.pnl <= 0].sum()
    return {
        "trades": len(t),
        "win_rate": 100 * t.won.mean(),
        "pf": gains / losses if losses > 0 else np.inf,
        "result": float(t.pnl_usd.sum()),
        "worst_drop": float(100 * backtest._drawdown(t.pnl_usd.reset_index(drop=True)) / config.ACCOUNT_BALANCE),
        "avg_r": float(t.r_multiple.mean()),
    }


def compare(test, take, block_of):
    """All vs filtered over the test blocks, plus per-block wins."""
    all_s, filt_s = stats(test), stats(test[take])
    beat_result = beat_pf_dd = 0
    per_block = []
    for b, grp in test.groupby(block_of):
        a, f = stats(grp), stats(grp[take[grp.index]])
        per_block.append({"block": b, "all_n": a["trades"], "filt_n": f["trades"],
                          "all_$": round(a["result"], 2), "filt_$": round(f["result"], 2),
                          "all_pf": round(a["pf"], 2), "filt_pf": round(f["pf"], 2),
                          "all_dd%": round(a["worst_drop"], 1), "filt_dd%": round(f["worst_drop"], 1)})
        beat_result += f["result"] > a["result"]
        beat_pf_dd += (np.nan_to_num(f["pf"], nan=0) > a["pf"]) and (f["worst_drop"] > a["worst_drop"])
    n = len(per_block)
    return all_s, filt_s, beat_result / n, beat_pf_dd / n, pd.DataFrame(per_block)


def fmt(s):
    return (f"{s['trades']:>4} trades, win {s['win_rate']:5.1f}%, PF {s['pf']:.2f}, avg R {s['avg_r']:+.3f}, "
            f"${s['result']:+8.2f}, worst drop {s['worst_drop']:+.1f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shuffles", type=int, default=100)
    ap.add_argument("--randoms", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    pd.set_option("display.width", 220)

    memory = pd.read_parquet(MEMORY_FILE).sort_values("entry_time").reset_index(drop=True)
    windows = blocks(memory)
    block_of = pd.Series(pd.NA, index=memory.index, dtype="object")
    for s, e in windows:
        block_of[(memory.entry_time >= s) & (memory.entry_time < e)] = f"{s:%Y-%m}"
    test_mask = block_of.notna()
    test = memory[test_mask]
    test_idx = np.flatnonzero(test_mask)
    block_of = block_of[test_mask]
    print(f"Memory: {len(memory)} trades {memory.entry_time.min():%Y-%m-%d} -> {memory.entry_time.max():%Y-%m-%d}")
    print(f"Test: {len(test)} trades in {len(windows)} blocks of {STEP_MONTHS} months, "
          f"{windows[0][0]:%Y-%m-%d} -> {memory.entry_time.max():%Y-%m-%d} "
          f"(first {INITIAL_MONTHS} months = memory only)\n")

    # --- main setting --------------------------------------------------------------------
    cache = {}
    for k in (10, 20, 40):
        cache[k] = knn_scores(memory, test_idx, k)

    def take_for(k, thr, scores=None):
        wr, ar = scores if scores is not None else cache[k]
        return pd.Series((wr >= thr) & (ar > MIN_AVG_R), index=test.index)

    take = take_for(K, MIN_WIN_RATE)
    all_s, filt_s, beat_r, beat_pfdd, per_block = compare(test, take, block_of)
    print(f"== k-NN k={K}, win rate >= {MIN_WIN_RATE}, avg R > {MIN_AVG_R} ==")
    print("All signals:", fmt(all_s))
    print("Filtered:   ", fmt(filt_s))
    print(f"Blocks where filtered $ beat all: {beat_r:.0%};  blocks with higher PF AND smaller drop: {beat_pfdd:.0%}")
    print(per_block.to_string(index=False))

    # --- robustness grid -----------------------------------------------------------------
    print("\n== Robustness grid (k x win-rate threshold) ==")
    grid = []
    for k in (10, 20, 40):
        for thr in (0.45, 0.50, 0.55):
            a, f, br, bpd, _ = compare(test, take_for(k, thr), block_of)
            grid.append({"k": k, "thr": thr, "taken": f["trades"], "win%": round(f["win_rate"], 1),
                         "pf": round(f["pf"], 2), "result_$": round(f["result"], 2),
                         "worst_drop%": round(f["worst_drop"], 1), "blocks_$_beat": f"{br:.0%}",
                         "blocks_pf&dd_beat": f"{bpd:.0%}"})
    grid = pd.DataFrame(grid)
    print(f"(all signals: {fmt(all_s)})")
    print(grid.to_string(index=False))

    # --- label shuffle -------------------------------------------------------------------
    print(f"\n== Label shuffle ({args.shuffles} runs, k={K}, thr={MIN_WIN_RATE}) ==")
    won0, r0 = memory["won"].to_numpy(float), memory["r_multiple"].to_numpy(float)
    sh = []
    for _ in range(args.shuffles):
        perm = rng.permutation(len(memory))  # shuffle outcomes (won and R together) across trades
        t = take_for(K, MIN_WIN_RATE, knn_scores(memory, test_idx, K, (won0[perm], r0[perm])))
        f = stats(test[t])
        sh.append({"taken": f["trades"], "pf": f["pf"], "result": f["result"], "worst_drop": f["worst_drop"]})
    sh = pd.DataFrame(sh)
    print(f"shuffled: taken median {sh.taken.median():.0f}, PF mean {sh.pf.mean():.2f} "
          f"(5-95%: {sh.pf.quantile(.05):.2f}-{sh.pf.quantile(.95):.2f}), result mean ${sh.result.mean():+.2f} "
          f"(5-95%: {sh.result.quantile(.05):+.2f} to {sh.result.quantile(.95):+.2f}), worst drop mean {sh.worst_drop.mean():+.1f}%")
    print(f"real filter: PF {filt_s['pf']:.2f}, result ${filt_s['result']:+.2f}; "
          f"share of shuffles with PF >= real: {(sh.pf >= filt_s['pf']).mean():.0%}, "
          f"result >= real: {(sh.result >= filt_s['result']).mean():.0%}")

    # --- random skip of the same count ---------------------------------------------------
    n_take = int(take.sum())
    print(f"\n== Random skip: keep {n_take} of {len(test)} test trades at random, {args.randoms} runs ==")
    rr = []
    for _ in range(args.randoms):
        pick = np.sort(rng.choice(len(test), n_take, replace=False))
        f = stats(test.iloc[pick])
        rr.append({"pf": f["pf"], "result": f["result"], "worst_drop": f["worst_drop"]})
    rr = pd.DataFrame(rr)
    pct = lambda col, v: 100 * (rr[col] < v).mean()
    print(f"random: PF median {rr.pf.median():.2f}, result median ${rr.result.median():+.2f}, "
          f"worst drop median {rr.worst_drop.median():+.1f}%")
    print(f"filter percentile vs random: PF {pct('pf', filt_s['pf']):.0f}th, result {pct('result', filt_s['result']):.0f}th, "
          f"worst drop (higher = smaller drop) {pct('worst_drop', filt_s['worst_drop']):.0f}th")

    # --- logistic regression comparison ---------------------------------------------------
    print("\n== Logistic regression (refit at each block start on trades closed before it) ==")
    X = memory[FEATURES].to_numpy(float)
    y = memory["won"].to_numpy(int)
    p = pd.Series(np.nan, index=test.index)
    base = pd.Series(np.nan, index=test.index)
    for s, e in windows:
        past = (memory.exit_time < s).to_numpy()
        idx = test.index[(test.entry_time >= s) & (test.entry_time < e)]
        if len(idx) == 0:
            continue
        sc = StandardScaler().fit(X[past])
        lr = LogisticRegression(C=1.0, max_iter=1000).fit(sc.transform(X[past]), y[past])
        p[idx] = lr.predict_proba(sc.transform(X[idx]))[:, 1]
        base[idx] = y[past].mean()
    def lr_probs(labels):
        out = pd.Series(np.nan, index=test.index)
        for s, e in windows:
            past = (memory.exit_time < s).to_numpy()
            idx = test.index[(test.entry_time >= s) & (test.entry_time < e)]
            if len(idx):
                sc_ = StandardScaler().fit(X[past])
                m = LogisticRegression(C=1.0, max_iter=1000).fit(sc_.transform(X[past]), labels[past])
                out[idx] = m.predict_proba(sc_.transform(X[idx]))[:, 1]
        return out

    for label, t, thr in (("p(win) >= 0.50", p >= 0.50, 0.50), ("p(win) >= 0.45", p >= 0.45, 0.45),
                          ("p(win) >= past win rate", p >= base, None)):
        a, f, br, bpd, _ = compare(test, t, block_of)
        print(f"{label:<26}", fmt(f), f"| blocks $ beat {br:.0%}, PF&DD beat {bpd:.0%}")
        # same sanity checks as k-NN: random skip of the same count, and shuffled labels
        n = int(t.sum())
        rnd = [stats(test.iloc[np.sort(rng.choice(len(test), n, replace=False))]) for _ in range(2000)]
        rnd_pf = np.array([s_["pf"] for s_ in rnd])
        rnd_res = np.array([s_["result"] for s_ in rnd])
        shuf = []
        for _ in range(min(args.shuffles, 50)):
            ps = lr_probs(y[rng.permutation(len(y))])
            shuf.append(stats(test[ps >= (thr if thr is not None else base)])["pf"])
        print(f"{'':<26} vs random skip of {n}: PF {100 * (rnd_pf < f['pf']).mean():.0f}th pct, "
              f"result {100 * (rnd_res < f['result']).mean():.0f}th pct; "
              f"shuffled labels: PF mean {np.nanmean(shuf):.2f}, share >= real {np.mean(np.array(shuf) >= f['pf']):.0%}")
    sc = StandardScaler().fit(X)
    lr = LogisticRegression(C=1.0, max_iter=1000).fit(sc.transform(X), y)
    coef = pd.Series(lr.coef_[0], index=FEATURES).sort_values(key=abs, ascending=False)
    print("Coefficients (all trades, standardised features; + = more likely to win):")
    print(coef.round(3).to_string())


if __name__ == "__main__":
    main()
