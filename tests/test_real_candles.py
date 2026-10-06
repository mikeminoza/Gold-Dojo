import pandas as pd

import real_candles


def test_real_minutes_replace_a_covered_candle():
    real_candles._minutes.clear()
    start = pd.Timestamp("2026-10-07 13:30", tz="UTC")
    for k in range(30):  # a full half hour of real prices rising 1.00 per minute from 4100
        t = start + pd.Timedelta(minutes=k)
        real_candles.add({"minute": t.isoformat(), "bid_open": 4100 + k, "bid_high": 4100.5 + k,
                          "bid_low": 4099.5 + k, "bid_close": 4100 + k + 0.8, "spread_avg": 0.4})
    df = pd.DataFrame({"time": [start, start + pd.Timedelta(minutes=30)], "open": [1.0, 2.0],
                       "high": [1.0, 2.0], "low": [1.0, 2.0], "close": [1.0, 2.0], "tick_volume": [1, 1]})
    out, real = real_candles.overlay(df, "M30")
    assert real == 1                                # only the covered candle
    assert out["open"].iat[0] == 4100.2             # bid + half the spread
    assert out["high"].iat[0] == 4129.7 and out["low"].iat[0] == 4099.7
    assert out["close"].iat[0] == 4130.0             # last minute: 4129.80 bid + 0.20
    assert out["open"].iat[1] == 2.0                # no real minutes: left as it was
    real_candles._minutes.clear()


def test_too_few_minutes_keeps_the_candle():
    real_candles._minutes.clear()
    start = pd.Timestamp("2026-10-07 13:30", tz="UTC")
    for k in range(10):  # only a third of the half hour
        real_candles.add({"minute": (start + pd.Timedelta(minutes=k)).isoformat(), "bid_open": 1, "bid_high": 1,
                          "bid_low": 1, "bid_close": 1, "spread_avg": 0})
    df = pd.DataFrame({"time": [start], "open": [5.0], "high": [5.0], "low": [5.0], "close": [5.0], "tick_volume": [1]})
    out, real = real_candles.overlay(df, "M30")
    assert real == 0 and out["open"].iat[0] == 5.0
    real_candles._minutes.clear()
