"""Replay the live strategy over years of history and put every trade on the website's Performance page.

    python publish_backtest.py              # as many years as the free price history has (about 5)
    python publish_backtest.py --bars 20000 # a shorter period
    python publish_backtest.py --dry-run    # print the summary only, don't send

Uses exactly the settings in config.py (strategy, timeframe, sessions, risk reward), the same code as
backtest.py, and PAXG candles from the free feed. Each trade is saved with its entry, stop and target,
so the website can size it for each visitor's own balance and risk. Run it again after changing the
strategy settings; the page shows when it was last run.
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()

import backtest
import binance_feed as feed
import config
import strategy

ROW_ID = "backtest"


def replay(bars):
    seconds = feed.candle_seconds(config.TIMEFRAME)
    strat = strategy.create(config.STRATEGY, seconds)
    daily = feed.get_bars(config.BINANCE_SYMBOL, "D1", max(bars // 20, 400))
    df = strat.prepare(feed.get_bars(config.BINANCE_SYMBOL, config.TIMEFRAME, bars), daily)
    return strat, df, backtest.run(strat, df, feed.POINT, seconds)


def as_row(strat, df, trades):
    ts = lambda t: int(t.timestamp())  # noqa: E731
    return {
        "generated": int(time.time()),
        "strategy": {"id": config.STRATEGY, "name": strat.name, "summary": strat.summary},
        "timeframe": config.TIMEFRAME,
        "from": ts(df["time"].iat[0]),
        "to": ts(df["time"].iat[-1]),
        "spread": config.BACKTEST_MIN_SPREAD,
        "source": "PAXG candles (free feed), every trade pays the spread; no news pause",
        "trades": [
            {"t": ts(r.entry_time), "x": ts(r.exit_time), "side": r.side, "entry": round(float(r.entry), 2),
             "sl": round(float(r.sl), 2), "tp": round(float(r.tp), 2), "exit": round(float(r.exit), 2),
             "pnl": round(float(r.pnl), 3), "reason": r.reason}
            for r in trades.itertuples()
        ],
    }


def send(row):
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not (url and key):
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env to publish.")
    headers = {"apikey": key, "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    body = {"id": ROW_ID, "data": row, "updated_at": datetime.now(timezone.utc).isoformat()}
    r = requests.post(f"{url}/rest/v1/bot_state", headers=headers, data=json.dumps(body), timeout=30)
    if r.status_code >= 300:
        raise SystemExit(f"Supabase answered {r.status_code}: {r.text[:200]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", type=int, default=100_000, help="candles of history (capped by what exists)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    feed.connect()
    strat, df, trades = replay(args.bars)
    if trades.empty:
        raise SystemExit("No trades in this period; nothing to publish.")
    summary = backtest.summarize(trades, df, f"{strat.name} {config.TIMEFRAME}")
    print(f"{df['time'].iat[0]:%Y-%m-%d} to {df['time'].iat[-1]:%Y-%m-%d}")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    if args.dry_run:
        return
    send(as_row(strat, df, trades))
    print(f"Published {len(trades)} trades to the website's Performance page.")


if __name__ == "__main__":
    main()
