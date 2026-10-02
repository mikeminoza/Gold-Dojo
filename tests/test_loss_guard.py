import datetime as dt

import config
import loss_guard

DAY = 86400
NOW = 1_790_000_000  # a time in Sep 2026


def test_r_multiple():
    assert loss_guard.r_multiple(-5, 5) == -1
    assert loss_guard.r_multiple(10, 5) == 2
    assert loss_guard.r_multiple(-3, None) == -1


def test_losing_streak_pauses_for_a_week():
    closes = [(NOW - (5 - i) * DAY, -1.0) for i in range(config.LOSS_STREAK_LIMIT)]
    reason, until = loss_guard.pause(closes, NOW)
    assert "in a row" in reason
    assert until == closes[-1][0] + config.LOSS_STREAK_PAUSE_DAYS * DAY


def test_one_short_of_the_streak_is_fine():
    closes = [(NOW - (5 - i) * DAY, -1.0) for i in range(config.LOSS_STREAK_LIMIT - 1)]
    assert loss_guard.pause(closes, NOW) is None


def test_a_win_resets_the_streak():
    rs = [-1, -1, -1, -1, 3, -1, -1, -1, -1]  # 4 losses, a win, 4 losses: no streak, month only -5R
    closes = [(NOW - 9 * DAY + i * DAY, r) for i, r in enumerate(rs)]
    assert loss_guard.pause(closes, NOW) is None


def test_monthly_limit():
    start = dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc).timestamp()
    rs = [-1, -1, -1, -1, 2, -1, -1, -1, -1, 1, -1, -1]  # never 5 in a row, but -7R in the month
    closes = [(start + i * 2 * DAY, r) for i, r in enumerate(rs)]
    reason, until = loss_guard.pause(closes, start + 25 * DAY)
    assert "month" in reason
    assert until == dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc).timestamp()
