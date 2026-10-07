"""A weekly summary the bot posts in the website chat (and Telegram): where gold is, what each trend rule
is waiting for or holding, and the paper-test record so far. Once a week, Sunday evening local time.
"""
import time

import pandas as pd

import config
import trend_daily

POST_WEEKDAY = 6   # Sunday
POST_HOUR = 18     # 6 PM local (config.DISPLAY_TZ)


def week_key(now=None):
    local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
    year, week, _ = local.isocalendar()
    return f"{year}-W{week:02d}"


def due(last_key, now=None):
    """True at the first check after Sunday POST_HOUR local, once per ISO week."""
    local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
    return local.weekday() == POST_WEEKDAY and local.hour >= POST_HOUR and week_key(now) != last_key


def _rule_line(tracker, rule, bid):
    x = tracker.rules[rule]
    name = trend_daily.NAMES[rule]
    if x.position:
        p = x.position
        r_now = (bid - p["entry"]) / p["risk"] if p["risk"] else 0.0
        opened = pd.Timestamp(p["opened"], unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
        return f"{name}: in a long since {opened:%b %d} at {p['entry']:.2f}, stop {p['stop']:.2f}, {r_now:+.2f}R now"
    if x.pending:
        return f"{name}: buying at the next open"
    gap = tracker.gap_pct(rule, bid)
    if gap is not None and gap > 0:
        return f"{name}: waiting, {gap:.1f}% below its trigger {tracker.triggers[rule]:.2f}"
    return f"{name}: waiting for {tracker.waiting.get(rule) or 'its setup'}"


def _record(tracker):
    rs = [t["r"] for x in tracker.rules.values() for t in x.trades]
    if not rs:
        return "no closed paper trades yet"
    return f"{len(rs)} paper trade{'s' if len(rs) != 1 else ''}, {sum(rs):+.1f}R"


def text(trackers, bid, daily=None):
    """trackers: [(label, DailyTrend)]; daily: closed daily candles for the week's change."""
    head = f"Weekly summary (paper test). Gold {bid:.2f}"
    if daily is not None and len(daily) > 5:
        week_ago = float(daily["close"].iat[-6])
        head += f" ({100 * (bid / week_ago - 1):+.1f}% this week)"
    parts = [head + "."]
    for label, tracker in trackers:
        if not tracker:
            continue
        lines = "; ".join(_rule_line(tracker, r, bid) for r in tracker.rules)
        parts.append(f"{label}: {lines}. Record: {_record(tracker)}.")
    return " ".join(parts)
