"""Engine check on fake prices with no edge: a driftless random walk, zero spread, random entries.

    python -m research.null_test            # 12 independent walks of 2.5 years each

On a random walk every exit rule should average ~0 R. A clear non-zero average means the engine's
fill rules favour (or punish) that exit style, and its results on real data can't be trusted at face
value. Writes its fake candles to a temp folder, never to data/.
"""
import os
import sys
import tempfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import dukascopy, engine, run  # noqa: E402

KEYS = ("A0", "D1", "D2 0.5", "D2 1", "D2 1.5")


def main(seeds=range(10, 22)):
    tmp = tempfile.mkdtemp(prefix="null_test_")
    run.DATA = tmp
    rows = []
    for seed in seeds:
        rng = np.random.default_rng(seed)
        t = pd.date_range("2000-01-01", "2002-06-30", freq="1min", tz="UTC")
        p = 1200 * np.exp(np.cumsum(rng.normal(0, 0.0003, len(t))))
        m = pd.DataFrame({"time": t, "open": np.r_[p[0], p[:-1]], "close": p, "vol": 1.0, "spread": 0.0})
        m["high"], m["low"] = np.maximum(m.open, m.close), np.minimum(m.open, m.close)
        for name, rule in (("M30", "30min"), ("D1", "D1")):
            dukascopy.resample(m, rule).to_parquet(os.path.join(tmp, f"xauusd_{name}.parquet"))
        run.load.cache_clear()
        run.base.cache_clear()
        df = run.base("M30", False).copy()
        ok = ((df.phase == "trade") & df.range_hi.notna()).to_numpy()
        side = np.where(ok & (rng.random(len(df)) < 0.3), rng.choice([-1, 1], len(df)), 0)
        df["sig_side"], df["sig_stop"], df["sig_rr"], df["sig_tp"] = side, df.close - side * df.atr, 2.0, np.nan
        rows.append({k: engine.run(df, run.variants()[k], 1800, min_spread=0.0).r.mean() for k in KEYS})
        print(seed, {k: round(v, 3) for k, v in rows[-1].items()}, flush=True)
    d = pd.DataFrame(rows)
    se = d.std() / np.sqrt(len(d))
    print("\navg R per trade (should be ~0):")
    for k in KEYS:
        diff = d[k] - d["A0"]
        print(f"  {k:7s} {d[k].mean():+.4f} (se {se[k]:.4f});  minus A0 on the same entries {diff.mean():+.4f} "
              f"(se {diff.std() / np.sqrt(len(d)):.4f})")


if __name__ == "__main__":
    main()
