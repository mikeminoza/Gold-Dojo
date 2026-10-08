import numpy as np
import pandas as pd

import config
import monthly_report
import price_check
import real_candles
import trend_daily


def test_monthly_report_counts_last_month_and_compares_with_backtest():
    t = trend_daily.DailyTrend()
    oct1 = pd.Timestamp("2026-10-01 10:00", tz=config.DISPLAY_TZ).timestamp()
    sep = int(pd.Timestamp("2026-09-15", tz="UTC").timestamp())
    aug = int(pd.Timestamp("2026-08-15", tz="UTC").timestamp())
    t.rules["breakout"].trades = [{"closed": aug, "r": -1.0}, {"closed": sep, "r": 2.5}]
    assert monthly_report.due(None, oct1) and not monthly_report.due("2026-10", oct1)
    rates = {"breakout": {"total_r": 24.0, "months": 240}}
    text, rec = monthly_report.build([("Daily trend", t), ("4-hour trend", None)], rates, oct1)
    assert rec["month"] == "September 2026"
    assert rec["rules"]["breakout"] == {"trades": 1, "r": 2.5, "total_trades": 2, "total_r": 1.5,
                                        "backtest_r_per_month": 0.1, "open": False}
    assert "100-day breakout: 1 trade closed, +2.50R (backtest average +0.10R a month)" in text


def test_price_check_compares_paxg_with_recorded_minutes():
    start = pd.Timestamp("2026-10-05 00:00", tz="UTC")
    for i in range(240):  # one fully recorded 4-hour candle, real prices 2000-2010
        real_candles.add({"minute": start + pd.Timedelta(minutes=i), "spread_avg": 0,
                          "bid_open": 2000, "bid_high": 2010, "bid_low": 1995, "bid_close": 2005})
    raw = pd.DataFrame({"time": [start], "open": [2000.0], "high": [2016.0], "low": [1995.0], "close": [2005.0]})
    rows, real = price_check.compare(raw, "H4")
    assert real == 1 and rows[0]["field"] == "high" and rows[0]["diff"] == 6.0
    res = price_check.check(lambda s, tf, n: raw if tf == "H4" else raw.iloc[:0], "XAUUSD")
    assert res["ok"] is False and res["allowed"] == 3.0
    assert "differs from real XAUUSD by $6.00" in price_check.message(res, None)
    assert price_check.message(res, False) is None  # already reported
