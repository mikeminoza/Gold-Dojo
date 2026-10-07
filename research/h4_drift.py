"""Two candidate strategies, tested the same strict way as Daily trend (docs/swing-research.md).

A) 4-hour trend: Daily trend's two long-only rules (100-bar breakout, 20/50/200 pullback, 2 x ATR20
   chandelier trail) on 4-hour candles. Neighbouring settings are shown to check it isn't luck.
B) Time-of-day drift: pre-set windows (not picked from the data), every weekday:
   long through Asian hours (23:00-07:00 UTC), short through US hours (13:00-20:00 UTC).

Train 2003-2018, unseen 2019-2026. No peeking: signals use closed bars, entry at the next bar's
open. Costs: $0.50 spread + $0.20 slippage per fill, swap 0.02% of price per night held.
Run: .venv/Scripts/python -m research.h4_drift
"""
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPREAD, SLIP, SWAP = 0.50, 0.20, 0.0002
SPLIT = pd.Timestamp("2019-01-01", tz="UTC")


def load_h1():
    d = pd.read_parquet(os.path.join(ROOT, "data", "xauusd_H1.parquet"))
    d = d[d["minutes"] > 0]
    return d.set_index("time")[["open", "high", "low", "close"]]


def h4(h1):
    return h1.resample("4h", label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna().reset_index()


def stats(trades, label):
    if trades.empty:
        return {"set": label, "trades": 0}
    r = trades["r"]
    gross_win, gross_loss = r[r > 0].sum(), -r[r < 0].sum()
    eq = r.cumsum()
    years = (trades["closed"].max() - trades["opened"].min()).days / 365.25
    return {
        "set": label,
        "trades": len(r),
        "per_year": round(len(r) / max(years, 0.5), 1),
        "win%": round(100 * (r > 0).mean()),
        "PF": round(gross_win / gross_loss, 2) if gross_loss else np.inf,
        "total_R": round(r.sum(), 1),
        "avg_R": round(r.mean(), 3),
        "max_dd_R": round((eq - eq.cummax()).min(), 1),
    }


# ---------------------------------------------------------------- A) 4-hour trend

def trend_trades(d, rule, n=100, k=2.0):
    d = d.copy()
    prev = d["close"].shift()
    tr = np.maximum(d["high"] - d["low"], np.maximum((d["high"] - prev).abs(), (d["low"] - prev).abs()))
    d["atr"] = tr.ewm(alpha=1 / 20, adjust=False).mean()
    d["hh"] = d["high"].shift(1).rolling(n).max()
    d["sma50"], d["sma200"] = d["close"].rolling(50).mean(), d["close"].rolling(200).mean()
    d["ema20"] = d["close"].ewm(span=20, adjust=False).mean()
    o, h, lo, c = (d[x].to_numpy() for x in ("open", "high", "low", "close"))
    atr, hh, s50, s200, e20 = (d[x].to_numpy() for x in ("atr", "hh", "sma50", "sma200", "ema20"))
    t = d["time"]
    out, pos, pending = [], None, False
    for i in range(201, len(d)):
        if pos is None and pending:
            dist = k * atr[i - 1]
            pos = {"entry": o[i], "stop": o[i] - dist, "risk": dist, "best": o[i], "opened": t.iat[i]}
        pending = False
        if pos is not None:
            exit_px = None
            if t.iat[i] > pos["opened"] and o[i] <= pos["stop"]:
                exit_px = o[i]
            elif lo[i] <= pos["stop"]:
                exit_px = pos["stop"]
            if exit_px is not None:
                nights = max(0, (t.iat[i].normalize() - pos["opened"].normalize()).days)
                net = exit_px - pos["entry"] - SPREAD - 2 * SLIP - SWAP * pos["entry"] * nights
                out.append({"opened": pos["opened"], "closed": t.iat[i], "r": net / pos["risk"]})
                pos = None
            else:
                pos["best"] = max(pos["best"], h[i])
                pos["stop"] = max(pos["stop"], pos["best"] - k * atr[i])
        if pos is None:
            if rule == "breakout":
                pending = np.isfinite(hh[i]) and c[i] > hh[i]
            else:
                pending = s50[i] > s200[i] and c[i - 1] <= e20[i - 1] and c[i] > e20[i]
    return pd.DataFrame(out)


# ---------------------------------------------------------------- B) time-of-day drift

def drift_trades(h1, side, start, end):
    """One trade per weekday window [start, end) UTC hours (start > end wraps past midnight).
    Risk unit for R = that day's ATR14 of H1 bars x 3 (a typical stop), so R is comparable."""
    d = h1.copy()
    prev = d["close"].shift()
    tr = np.maximum(d["high"] - d["low"], np.maximum((d["high"] - prev).abs(), (d["low"] - prev).abs()))
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean().shift(1)  # known before the window opens
    hours = d.index.hour
    out = []
    starts = d.index[(hours == start) & (d.index.dayofweek < 5)]
    for ts in starts:
        length = (end - start) % 24
        stop_at = ts + pd.Timedelta(hours=length)
        win = d.loc[ts: stop_at - pd.Timedelta(minutes=1)]
        if len(win) < length * 0.75:
            continue  # holiday / missing data
        entry, exit_px = win["open"].iat[0], win["close"].iat[-1]
        move = (exit_px - entry) * (1 if side == "long" else -1)
        nights = 1 if stop_at.normalize() > ts.normalize() else 0
        net = move - SPREAD - 2 * SLIP - SWAP * entry * nights
        risk = 3 * atr.loc[ts]
        out.append({"opened": ts, "closed": win.index[-1], "r": net / risk, "gross": move, "net": net})
    return pd.DataFrame(out)


def split(trades, name):
    if trades.empty:
        return [stats(trades, name)]
    tr, te = trades[trades["opened"] < SPLIT], trades[trades["opened"] >= SPLIT]
    rows = [dict(stats(tr, "train 2003-18"), name=name), dict(stats(te, "unseen 2019-26"), name=name)]
    years = trades.groupby(trades["closed"].dt.year)["r"].sum()
    rows[1]["profitable_years"] = f"{(years > 0).sum()}/{len(years)}"
    return rows


def main():
    pd.set_option("display.width", 200)
    h1 = load_h1()
    d4 = h4(h1)
    rows = []
    for rule in ("breakout", "pullback"):
        for n in ((50, 100, 200) if rule == "breakout" else (100,)):
            for k in (2.0, 3.0):
                rows += split(trend_trades(d4, rule, n, k), f"H4 {rule}" + (f" N={n}" if rule == "breakout" else "") + f" k={k:g}")
    for side, a, b in (("long", 23, 7), ("short", 13, 20)):
        t = drift_trades(h1, side, a, b)
        rows += split(t, f"Drift {side} {a:02d}-{b:02d} UTC")
        if not t.empty:
            print(f"Drift {side}: avg gross ${t['gross'].mean():.2f}/oz, avg net ${t['net'].mean():.2f}/oz per trade "
                  f"(train gross ${t[t.opened < SPLIT]['gross'].mean():.2f}, unseen gross ${t[t.opened >= SPLIT]['gross'].mean():.2f})")
    cols = ["name", "set", "trades", "per_year", "win%", "PF", "total_R", "avg_R", "max_dd_R", "profitable_years"]
    print(pd.DataFrame(rows).reindex(columns=cols).to_string(index=False))


if __name__ == "__main__":
    main()
