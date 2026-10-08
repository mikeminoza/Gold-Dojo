import pandas as pd
import pytest

import twelvedata_feed as td


class Resp:
    def __init__(self, body, code=200):
        self.body, self.status_code = body, code

    def json(self):
        return self.body


def _values(start, n, step_h):
    t = pd.date_range(start, periods=n, freq=f"{step_h}h", tz="UTC")
    return [{"datetime": x.strftime("%Y-%m-%d %H:%M:%S"), "open": "2000", "high": "2010", "low": "1990",
             "close": "2005"} for x in t]


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setenv("TWELVEDATA_API_KEY", "k")
    td._cache.clear()
    td._state.update(failed_at=0.0, last_error=None, used=None, warned=False)


def test_real_candles_closed_only_and_cached(monkeypatch):
    calls = []

    def get(url, params, timeout):
        calls.append(params)
        return Resp({"status": "ok", "values": _values("2026-01-01", 400, 1)})  # hourly -> 4-hour

    monkeypatch.setattr(td.requests, "get", get)
    df = td.get_bars("H4", 80)
    assert len(df) == 80 and df["close"].iat[-1] == 2005.0 and calls[0]["interval"] == "1h"
    assert (df["time"].dt.hour % 4 == 0).all()  # built on 00/04/08... UTC
    # same time precision as the PAXG candles: mixing units broke the strategy's merge on the live bot
    assert str(df["time"].dtype) == "datetime64[ms, UTC]"
    td.get_bars("H4", 80)
    assert len(calls) == 1  # served from the cache
    assert td.status()["source"] == "Twelve Data"


def test_falls_back_to_paxg_on_errors_and_odd_data(monkeypatch):
    monkeypatch.setattr(td.requests, "get", lambda *a, **k: Resp({"status": "error", "message": "limit"}, 429))
    assert td.get_bars("D1", 50) is None and "limit" in td.status()["last_error"]
    td._cache.clear()
    td._state["failed_at"] = 0.0
    # daily candles starting at 22:00 instead of 00:00 UTC: not trusted
    monkeypatch.setattr(td.requests, "get", lambda *a, **k: Resp({"status": "ok", "values": _values("2026-01-01 22:00", 60, 24)}))
    assert td.get_bars("D1", 50) is None


def test_no_key_means_paxg(monkeypatch):
    monkeypatch.delenv("TWELVEDATA_API_KEY")
    assert td.get_bars("D1", 50) is None and not td.supports("D1")


def test_hourly_not_on_the_hour_falls_back(monkeypatch):
    monkeypatch.setattr(td.requests, "get", lambda *a, **k: Resp({"status": "ok", "values": _values("2026-01-01 00:30", 400, 1)}))
    assert td.get_bars("H4", 80) is None
