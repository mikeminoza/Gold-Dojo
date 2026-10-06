"""Re-test the New York strategy on the bot's own recorded real XAUUSD prices (market_minutes).

    python retest_recorded.py

Those minutes are data no study has seen, with the real spread at every moment, so this is the
honest check of whether live conditions match the backtests. It needs time: a few months of
recording before the numbers mean much (it says how much it has). Daily trend needs a year or more
of recorded days, so it's left to its own forward test.
"""
import os

import pandas as pd
import requests
from dotenv import load_dotenv

import backtest
import config
import strategy
import xauusd_feed

load_dotenv()


def load_minutes():
    url, key = os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SECRET_KEY", "")
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    rows, since = [], "1970-01-01T00:00:00Z"
    while True:
        r = requests.get(f"{url}/rest/v1/market_minutes", headers=headers, timeout=30,
                         params={"minute": f"gt.{since}", "order": "minute", "limit": 1000, "select": "*"})
        r.raise_for_status()
        batch = r.json()
        rows += batch
        if len(batch) < 1000:
            return pd.DataFrame(rows)
        since = batch[-1]["minute"]


def m30(minutes):
    m = minutes.copy()
    m["time"] = pd.to_datetime(m["minute"], utc=True)
    half = m["spread_avg"] / 2
    m["open"], m["high"], m["low"], m["close"] = (m["bid_open"] + half, m["bid_high"] + half,
                                                   m["bid_low"] + half, m["bid_close"] + half)
    g = m.set_index("time").resample("30min")
    bars = pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(),
                         "close": g["close"].last(), "tick_volume": g["ticks"].sum(),
                         "spread": g["spread_avg"].median(), "minutes": g["open"].count()})
    return bars[bars["minutes"] >= 24].reset_index()  # well-covered candles only


def main():
    minutes = load_minutes()
    if minutes.empty:
        print("No recorded minutes yet: run supabase/market-data.sql and let the bot record for a while.")
        return
    bars = m30(minutes)
    days = bars["time"].dt.date.nunique()
    print(f"Recorded: {len(minutes):,} minutes -> {len(bars):,} M30 candles over {days} trading days "
          f"({bars['time'].iat[0]:%Y-%m-%d} to {bars['time'].iat[-1]:%Y-%m-%d}); "
          f"median spread ${bars['spread'].median():.2f}")
    xauusd_feed.connect()
    daily = xauusd_feed.get_bars("XAUUSD", "D1", 260)  # trend filter: daily closes (PAXG adjusted to spot)
    strat = strategy.create(config.STRATEGY, 1800)
    df = strat.prepare(bars, daily)
    trades = backtest.run(strat, df, 1.0, 1800)  # spread is in $ already: point = 1
    if trades.empty:
        print("No New York trades in the recorded period yet.")
        return
    s = backtest.summarize(trades, df, f"{strat.name} {config.TIMEFRAME} on recorded real prices")
    for k, v in s.items():
        print(f"  {k}: {v}")
    if s["trades"] < 30:
        print(f"\nOnly {s['trades']} trades: too few to judge. Re-run after more months of recording.")


if __name__ == "__main__":
    main()
