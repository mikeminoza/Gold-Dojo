"""Phase 1: build the trade memory by replaying the live strategy on PAXG history.

    python -m ml.build_memory              # use cached history if present
    python -m ml.build_memory --refetch    # download history again

Writes data/history_M30.parquet, data/history_D1.parquet and data/trade_memory.parquet
(one row per replayed trade: times, features at the signal candle, outcome, source="backtest").
Research only: nothing here changes the live bot.
"""
import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest  # noqa: E402
import binance_feed  # noqa: E402
import config  # noqa: E402
import strategy  # noqa: E402
from ml.features import FEATURES, features  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
M30_FILE = os.path.join(DATA, "history_M30.parquet")
D1_FILE = os.path.join(DATA, "history_D1.parquet")
MEMORY_FILE = os.path.join(DATA, "trade_memory.parquet")

TIMEFRAME = "M30"
ALL_HISTORY = 400_000  # more candles than PAXG has ever had, so get_bars pages back to the listing
# First full year with steady volume (PAXG listed on Binance Sep 2020; see the volume table printed)
DEFAULT_START = "2021-01-01"


def history(refetch=False):
    os.makedirs(DATA, exist_ok=True)
    if refetch or not (os.path.exists(M30_FILE) and os.path.exists(D1_FILE)):
        print("Fetching PAXG history (all of it)...")
        m30 = binance_feed.get_bars(config.BINANCE_SYMBOL, TIMEFRAME, ALL_HISTORY)
        d1 = binance_feed.get_bars(config.BINANCE_SYMBOL, "D1", 20_000)
        m30.to_parquet(M30_FILE)
        d1.to_parquet(D1_FILE)
    return pd.read_parquet(M30_FILE), pd.read_parquet(D1_FILE)


def volume_by_year(m30):
    g = m30.groupby(m30["time"].dt.year)
    return pd.DataFrame({"first": g["time"].min(), "candles": g.size(),
                         "median_trades_per_candle": g["tick_volume"].median()})


def replay(m30, d1, start):
    """Same code path as the live bot / backtest.py. Indicators warm up on all history;
    trades are kept from `start`. Returns (memory, trades, df)."""
    seconds = binance_feed.candle_seconds(TIMEFRAME)
    strat = strategy.create(config.STRATEGY, seconds)  # fresh state (no sessions taken), like backtest.py
    df = strat.prepare(m30, d1)
    trades = backtest.run(strat, df, binance_feed.POINT, seconds)
    candle = pd.Timedelta(seconds=seconds)

    index_of = pd.Series(df.index, index=df["time"])
    rows = []
    for t in trades.itertuples(index=False):
        i = int(index_of[t.entry_time - candle])  # the signal candle (entry = its close / next open)
        risk = abs(t.entry - t.sl)
        rows.append({
            "signal_time": df["time"].iat[i],
            "entry_time": t.entry_time,
            "exit_time": t.exit_time,
            "session": df["sess"].iat[i],
            "side_name": t.side,
            **features(df, i, t.side, seconds, strat.clock),
            "entry": t.entry, "sl": t.sl, "tp": t.tp, "exit": t.exit, "lots": t.lots,
            "pnl": t.pnl, "pnl_usd": t.pnl_usd,
            "won": int(t.pnl > 0),
            "r_multiple": t.pnl / risk,
            "exit_reason": t.reason,
            # exit_time is the open of the candle the exit happened in; count that candle in full
            "hold_minutes": (t.exit_time + candle - t.entry_time).total_seconds() / 60,
            "verdict": t.verdict,
            "source": "backtest",
        })
    memory = pd.DataFrame(rows)
    keep = memory["entry_time"] >= pd.Timestamp(start, tz="UTC")
    return memory[keep].reset_index(drop=True), trades[trades["entry_time"] >= pd.Timestamp(start, tz="UTC")].reset_index(drop=True), df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true")
    ap.add_argument("--start", default=DEFAULT_START)
    args = ap.parse_args()

    m30, d1 = history(args.refetch)
    print(f"M30: {len(m30):,} candles {m30['time'].iat[0]} -> {m30['time'].iat[-1]}")
    print(f"D1:  {len(d1):,} candles {d1['time'].iat[0]} -> {d1['time'].iat[-1]}")
    print(volume_by_year(m30).to_string())
    print(f"\nStrategy: {config.STRATEGY} {TIMEFRAME}, sessions {[s['name'] for s in config.ORB_SESSIONS]}, "
          f"range {config.ORB_RANGE_MINUTES} min, RR {config.ORB_RR}; trades from {args.start}\n")

    memory, trades, df = replay(m30, d1, args.start)
    bad = memory[FEATURES].isna().any(axis=1).sum()
    if bad:
        print(f"WARNING: {bad} trades have missing features")
    memory.to_parquet(MEMORY_FILE)
    print(f"Saved {len(memory)} trades to {MEMORY_FILE}")

    # Memory summary vs backtest.summarize on the same period
    print("\nTrade memory:")
    print(f"  trades {len(memory)}, win rate {100 * memory['won'].mean():.1f}%, "
          f"avg R {memory['r_multiple'].mean():+.3f}, total $/oz {memory['pnl'].sum():.2f}, "
          f"result ${memory['pnl_usd'].sum():.2f}")
    print("  by exit:", memory["exit_reason"].value_counts().to_dict())
    print("  by year:", memory.groupby(memory["entry_time"].dt.year)["r_multiple"].agg(["count", "mean"]).round(3).to_dict("index"))

    # Independent check: a fresh backtest.run over the same period only (warm-up from full history)
    seconds = binance_feed.candle_seconds(TIMEFRAME)
    strat = strategy.create(config.STRATEGY, seconds)
    full = strat.prepare(m30, d1)
    period = full[full["time"] >= pd.Timestamp(args.start, tz="UTC")].reset_index(drop=True)
    check = backtest.run(strat, period, binance_feed.POINT, seconds)
    pd.set_option("display.width", 220)
    print("\nbacktest.summarize (same period, separate run):")
    print(pd.DataFrame([backtest.summarize(check, period, f"Session breakout {TIMEFRAME}")]).to_string(index=False))
    wr = 100 * (check.pnl > 0).mean()
    same = len(check) == len(memory) and abs(check.pnl.sum() - memory.pnl.sum()) < 1e-6
    print(f"\nMatch: trades {len(memory)} vs {len(check)}, win rate {100 * memory['won'].mean():.1f}% vs {wr:.1f}% "
          f"-> {'OK' if same else 'DIFFERENT (see above)'}")


if __name__ == "__main__":
    main()
