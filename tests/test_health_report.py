import pandas as pd

import config
import health_report

# 2026-10-02 09:30 in PH time (UTC+8)
NOW = pd.Timestamp("2026-10-02 01:30", tz="UTC").timestamp()


def test_due_once_a_day_after_the_hour():
    r = health_report.HealthReport()
    early = pd.Timestamp("2026-10-01 23:00", tz="UTC").timestamp()  # 7 AM PH
    assert config.HEALTH_REPORT_HOUR == 9
    assert not r.due(early)
    assert r.due(NOW)
    r.posted(NOW)
    assert not r.due(NOW + 3600)
    assert r.due(NOW + 86400)


def test_text_counts_restarts_errors_and_signals():
    r = health_report.HealthReport()
    r.started(NOW - 30 * 3600)   # a day and a bit ago
    r.started(NOW - 2 * 3600)    # restarted 2 h ago
    r.error("timeout")
    history = [{"type": "open", "time": NOW - 3600}, {"type": "close", "time": NOW - 600},
               {"type": "open", "time": NOW - 3 * 86400}]
    text = r.text(history, "Binance", "New York Fri 8:30 PM PH", now=NOW)
    assert "running 2.0 h" in text
    assert "restarts in the last 24 h: 1" in text
    assert "loop errors: 1 (last: timeout)" in text
    assert "1 opened, 1 closed" in text
    assert "prices from Binance" in text and "next session: New York" in text
    r.posted(NOW)
    assert r.errors == 0 and r.memory()["last_day"] == "2026-10-02"
