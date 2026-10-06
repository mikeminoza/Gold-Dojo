"""Replay Daily trend mode's two rules on 23 years of real XAUUSD (the Dukascopy data from the research)
and put the results, next to simply holding gold, on the website's Performance page.

    python publish_trend_backtest.py            # needs data/xauusd_D1.parquet (python -m research.dukascopy)
    python publish_trend_backtest.py --dry-run  # print only

Same rules and estimated costs as the live paper test (trend_daily.py). Results in R (1R = the trade's
starting risk). Run it again after changing trend_daily.py.
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

import trend_daily

load_dotenv()
DATA = Path(__file__).with_name("data") / "xauusd_D1.parquet"
ROW_ID = "daily_trend_backtest"


def stats(trades):
    rs = [t["r"] for t in trades]
    if not rs:
        return {"count": 0}
    won, lost = sum(r for r in rs if r > 0), -sum(r for r in rs if r < 0)
    eq, peak, drop = 0.0, 0.0, 0.0
    for r in rs:
        eq += r
        peak = max(peak, eq)
        drop = min(drop, eq - peak)
    years = {}
    for t in trades:
        y = datetime.fromtimestamp(t["closed"], timezone.utc).year
        years[y] = years.get(y, 0) + t["r"]
    return {"count": len(rs), "win_rate": round(100 * sum(r > 0 for r in rs) / len(rs)),
            "profit_factor": round(won / lost, 2) if lost else None, "total_r": round(sum(rs), 1),
            "worst_drop_r": round(drop, 1), "avg_nights": round(sum(t["nights"] for t in trades) / len(rs)),
            "years": {str(k): round(v, 1) for k, v in sorted(years.items())}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    d = pd.read_parquet(DATA)
    d = d[["time", "open", "high", "low", "close"]].sort_values("time").reset_index(drop=True)
    trades = trend_daily.replay(d)

    # Buy and hold: the gold price itself, month by month, with its worst fall from a high
    m = d.set_index("time")["close"].resample("ME").last().dropna()
    peak = m.cummax()
    hold = {"start": round(float(m.iloc[0]), 2), "end": round(float(m.iloc[-1]), 2),
            "return_pct": round(100 * (m.iloc[-1] / m.iloc[0] - 1)),
            "worst_drop_pct": round(float(100 * ((m - peak) / peak).min()), 1),
            "curve": [[int(t.timestamp()), round(float(v), 2)] for t, v in m.items()]}

    row = {"generated": int(time.time()), "from": int(d["time"].iat[0].timestamp()), "to": int(d["time"].iat[-1].timestamp()),
           "source": "Real XAUUSD daily candles (Dukascopy), estimated costs: $0.50 spread, $0.20 slippage per side, "
                     "0.02% financing per night",
           "rules": {r: {"name": trend_daily.RULES[r], "stats": stats(t),
                         "trades": [[t_["closed"], t_["r"]] for t_ in t]} for r, t in trades.items()},
           "hold": hold}
    for r, x in row["rules"].items():
        print(x["name"], {k: v for k, v in x["stats"].items() if k != "years"})
    print("Buy and hold:", {k: v for k, v in hold.items() if k != "curve"})
    if args.dry_run:
        return
    url, key = os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SECRET_KEY", "")
    headers = {"apikey": key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    body = {"id": ROW_ID, "data": row, "updated_at": datetime.now(timezone.utc).isoformat()}
    r = requests.post(f"{url}/rest/v1/bot_state", headers=headers, data=json.dumps(body), timeout=30)
    r.raise_for_status()
    print("Published to the website's Performance page.")


if __name__ == "__main__":
    main()
