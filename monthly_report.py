"""A monthly report: on the 1st (local time), last month's paper trades for each strategy, the record
since the start, and how that compares with what the backtest averaged per month. Posted in chat and
Telegram, and kept (the last 36) in Supabase as a permanent record (bot_state row "monthly_reports").
"""
import time

import pandas as pd

import config
import trend_daily

POST_HOUR = 9  # 9 AM local (config.DISPLAY_TZ) on the 1st


def month_key(now=None):
    local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
    return f"{local.year}-{local.month:02d}"


def due(last_key, now=None):
    local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
    return local.day == 1 and local.hour >= POST_HOUR and month_key(now) != last_key


def last_month(now=None):
    """(start, end) UTC seconds of the previous local calendar month, and its name like "September 2026"."""
    local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
    end = local.normalize().replace(day=1)
    start = (end - pd.Timedelta(days=1)).replace(day=1)
    return int(start.timestamp()), int(end.timestamp()), start.strftime("%B %Y")


def build(trackers, backtests, now=None):
    """trackers: [(label, DailyTrend)]; backtests: {rule id: {"total_r", "months"}} -> (text, record)."""
    start, end, name = last_month(now)
    record = {"month": name, "start": start, "end": end, "rules": {}}
    parts = [f"Monthly report, {name} (paper test, not financial advice)."]
    for label, tracker in trackers:
        if not tracker:
            continue
        lines = []
        for rule, x in tracker.rules.items():
            month = [t for t in x.trades if start <= t["closed"] < end]
            r_month = round(sum(t["r"] for t in month), 2)
            r_all = round(sum(t["r"] for t in x.trades), 2)
            bt = backtests.get(rule) or {}
            per_month = round(bt["total_r"] / bt["months"], 2) if bt.get("months") else None
            record["rules"][rule] = {"trades": len(month), "r": r_month, "total_trades": len(x.trades),
                                     "total_r": r_all, "backtest_r_per_month": per_month,
                                     "open": bool(x.position)}
            line = f"{trend_daily.NAMES[rule]}: {len(month)} trade{'s' if len(month) != 1 else ''} closed, {r_month:+.2f}R"
            if per_month is not None:
                line += f" (backtest average {per_month:+.2f}R a month)"
            line += f"; since the start {len(x.trades)} trades, {r_all:+.2f}R"
            if x.position:
                line += "; a trade is still open"
            lines.append(line)
        parts.append(f"{label}: " + "; ".join(lines) + ".")
    parts.append("One month says little: trend-following has long flat stretches and a few big wins.")
    return " ".join(parts), record


def backtest_rates(row):
    """{rule: {"total_r", "months"}} from a published backtest row (publish_trend_backtest.py)."""
    if not row:
        return {}
    months = max(1, round((row["to"] - row["from"]) / (30.44 * 86400)))
    return {r: {"total_r": x["stats"].get("total_r", 0), "months": months} for r, x in row.get("rules", {}).items()}
