import time

import health


class Cloud:
    last_ok = time.time()


def test_health_tells_the_truth(monkeypatch):
    h = health.Health()
    h.cloud = Cloud()
    h.touch(waiting_for_prices=False)
    assert h.status()["ok"] and not h.status()["restart"]
    h.touch(waiting_for_prices=True)  # failing, but not for long yet
    assert h.status()["ok"]
    h.failing_since -= health.STUCK_SECONDS + 1  # stuck for 5+ minutes: not ok, Render should restart
    s = h.status()
    assert not s["ok"] and s["restart"] and "no prices" in s["problem"]
    h.touch(waiting_for_prices=False)  # recovered
    assert h.status()["ok"]
    h.cloud.last_ok -= health.CLOUD_SECONDS + 1  # only Supabase down: not ok, but a restart won't help
    s = h.status()
    assert not s["ok"] and not s["restart"] and "Supabase" in s["problem"]
    h.cloud.last_ok = time.time()
    h.beat -= health.STALL_SECONDS + 1  # loop stopped
    assert h.status()["restart"]
