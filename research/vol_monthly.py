"""Two follow-up tests, same rules as research/h4_drift.py (costs included, train 2003-2018 / unseen 2019-2026).

4) Volatility-targeted sizing for the trend rules: risk per trade = 1% x (median ATR% over the past
   year / today's ATR%), capped 0.5%-2%. Calm market -> bigger, wild market -> smaller. Compared with a
   fixed 1% on the same trades (compounded account, start 100).
6) Monthly trend filter: hold gold while the month-end close is above its 10-month average, else cash.
   Switch at the next month's first open; costs $0.90/oz per round trip + 0.02%/night financing.
   Compared with buy and hold.
Run: .venv/Scripts/python -m research.vol_monthly
"""
import numpy as np
import pandas as pd

import trend_daily
from research.h4_drift import SPLIT, h4, load_h1

D1 = "data/xauusd_D1.parquet"
SWAP_MONTH = 0.0002 * 30  # CFD financing for a month held (0 = physical gold / ETF-like)


def atr_pct(d):
    prev = d["close"].shift()
    tr = np.maximum(d["high"] - d["low"], np.maximum((d["high"] - prev).abs(), (d["low"] - prev).abs()))
    return tr.ewm(alpha=1 / 20, adjust=False).mean() / d["close"]


def equity(trades, scale):
    """Compounded account: each trade risks base 1% x scale (capped), result = risk x R."""
    eq, peak, worst, curve = 100.0, 100.0, 0.0, []
    for (r, s) in zip(trades["r"], scale):
        eq *= 1 + 0.01 * s * r
        peak = max(peak, eq)
        worst = min(worst, eq / peak - 1)
        curve.append(eq)
    return eq, worst, curve


def cagr(end, years):
    return 100 * ((end / 100) ** (1 / years) - 1)


def vol_test(name, bars, rules):
    d = bars.reset_index(drop=True).copy()
    d["atrp"] = atr_pct(d)
    per_year = 252 if name == "Daily" else 252 * 6
    d["base"] = d["atrp"].rolling(per_year, min_periods=per_year // 2).median()
    t_index = {int(t.timestamp()): i for i, t in enumerate(d["time"])}
    out = []
    for rule, trades in trend_daily.replay(d[["time", "open", "high", "low", "close"]], rules).items():
        t = pd.DataFrame(trades)
        if t.empty:
            continue
        # sizing uses the candle before entry (known at the time)
        i = np.array([max(0, t_index.get(o, 0) - 1) for o in t["opened"]])
        ratio = (d["base"].to_numpy()[i] / d["atrp"].to_numpy()[i])
        scale = np.clip(np.nan_to_num(ratio, nan=1.0), 0.5, 2.0)
        opened = pd.to_datetime(t["opened"], unit="s", utc=True)
        for label, mask in (("train 2003-18", opened < SPLIT), ("unseen 2019-26", opened >= SPLIT)):
            tt, ss = t[mask.to_numpy()], scale[mask.to_numpy()]
            yrs = 16 if label.startswith("train") else 7.75
            e1, w1, _ = equity(tt, np.ones(len(tt)))
            e2, w2, _ = equity(tt, ss)
            out.append({"rule": f"{name} {trend_daily.NAMES[rule]}", "set": label, "trades": len(tt),
                        "fixed CAGR%": round(cagr(e1, yrs), 1), "fixed worst%": round(100 * w1, 1),
                        "vol CAGR%": round(cagr(e2, yrs), 1), "vol worst%": round(100 * w2, 1),
                        "fixed ret/dd": round(cagr(e1, yrs) / max(1e-9, -100 * w1), 2),
                        "vol ret/dd": round(cagr(e2, yrs) / max(1e-9, -100 * w2), 2),
                        "avg size": round(float(ss.mean()), 2)})
    return out


def monthly_test(d1):
    d = d1.set_index("time")
    m = d["close"].resample("ME").last().dropna()
    first_open = d["open"].resample("MS").first()
    sma = m.rolling(10).mean()
    hold_next = (m > sma).shift(1)  # decided at the previous month-end
    rows = []
    for label, lo, hi in (("train 2003-18", "2004-03", "2018-12"), ("unseen 2019-26", "2019-01", "2026-09"),
                          ("all", "2004-03", "2026-09")):
        months = m.loc[lo:hi].index
        eq, peak, worst, prev_in, switches = 100.0, 100.0, 0.0, False, 0
        bh, bpeak, bworst = 100.0, 100.0, 0.0
        for me in months:
            ms = pd.Timestamp(me.year, me.month, 1, tz="UTC")
            o = first_open.get(ms, np.nan)
            c = m[me]
            if not np.isfinite(o):
                continue
            ret = c / o - 1
            prev_c = m.shift(1).get(me, np.nan)
            month_ret = c / prev_c - 1 if np.isfinite(prev_c) else ret
            bh *= 1 + month_ret
            bpeak, bworst = max(bpeak, bh), min(bworst, bh / max(bpeak, bh) - 1)
            inside = bool(hold_next.get(me, False))
            if inside:
                cost = 0.0
                if not prev_in:
                    cost += 0.90 / o  # round trip charged on entry
                    switches += 1
                # held from this month's open (on entry) or the previous close (staying in)
                r = (c / o - 1) if not prev_in else month_ret
                eq *= 1 + r - cost - SWAP_MONTH
            prev_in = inside
            peak = max(peak, eq)
            worst = min(worst, eq / peak - 1)
        yrs = len(months) / 12
        rows.append({"set": label, "years": round(yrs, 1), "filter CAGR%": round(cagr(eq, yrs), 1),
                     "filter worst%": round(100 * worst, 1), "hold CAGR%": round(cagr(bh, yrs), 1),
                     "hold worst%": round(100 * bworst, 1), "entries": switches})
    return rows


def main():
    pd.set_option("display.width", 220)
    d1 = pd.read_parquet(D1)[["time", "open", "high", "low", "close"]].sort_values("time").reset_index(drop=True)
    rows = vol_test("Daily", d1, trend_daily.RULES) + vol_test("4-hour", h4(load_h1()), trend_daily.H4_RULES)
    print("4) Volatility-targeted sizing (compounded, 1% base risk)")
    print(pd.DataFrame(rows).to_string(index=False))
    print("\n6) Monthly trend filter (10-month average) vs buy and hold")
    print(pd.DataFrame(monthly_test(d1)).to_string(index=False))


if __name__ == "__main__":
    main()
