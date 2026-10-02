import pandas as pd

import backtest
import binance_feed as bf
import strategy


class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body, self.headers = status, body, {}

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise bf.requests.HTTPError(str(self.status_code))


def test_falls_back_to_okx_when_binance_refuses(monkeypatch):
    def fake_get(url, params=None, timeout=None):
        if "binance" in url:
            return FakeResponse(418, {})
        if "okx" in url:
            return FakeResponse(200, {"code": "0", "data": [{"bidPx": "4100.10", "askPx": "4100.60"}]})
        raise AssertionError(url)

    monkeypatch.setattr(bf._session(), "get", fake_get)
    for s in bf.SOURCES:
        s.resting_until = 0
    try:
        assert bf.get_tick("PAXGUSDT") == (4100.10, 4100.60)
        assert not bf.SOURCES[0].available()  # Binance rests after refusing
    finally:
        for s in bf.SOURCES:
            s.resting_until = 0


def test_market_hours():
    assert not bf.market_open(pd.Timestamp("2026-10-03 12:00", tz="UTC"))  # Saturday
    assert bf.market_open(pd.Timestamp("2026-10-01 14:00", tz="UTC"))      # Thursday, New York morning


def test_backtest_pays_the_spread(breakout_bars, daily_uptrend):
    s = strategy.create("orb", 1800)
    df = s.prepare(breakout_bars, daily_uptrend)
    trades = backtest.run(s, df, 0.01, 1800)
    assert len(trades) == 1
    t = trades.iloc[0]
    gross = t.exit - t.entry if t.side == "BUY" else t.entry - t.exit
    assert round(gross - t.pnl, 6) == round(t.spread, 6) and t.spread > 0
