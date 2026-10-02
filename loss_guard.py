"""Loss limits: pause new signals after a bad run, so a losing streak can't snowball.

Two rules, worked out from the closed trades alone (so they survive restarts and match the backtest):
- Losing streak: after LOSS_STREAK_LIMIT losses in a row, no new signals for LOSS_STREAK_PAUSE_DAYS.
- Monthly limit: once this month's trades add up to MONTHLY_LOSS_LIMIT_R risk units lost, no new
  signals until next month.

Results are counted in R, the trade's result divided by its risk (stop distance), so +2R is a full
win and -1R a full loss whatever the lot size. An open trade is never touched; only new entries stop.
"""
from datetime import datetime, timezone

import config


def r_multiple(pnl, risk):
    """A result in units of risk; trades saved without their risk count as +1 / -1."""
    if risk:
        return pnl / risk
    return (pnl > 0) - (pnl < 0)


def _month_start(ts):
    d = datetime.fromtimestamp(ts, timezone.utc)
    return datetime(d.year, d.month, 1, tzinfo=timezone.utc).timestamp()


def _next_month(ts):
    d = datetime.fromtimestamp(ts, timezone.utc)
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return datetime(y, m, 1, tzinfo=timezone.utc).timestamp()


def pause(closes, now):
    """(reason, until) if new signals are paused right now, else None.

    closes: [(close_time_utc_seconds, r_multiple)], oldest first.
    """
    if not config.LOSS_LIMITS:
        return None
    pause_end, streak = 0.0, 0
    for t, r in closes:
        if t < pause_end:
            continue  # a trade that was already open when the pause began
        streak = streak + 1 if r < 0 else 0
        if streak >= config.LOSS_STREAK_LIMIT:
            pause_end, streak = t + config.LOSS_STREAK_PAUSE_DAYS * 86400, 0
    if now < pause_end:
        return f"{config.LOSS_STREAK_LIMIT} losses in a row", pause_end

    month = sum(r for t, r in closes if t >= _month_start(now))
    if month <= -config.MONTHLY_LOSS_LIMIT_R:
        return f"this month is down {abs(month):.1f}R (limit {config.MONTHLY_LOSS_LIMIT_R:g}R)", _next_month(now)
    return None
