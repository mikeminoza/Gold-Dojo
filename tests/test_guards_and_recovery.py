import json

import pandas as pd

import config
import guards
import news
import sessions


# ---- drift alarm ----

def test_drift_alarm_only_after_enough_trades_and_when_far_below():
    pool = [-1.0] * 60 + [2.0] * 40  # a backtest winning 40% at 2R
    assert guards.drift_verdict([-1.0] * (config.DRIFT_MIN_TRADES - 1), pool) is None  # too few to judge
    pct, alarm = guards.drift_verdict([-1.0] * config.DRIFT_MIN_TRADES, pool)  # 20 losses in a row
    assert alarm and pct < config.DRIFT_PERCENTILE
    pct, alarm = guards.drift_verdict([-1.0] * 12 + [2.0] * 8, pool)  # a normal mix
    assert not alarm and 20 < pct < 80


# ---- risk cap ----

def test_risk_cap():
    trend_open = [{"entry": 4000}, {"entry": 4100}]  # two Daily trend paper trades at 1% each
    assert guards.open_risk_pct(None, trend_open) == 2.0
    assert guards.risk_cap_reason(None, trend_open, 1.0) is None          # 3.0% is allowed
    assert "cap" in guards.risk_cap_reason(None, trend_open, 2.3)          # 4.3% is not
    ny = {"size": {"risk_percent": 2.3}}
    assert "cap" in guards.risk_cap_reason(ny, [], 1.0)


# ---- silence alarm ----

def test_silence_alarm_starts_once_and_clears():
    s = guards.Silence()
    s.price(1000)
    assert s.check(1000 + 60, True, 1000) is None                          # fine
    msg = s.check(1000 + config.SILENCE_PRICE_SECONDS + 60, True, 1000)
    assert msg and "no real gold price" in msg
    assert s.check(1000 + config.SILENCE_PRICE_SECONDS + 120, True, 1000) is None  # not repeated
    s.price(5000)
    assert "recovered" in s.check(5010, True, 5000)
    assert s.check(10_000_000, False, 0) is None                           # market closed: no alarm


# ---- US daylight saving: the New York session moves in UTC (and in PH time) ----

def test_new_york_session_follows_daylight_saving():
    clock = sessions.MarketClock()
    summer = clock.session_at(pd.Timestamp("2026-10-01 13:00", tz="UTC"))   # EDT: 8:30 NY = 12:30 UTC
    winter = clock.session_at(pd.Timestamp("2026-11-12 14:00", tz="UTC"))   # EST: 8:30 NY = 13:30 UTC
    assert summer.open == pd.Timestamp("2026-10-01 12:30", tz="UTC")
    assert winter.open == pd.Timestamp("2026-11-12 13:30", tz="UTC")
    # the week the US changes clocks (Nov 1, 2026): the Monday after is already winter time
    assert clock.session_at(pd.Timestamp("2026-11-02 14:00", tz="UTC")).open == pd.Timestamp("2026-11-02 13:30", tz="UTC")
    assert clock.session_at(pd.Timestamp("2026-11-12 12:45", tz="UTC")) is None  # before the winter open


# ---- news pause ----

def test_news_pause_window():
    cal = news.NewsCalendar(enabled=False)
    cal.enabled = True
    cal.fetched = 10**12  # don't fetch
    release = pd.Timestamp("2026-10-02 12:30", tz="UTC")
    cal.events = [(release, "Non-Farm Employment Change")]
    mins = config.NEWS_PAUSE_MINUTES
    assert cal.pause_reason(release - pd.Timedelta(minutes=mins - 1)) == "Non-Farm Employment Change"
    assert cal.pause_reason(release + pd.Timedelta(minutes=mins - 1)) == "Non-Farm Employment Change"
    assert cal.pause_reason(release + pd.Timedelta(minutes=mins + 1)) is None


# ---- restart recovery: an open trade and the trackers come back from the saved memory ----

def test_restart_recovers_open_trade_and_trackers(tmp_path, monkeypatch):
    import bot
    import xauusd_feed as feed

    saved = {
        "position": {"side": "SELL", "entry": 4163.14, "sl": 4174.88, "tp": 4139.67, "trade_id": "t1",
                     "opened": 1790000000, "size": {"lots": 0.01, "risk_percent": 2.3}},
        "history": [{"type": "open", "id": "t1", "side": "SELL", "price": 4163.14, "sl": 4174.88, "time": 1790000000}],
        "strategy_state": {"orb": {"taken": ["New York-2026-10-01"]}},
        "swing_paper": {"last_day": 1789900000, "trades": [], "position": None, "pending": 0, "started": 1789000000},
        "daily_trend": {"last_day": 1789900000, "started": 1789000000, "rules": {}},
        "health_report": {"starts": [1789000000], "errors": 2},
    }
    state_file = tmp_path / "state.json"
    state_file.write_text(json.dumps(saved))
    monkeypatch.setattr(bot, "STATE_FILE", state_file)
    monkeypatch.setenv("SUPABASE_URL", "")
    b = bot.Bot(feed, False, "orb")
    assert b.position["trade_id"] == "t1" and b.position["side"] == "SELL"
    assert "New York-2026-10-01" in b.strat.state["taken"]   # won't re-enter the same session
    assert b.swing.started == 1789000000 and b.trend.started == 1789000000
    assert b.report.errors == 2
