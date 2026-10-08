"""Adding to winners (pyramiding) and a combined risk cap, for all three live trend rules together.

Rules exactly as live (trend_daily.py): 100-day breakout + trend pullback on daily candles, 4-hour
breakout on 4-hour candles; entry at the next open, k x ATR20 stop trailed under the highest high.

Variants (all compounded on one account, results after costs):
  A  current: 1% risk per trade, no cap
  B  pyramid: + a 0.5% add at +1 x ATR and another at +2 x ATR above the entry (ATR at entry); each
     add sized to its own distance from the shared trailing stop at that moment
  C  pyramid + cap: B, but no entry / add that would take total open risk above 3%
  D  cap only: A with the 3% cap
Open risk = the planned risk % of every open unit (entries 1%, adds 0.5%).
Run: .venv/Scripts/python -m research.pyramid
"""
import numpy as np
import pandas as pd

import trend_daily
from publish_trend_backtest import load_h4
from research.h4_drift import SPLIT

SPREAD, SLIP, SWAP = trend_daily.SPREAD, trend_daily.SLIPPAGE, trend_daily.SWAP_PER_NIGHT
BASE, ADD = 1.0, 0.5   # risk % of the first unit and of each add
CAP = 3.0


def units_for(rule, bars, pyramid):
    """Every trade of one rule as a list of units: {open_t, price, stop, close_t, exit, risk_pct, trade}."""
    d = trend_daily.prepare(bars)
    k = trend_daily.STOP[rule]
    o, h, lo = (d[c].to_numpy() for c in ("open", "high", "low"))
    atr, t = d["atr"].to_numpy(), d["time"]
    out, pos, pending, n = [], None, False, 0
    for i in range(1, len(d)):
        if pos is None and pending:
            dist = k * atr[i - 1]
            n += 1
            pos = {"stop": o[i] - dist, "best": o[i], "entry": o[i], "atr": atr[i - 1], "adds": 0,
                   "units": [{"open_t": t.iat[i], "price": o[i], "stop": o[i] - dist, "risk_pct": BASE,
                              "trade": f"{rule}-{n}", "kind": "entry"}]}
        pending = False
        if pos is not None:
            exit_px = None
            if t.iat[i] > pos["units"][0]["open_t"] and o[i] <= pos["stop"]:
                exit_px = o[i]
            elif lo[i] <= pos["stop"]:
                exit_px = pos["stop"]
            if exit_px is not None:
                for u in pos["units"]:
                    u.update(close_t=t.iat[i], exit=exit_px)
                    out.append(u)
                pos = None
            else:
                # adds fill intrabar at their level, if the high reaches it (and it's above the stop)
                while pyramid and pos["adds"] < 2:
                    level = pos["entry"] + (pos["adds"] + 1) * pos["atr"]
                    if h[i] < level or level <= pos["stop"]:
                        break
                    pos["adds"] += 1
                    pos["units"].append({"open_t": t.iat[i], "price": level, "stop": pos["stop"],
                                         "risk_pct": ADD, "trade": pos["units"][0]["trade"], "kind": "add"})
                pos["best"] = max(pos["best"], h[i])
                pos["stop"] = max(pos["stop"], pos["best"] - k * atr[i])
        if pos is None and trend_daily.signal(rule, d, i):
            pending = True
    return out


def unit_return(u):
    """Account % made by one unit: risk % x its R after costs."""
    nights = max(0, (u["close_t"].normalize() - u["open_t"].normalize()).days)
    risk = u["price"] - u["stop"]
    net = u["exit"] - u["price"] - SPREAD - 2 * SLIP - SWAP * u["price"] * nights
    return u["risk_pct"] * net / risk


def simulate(units, cap=None):
    """Chronological pass with the optional cap; returns accepted units with their % results."""
    units = sorted(units, key=lambda u: (u["open_t"], u["kind"] != "entry"))
    open_, accepted, taken = [], [], set()
    for u in units:
        open_ = [x for x in open_ if x["close_t"] > u["open_t"]]
        if u["kind"] == "add" and u["trade"] not in taken:
            continue
        if cap is not None and sum(x["risk_pct"] for x in open_) + u["risk_pct"] > cap + 1e-9:
            continue
        taken.add(u["trade"])
        open_.append(u)
        accepted.append({**u, "ret": unit_return(u)})
    return pd.DataFrame(accepted)


def metrics(acc, label, years):
    if acc.empty:
        return {"set": label}
    acc = acc.sort_values("close_t")
    eq = 100 * np.cumprod(1 + acc["ret"].to_numpy() / 100)
    peak = np.maximum.accumulate(np.r_[100, eq])[1:]
    worst = float(((eq - peak) / peak).min() * 100)
    cagr = 100 * ((eq[-1] / 100) ** (1 / years) - 1)
    trades = acc[acc["kind"] == "entry"]
    return {"set": label, "trades": len(trades), "adds": int((acc["kind"] == "add").sum()),
            "CAGR%": round(cagr, 2), "worst_drop%": round(worst, 1),
            "CAGR/drop": round(cagr / max(0.1, -worst), 2), "end_x": round(eq[-1] / 100, 2)}


def main():
    pd.set_option("display.width", 200)
    d1 = pd.read_parquet("data/xauusd_D1.parquet")[["time", "open", "high", "low", "close"]] \
        .sort_values("time").reset_index(drop=True)
    h4 = load_h4()
    rows = []
    for name, pyramid, cap in (("A current", False, None), ("B pyramid", True, None),
                               ("C pyramid + 3% cap", True, CAP), ("D 3% cap only", False, CAP)):
        units = (units_for("breakout", d1, pyramid) + units_for("pullback", d1, pyramid)
                 + units_for("h4breakout", h4, pyramid))
        acc = simulate(units, cap)
        tr = acc[acc["open_t"] < SPLIT]
        te = acc[acc["open_t"] >= SPLIT]
        for part, label, yrs in ((tr, "train 2003-18", 15.7), (te, "unseen 2019-26", 7.75), (acc, "all", 23.4)):
            rows.append({"variant": name, **metrics(part, label, yrs)})
    print(pd.DataFrame(rows).to_string(index=False))


if __name__ == "__main__":
    main()
