"""Engine checks for docs/swing-research.md on FAKE prices (no XAUUSD data used).

    python -m research.swing_null

1. Null test: driftless random walks (M30 steps, a random gap at each day's open), resampled to H1
   and D1, zero costs. Every variant's average R per trade should be ~0; a clear positive value would
   mean the engine peeks or its fills favour a style.
2. No-peeking test: signals and trades computed on the full fake series vs on the series cut at a
   date must agree on everything before the cut.
3. Bookkeeping: daily marked-to-market $ sums to the trades' $; intraday resolution counts.
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import swing  # noqa: E402
from research.run_swing import grid  # noqa: E402


def fake(seed, years=20):
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2000-01-03", periods=260 * years, tz="UTC")
    n = len(days) * 48
    steps = rng.normal(0, 0.0015, n)
    steps[::48] += rng.normal(0, 0.003, len(days))  # overnight gap at each day's open
    logp = np.log(1000) + np.cumsum(steps)
    close = np.exp(logp)
    open_ = np.exp(logp - steps)
    wig = np.abs(rng.normal(0, 0.0007, (2, n)))
    high = np.maximum(open_, close) * np.exp(wig[0])
    low = np.minimum(open_, close) * np.exp(-wig[1])
    t = (days.repeat(48) + pd.to_timedelta(np.tile(np.arange(48) * 30, len(days)), unit="min"))
    m30 = pd.DataFrame({"time": t, "open": open_, "high": high, "low": low, "close": close, "spread": 0.0})

    def rs(rule):
        g = m30.groupby(m30["time"].dt.floor(rule))
        return pd.DataFrame({"time": g["time"].first().index, "open": g["open"].first().values,
                             "high": g["high"].max().values, "low": g["low"].min().values,
                             "close": g["close"].last().values, "spread": 0.0})
    return m30, rs("h"), rs("D")


def main(seeds=range(1, 41)):
    rows, counts = [], {}
    for seed in seeds:
        m30, h1, d1 = fake(seed)
        d = swing.indicators(d1)
        intr = swing.Intraday(h1, m30)
        row = {}
        for v in grid():
            t = swing.run(d, v, len(d) - 1, intraday=intr, slippage=0.0, swap=0.0, min_spread=0.0)
            row[v.key] = t.r.mean()
            if seed == seeds[0]:
                pnl = swing.daily_pnl(d, t, swap=0.0)
                assert abs(pnl.sum() - t.pnl_usd.sum()) < 1e-6, v.key
        counts = {k: counts.get(k, 0) + c for k, c in intr.counts.items()}
        rows.append(row)
        print(seed, f"mean over variants {np.mean(list(row.values())):+.3f} R", flush=True)
    r = pd.DataFrame(rows)
    se = r.std() / np.sqrt(len(r))
    print("\n| variant | avg R per trade | se |\n|---|---|---|")
    for k in r.columns:
        print(f"| {k} | {r[k].mean():+.3f} | {se[k]:.3f} |")
    print("\nintraday resolution counts (all seeds, S2 3R):", counts)
    print("daily marked-to-market $ == trade $ for every variant (seed 1): ok")

    # no-peeking: cut the fake series at row 3000
    m30, h1, d1 = fake(99)
    full = swing.indicators(d1)
    cut = swing.indicators(d1.iloc[:3000].reset_index(drop=True))
    ok = True
    for v in grid():
        a, b = swing.signals(full, v)[:2999], swing.signals(cut, v)[:2999]
        same_sig = np.array_equal(a, b)
        ta = swing.run(full, v, 2999, slippage=0.0, swap=0.0, min_spread=0.0)
        tb = swing.run(cut, v, 2999, slippage=0.0, swap=0.0, min_spread=0.0)
        same_tr = len(ta) == len(tb) and np.allclose(ta.r, tb.r)
        ok &= same_sig and same_tr
        if not (same_sig and same_tr):
            print("PEEK?", v.key, same_sig, same_tr)
    print("no-peeking check (signals + trades identical with the future removed):", "ok" if ok else "FAILED")
    resolver_check()


def resolver_check():
    """Stop 95 / target 110 on a long, one day: the intraday path decides, and a tie goes to the stop."""
    day = pd.Timestamp("2020-01-06", tz="UTC")
    h = pd.date_range(day, periods=3, freq="h")
    m = pd.date_range(day, periods=6, freq="30min")
    cases = {  # (H1 highs, H1 lows, M30 highs, M30 lows) -> expected
        "target first in H1": ([111, 100, 100], [99, 94, 99], [111] * 6, [99] * 6, "target", "H1"),
        "stop first in H1": ([101, 111, 100], [94, 99, 99], [101] * 6, [94] * 6, "stop", "H1"),
        "same H1, target first in M30": ([111, 100, 100], [94, 99, 99], [111, 100, 100, 100, 100, 100],
                                         [99, 94, 99, 99, 99, 99], "target", "M30"),
        "same M30 -> stop": ([111, 100, 100], [94, 99, 99], [111, 100] + [100] * 4, [94, 99] + [99] * 4, "stop", "stop-first"),
    }
    for name, (hh, hl, mh, ml, want, how) in cases.items():
        r = swing.Intraday(pd.DataFrame({"time": h, "high": hh, "low": hl}),
                           pd.DataFrame({"time": m, "high": mh, "low": ml}))
        got = r.first(day, 1, 95.0, 110.0)
        assert got == want and r.counts[how] == 1, (name, got, r.counts)
    print("intraday resolver unit cases: ok")


if __name__ == "__main__":
    main()
