import market_recorder


def test_minute_summary():
    r = market_recorder.MinuteRecorder(gap=lambda: 9.876)
    t0 = 1_790_000_040  # a minute boundary + 0 s
    t0 -= t0 % 60
    assert r.tick(4100.0, 4100.5, t0 + 1) is None
    assert r.tick(4102.0, 4102.3, t0 + 20) is None
    assert r.tick(4099.0, 4099.9, t0 + 50) is None
    row = r.tick(4101.0, 4101.4, t0 + 61)  # next minute starts: the first one is finished
    assert row["bid_open"] == 4100.0 and row["bid_high"] == 4102.0 and row["bid_low"] == 4099.0
    assert row["bid_close"] == 4099.0 and row["ask_close"] == 4099.9
    assert row["ticks"] == 3 and row["spread_max"] == 0.9 and row["spread_avg"] == round((0.5 + 0.3 + 0.9) / 3, 3)
    assert row["paxg_gap"] == 9.88 and row["minute"].endswith(":00Z")
