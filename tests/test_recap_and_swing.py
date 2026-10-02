import numpy as np
import pandas as pd

import session_recap
import strategy
import swing_paper


def _session_on(df, day):
    return df.loc[df["time"].dt.date == pd.Timestamp(day).date(), "sess"].dropna().iat[0]


def test_recap_explains_a_trade(breakout_bars, daily_uptrend):
    s = strategy.create("orb", 1800)
    df = s.prepare(breakout_bars, daily_uptrend)
    t = int(pd.Timestamp("2026-10-01 14:00", tz="UTC").timestamp())
    history = [
        {"type": "close", "id": "2", "trade_id": "1", "time": t + 3600, "price": 2020.0, "pnl": 10.0,
         "risk_oz": 5.0, "reason": "Take profit hit", "side": "BUY"},
        {"type": "open", "id": "1", "time": t, "price": 2010.0, "sl": 2005.0, "side": "BUY"},
    ]
    text = session_recap.recap(df, _session_on(df, "2026-10-01"), history)
    assert "Buy at 2010.00" in text and "profit of 10.00" in text and "+2.0R" in text


def test_recap_explains_no_trade(breakout_bars, daily_uptrend):
    s = strategy.create("orb", 1800)
    df = s.prepare(breakout_bars, daily_uptrend)
    sess = _session_on(df, "2026-09-29")
    assert "stayed inside the range" in session_recap.recap(df, sess, [])
    assert "skipped: news pause" in session_recap.recap(df, sess, [], skipped="news pause for CPI")


def test_swing_paper_breakout_and_trailing_exit():
    n = 200
    t = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    flat = np.full(140, 2000.0) + np.sin(np.arange(140)) * 5
    c = np.r_[flat, 2000 + np.arange(1, 41) * 8, 2320 - np.arange(1, 21) * 15]
    d = pd.DataFrame({"time": t, "open": c, "high": c + 4, "low": c - 4, "close": c})
    s = swing_paper.SwingPaper()
    s.update(d.iloc[:130])
    assert s.trades == [] and s.started  # never back-fills a record
    for k in range(131, n + 1):
        s.update(d.iloc[:k])
    assert len(s.trades) == 1
    trade = s.trades[0]
    assert trade["side"] == "BUY" and trade["reason"] == "Trailing stop" and trade["r"] > 5
    again = swing_paper.SwingPaper(s.memory())  # a restart carries on from the saved memory
    assert again.trades == s.trades and again.last_day == s.last_day
