import numpy as np
import pandas as pd

import trend_daily


def _daily(closes):
    t = pd.date_range("2025-01-01", periods=len(closes), freq="D", tz="UTC")
    c = np.asarray(closes, float)
    return pd.DataFrame({"time": t, "open": c, "high": c + 4, "low": c - 4, "close": c})


def test_breakout_long_then_trailing_exit_and_no_backfill():
    c = np.r_[np.full(240, 2000.0) + np.sin(np.arange(240)) * 5, 2000 + np.arange(1, 41) * 8, 2320 - np.arange(1, 21) * 15]
    d = _daily(c)
    t = trend_daily.DailyTrend()
    assert t.update(d.iloc[:230]) == [] and t.started  # first run starts the test, no history filled in
    events = []
    for k in range(231, len(d) + 1):
        events += t.update(d.iloc[:k])
    opens = [e for e in events if e["rule"] == "breakout" and e["type"] == "open"]
    closes = [e for e in events if e["rule"] == "breakout" and e["type"] == "close"]
    assert len(opens) == 1 and len(closes) == 1
    assert closes[0]["reason"] in ("Trailing stop", "Stop (gap)") and closes[0]["r"] > 3  # exits after a big run up
    again = trend_daily.DailyTrend(t.memory())  # survives a restart
    assert again.rules["breakout"].trades == t.rules["breakout"].trades


def test_never_sells():
    c = np.r_[np.full(240, 2000.0), 2000 - np.arange(1, 61) * 8]  # a long fall
    d = _daily(c)
    t = trend_daily.DailyTrend()
    t.update(d.iloc[:230])
    events = []
    for k in range(231, len(d) + 1):
        events += t.update(d.iloc[:k])
    assert not [e for e in events if e["type"] == "open"]  # long only: it sits out a downtrend
    assert "a daily close above" in t.summary()["rules"][0]["waiting"]
