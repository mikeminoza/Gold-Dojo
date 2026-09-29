"""Replay a strategy on MT5 history to see how it would have done.

    python backtest.py                         # strategy + timeframe from config.py
    python backtest.py --strategy ema --timeframe H1
    python backtest.py --compare               # both strategies on M5, M15, M30, H1 side by side
    python backtest.py --demo --compare        # try it on fake prices (no MT5)

The news pause isn't applied here (no historical calendar), and every trade pays the spread.
"""
import argparse

import pandas as pd
from dotenv import load_dotenv

load_dotenv()

import config
import sessions
import sizing
import strategy

STRATEGY_NAMES = {"orb": "Session breakout", "ema": "EMA crossover"}
TIMEFRAME_MINUTES = {"M5": 5, "M15": 15, "M30": 30, "H1": 60}


def run(strat, df, point, candle_seconds):
    """Simulate trades on closed candles. Enters at the next candle's open, pays the spread,
    and assumes the worst case (stop loss) if SL and TP are both touched in one candle."""
    trades, pos = [], None
    candle = pd.Timedelta(seconds=candle_seconds)

    for i in range(1, len(df) - 1):
        if pos:
            hi, lo = df["high"].iat[i], df["low"].iat[i]
            exit_price = reason = None
            if pos["side"] == "BUY":
                if lo <= pos["sl"]:
                    exit_price, reason = pos["sl"], "SL"
                elif hi >= pos["tp"]:
                    exit_price, reason = pos["tp"], "TP"
            else:
                if hi >= pos["sl"]:
                    exit_price, reason = pos["sl"], "SL"
                elif lo <= pos["tp"]:
                    exit_price, reason = pos["tp"], "TP"
            if exit_price is None:
                early = strat.exit(pos, df, i)
                if early:
                    exit_price, reason = df["close"].iat[i], early
            if exit_price is not None:
                pnl = exit_price - pos["entry"] if pos["side"] == "BUY" else pos["entry"] - exit_price
                pnl -= pos["spread"]  # every trade pays the spread once, buys and sells alike
                trades.append({**pos, "exit": exit_price, "reason": reason, "pnl": pnl,
                               "pnl_usd": sizing.money(pnl, pos["lots"]), "exit_time": df["time"].iat[i]})
                pos = None

        if pos:
            continue
        sig = strat.entry(df, i)
        if sig:
            bar_spread = df["spread"].iat[i + 1] * point if "spread" in df else 0.0
            spread = max(bar_spread, config.BACKTEST_MIN_SPREAD)
            entry = df["open"].iat[i + 1]
            lv = strategy.levels(sig.side, entry, sig.stop, sig.rr)
            if lv:
                strat.on_open(sig)
                size = sizing.lot_size(entry, lv[0], lv[1])
                pos = {"side": sig.side, "entry": entry, "sl": lv[0], "tp": lv[1], "expires": sig.expires,
                       "spread": spread,
                       "entry_time": df["time"].iat[i] + candle, "lots": size["lots"],
                       "risk_pct": size["risk_percent"], "verdict": size["verdict"]}

    return pd.DataFrame(trades)


def summarize(trades, df, label):
    days = (df["time"].iat[-1] - df["time"].iat[0]).days
    if trades.empty:
        return {"setup": label, "days": days, "trades": 0}
    wins, losses = trades[trades.pnl > 0], trades[trades.pnl <= 0]
    equity = trades.pnl.cumsum()
    return {
        "setup": label,
        "days": days,
        "trades": len(trades),
        "per_week": round(len(trades) / max(days / 7, 1), 1),
        "win_rate_%": round(100 * len(wins) / len(trades), 1),
        "total_$/oz": round(float(trades.pnl.sum()), 2),
        "avg_win": round(float(wins.pnl.mean()), 2) if len(wins) else 0,
        "avg_loss": round(float(losses.pnl.mean()), 2) if len(losses) else 0,
        "profit_factor": round(float(wins.pnl.sum() / -losses.pnl.sum()), 2) if losses.pnl.sum() < 0 else float("inf"),
        "max_drawdown_$/oz": round(float((equity - equity.cummax()).min()), 2),
        # In account money, sizing each trade as the live bot suggests (on a fixed ACCOUNT_BALANCE)
        "result_$": round(float(trades.pnl_usd.sum()), 2),
        "result_%": round(float(100 * trades.pnl_usd.sum() / config.ACCOUNT_BALANCE), 1),
        "worst_drop_%": round(float(100 * _drawdown(trades.pnl_usd) / config.ACCOUNT_BALANCE), 1),
        "over_limit": int((trades.verdict == "skip").sum()),
    }


def _drawdown(pnl):
    """Largest peak-to-trough fall of the running total (a negative number)."""
    equity = pnl.cumsum()
    return (equity - equity.cummax().clip(lower=0)).min()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategy", choices=["orb", "ema"], default=config.STRATEGY)
    ap.add_argument("--timeframe", default=config.TIMEFRAME)
    ap.add_argument("--bars", type=int, default=20000)
    ap.add_argument("--compare", action="store_true", help="both strategies on several timeframes")
    ap.add_argument("--demo", action="store_true", help="fake prices instead of MT5")
    args = ap.parse_args()

    if args.demo:
        import demo_feed as feed
        config.SESSION_START_HOUR, config.SESSION_END_HOUR = 0, 24
        config.TRADE_WEEKDAYS = set(range(7))
    elif config.PRICE_FEED == "mt5":
        import mt5_data as feed
    elif config.PRICE_FEED == "binance":
        import binance_feed as feed
    else:
        import xauusd_feed as feed
    feed.connect()
    symbol = feed.resolve_symbol(config.SYMBOL)
    point = feed.mt5.symbol_info(symbol).point if hasattr(feed, "mt5") else 0.01
    clock = sessions.DemoClock() if args.demo else None

    if args.compare:
        runs = [(s, tf) for s in ("orb", "ema") for tf in ("M5", "M15", "M30", "H1")
                if not (s == "orb" and TIMEFRAME_MINUTES[tf] > config.ORB_RANGE_MINUTES)]
    else:
        runs = [(args.strategy, args.timeframe)]
    daily = feed.get_bars(symbol, "D1", max(args.bars // 20, 400))

    rows = []
    for name, tf in runs:
        config.TIMEFRAME = tf
        seconds = feed.candle_seconds(tf)
        strat = strategy.create(name, seconds, clock)
        df = strat.prepare(feed.get_bars(symbol, tf, args.bars), daily)
        trades = run(strat, df, point, seconds)
        rows.append(summarize(trades, df, f"{STRATEGY_NAMES[name]} {tf}"))
        if not args.compare and not trades.empty:
            print(trades.tail(15)[["entry_time", "side", "entry", "exit", "reason", "pnl"]].to_string(index=False))
            print()

    pd.set_option("display.width", 220)
    print(pd.DataFrame(rows).to_string(index=False))
    print("\n$/oz = price move per 1 ounce. 1 standard lot = 100 oz, so multiply by 100 for a 1-lot result.")
    print(f"result_$ / result_% / worst_drop_% = on a ${config.ACCOUNT_BALANCE:,.0f} account risking "
          f"{config.RISK_PERCENT:g}% per trade (minimum {config.MIN_LOT} lot). "
          f"over_limit = trades where even the minimum lot risked more than {config.MAX_RISK_PERCENT:g}%.")
    if args.compare:
        print(f"Session breakout skips timeframes longer than its {config.ORB_RANGE_MINUTES}-minute opening range.")
    feed.shutdown()


if __name__ == "__main__":
    main()
