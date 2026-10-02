import pandas as pd

import config
import strategy


def test_levels_normal_and_rejected():
    assert strategy.levels("SELL", 4163.14, 4174.88, 2.0) == (4174.88, 4163.14 - 2 * (4174.88 - 4163.14))
    assert strategy.levels("BUY", 1000.0, 1001.0, 2.0) is None          # already past the stop
    assert strategy.levels("BUY", 1000.0, 999.994, 2.0) is None         # too close: lot size would balloon
    assert strategy.levels("BUY", 1000.0, 1000.0 - config.MIN_STOP_DISTANCE, 2.0) is not None


def _signals(s, df):
    return [(df["time"].iat[i], sig) for i in range(len(df)) if (sig := s.entry(df, i))]


def test_breakout_buy_in_uptrend(breakout_bars, daily_uptrend):
    s = strategy.create("orb", 1800)
    df = s.prepare(breakout_bars, daily_uptrend)
    found = _signals(s, df)
    assert found, "expected a breakout signal"
    t, sig = found[0]
    assert sig.side == "BUY"
    assert t.date() == pd.Timestamp("2026-10-01").date()
    assert sig.stop < df.loc[df["time"] == t, "close"].iat[0]


def test_no_buy_against_the_trend(breakout_bars, daily_uptrend):
    down = daily_uptrend.copy()
    cols = ["open", "high", "low", "close"]
    down[cols] = down[cols].iloc[::-1].to_numpy()
    s = strategy.create("orb", 1800)
    df = s.prepare(breakout_bars, down)
    assert _signals(s, df) == []


def test_one_trade_per_session(breakout_bars, daily_uptrend):
    s = strategy.create("orb", 1800)
    df = s.prepare(breakout_bars, daily_uptrend)
    s.on_open(_signals(s, df)[0][1])
    assert _signals(s, df) == []
