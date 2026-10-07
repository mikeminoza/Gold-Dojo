"""Three more gold ideas, tested the same strict way as Daily trend (costs included; train 2003-2018,
unseen 2019-2026; neighbouring settings shown so one lucky setting can't pass alone).

3) Dip buy in an uptrend (RSI-2): close above the 200-day average and 2-day RSI below X -> buy at the
   next open; sell at the next open after a close above the 5-day average. Optional stop k x ATR20.
4) 52-week breakout on weekly candles: a weekly close above the previous 52 weeks' high -> buy at the
   next week's open; stop and trail k x ATR20 (weekly).
5) Breakout after a quiet period: a daily close above the previous N days' high, and within the last 5
   days the 10-day range was the narrowest of the past 63 days -> buy at the next open; stop and trail
   2 x ATR20 (as Daily trend).

R = result / (k x ATR at entry); for RSI-2 without a stop, R uses 2 x ATR as the risk unit.
Run: .venv/Scripts/python -m research.swing3
"""
import numpy as np
import pandas as pd

from research.h4_drift import SPLIT, stats

SPREAD, SLIP, SWAP = 0.50, 0.20, 0.0002
D1 = "data/xauusd_D1.parquet"


def atr(d, n=20):
    prev = d["close"].shift()
    tr = np.maximum(d["high"] - d["low"], np.maximum((d["high"] - prev).abs(), (d["low"] - prev).abs()))
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def rsi(close, n=2):
    delta = close.diff()
    up = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    down = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / down.replace(0, np.nan))


def run(d, entry, k=2.0, trail=True, exit_sig=None, use_stop=True, unit_k=None):
    """Long-only engine: enter at the next open after entry[i]; stop k x ATR (trailed if trail);
    exit at the next open after exit_sig[i]. Returns closed trades with R after costs."""
    o, h, lo = d["open"].to_numpy(), d["high"].to_numpy(), d["low"].to_numpy()
    a = d["atr"].to_numpy()
    t = d["time"]
    out, pos, pending, leave = [], None, False, False
    for i in range(1, len(d)):
        if pos is not None and leave:
            out.append(_close(pos, o[i], t.iat[i]))
            pos, leave = None, False
        if pos is None and pending:
            dist = k * a[i - 1]
            unit = (unit_k or k) * a[i - 1]
            pos = {"entry": o[i], "stop": o[i] - dist if use_stop else -np.inf, "unit": unit, "best": o[i],
                   "opened": t.iat[i]}
        pending = False
        if pos is not None:
            if use_stop and t.iat[i] > pos["opened"] and o[i] <= pos["stop"]:
                out.append(_close(pos, o[i], t.iat[i]))
                pos = None
            elif use_stop and lo[i] <= pos["stop"]:
                out.append(_close(pos, pos["stop"], t.iat[i]))
                pos = None
            else:
                pos["best"] = max(pos["best"], h[i])
                if trail and use_stop:
                    pos["stop"] = max(pos["stop"], pos["best"] - k * a[i])
                if exit_sig is not None and exit_sig[i]:
                    leave = True
        if pos is None and entry[i]:
            pending = True
    return pd.DataFrame(out)


def _close(pos, px, when):
    nights = max(0, (when.normalize() - pos["opened"].normalize()).days)
    net = px - pos["entry"] - SPREAD - 2 * SLIP - SWAP * pos["entry"] * nights
    return {"opened": pos["opened"], "closed": when, "r": net / pos["unit"], "nights": nights}


def split_rows(trades, name):
    if trades.empty:
        return [{"name": name, "set": "all", "trades": 0}]
    tr, te = trades[trades["opened"] < SPLIT], trades[trades["opened"] >= SPLIT]
    years = trades.groupby(trades["closed"].dt.year)["r"].sum()
    a, b = dict(stats(tr, "train 2003-18"), name=name), dict(stats(te, "unseen 2019-26"), name=name)
    b["profitable_years"] = f"{(years > 0).sum()}/{len(years)}"
    b["avg_nights"] = round(trades["nights"].mean(), 1)
    return [a, b]


def main():
    pd.set_option("display.width", 220)
    d = pd.read_parquet(D1)[["time", "open", "high", "low", "close"]].sort_values("time").reset_index(drop=True)
    d["atr"] = atr(d)
    c = d["close"]
    sma200, sma5, r2 = c.rolling(200).mean(), c.rolling(5).mean(), rsi(c, 2)
    rows = []

    # 3) RSI-2 dip buy in an uptrend
    for x in (5, 10, 15):
        entry = ((c > sma200) & (r2 < x)).to_numpy()
        exit_sig = (c > sma5).to_numpy()
        rows += split_rows(run(d, entry, exit_sig=exit_sig, use_stop=False, unit_k=2.0), f"3 RSI2<{x} no stop")
        rows += split_rows(run(d, entry, k=3.0, trail=False, exit_sig=exit_sig), f"3 RSI2<{x} stop 3ATR")

    # 4) 52-week breakout, weekly candles
    w = (d.set_index("time").resample("W-FRI")
         .agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna().reset_index())
    w["atr"] = atr(w)
    for weeks in (26, 52):
        hh = w["high"].shift(1).rolling(weeks).max()
        entry = (w["close"] > hh).to_numpy()
        for k in (2.0, 3.0):
            rows += split_rows(run(w, entry, k=k), f"4 {weeks}-week high k={k:g}")

    # 5) breakout after a quiet period
    rng10 = d["high"].rolling(10).max() - d["low"].rolling(10).min()
    quiet = (rng10 <= rng10.rolling(63).min()).rolling(5).max().astype(bool)
    for n in (20, 50, 100):
        hh = d["high"].shift(1).rolling(n).max()
        rows += split_rows(run(d, ((c > hh) & quiet).to_numpy(), k=2.0), f"5 {n}-day breakout after quiet")
        if n == 100:
            rows += split_rows(run(d, (c > hh).to_numpy(), k=2.0), "  (reference: 100-day breakout, no filter)")

    cols = ["name", "set", "trades", "per_year", "win%", "PF", "total_R", "avg_R", "max_dd_R", "profitable_years",
            "avg_nights"]
    print(pd.DataFrame(rows).reindex(columns=cols).to_string(index=False))


if __name__ == "__main__":
    main()
