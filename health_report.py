"""A once-a-day health check the bot posts in the website chat ("Bot status" room).

Says how long the bot has run since its last restart, how many restarts and loop errors there were in
the last day, where prices come from, and the signals sent - so a quiet bot can be told apart from a
broken one without opening Render.
"""
import time

import pandas as pd

import config

DAY = 86400


class HealthReport:
    def __init__(self, memory=None):
        m = memory or {}
        self.starts = m.get("starts", [])          # UTC seconds of recent bot starts
        self.errors = m.get("errors", 0)           # loop errors since the last report
        self.last_error = m.get("last_error")
        self.last_day = m.get("last_day")          # local date of the last report, "YYYY-MM-DD"

    def memory(self):
        return {"starts": self.starts[-20:], "errors": self.errors, "last_error": self.last_error,
                "last_day": self.last_day}

    def started(self, now=None):
        self.starts = (self.starts + [int(now or time.time())])[-20:]

    def error(self, message):
        self.errors += 1
        self.last_error = str(message)[:160]

    def due(self, now=None):
        """True once a day, at the first check after HEALTH_REPORT_HOUR local time."""
        local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
        return local.hour >= config.HEALTH_REPORT_HOUR and local.strftime("%Y-%m-%d") != self.last_day

    def text(self, history, source, next_session=None, now=None):
        now = now or time.time()
        local = pd.Timestamp(now, unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
        up_h = (now - self.starts[-1]) / 3600 if self.starts else 0
        # every start after an earlier one is a restart (a crash, a redeploy or Render waking it)
        restarts = sum(t > now - DAY for t in self.starts[1:])
        opens = [e for e in history if e["type"] == "open" and e["time"] > now - DAY]
        closes = [e for e in history if e["type"] == "close" and e["time"] > now - DAY]
        parts = [
            f"Daily bot check, {local:%a %b} {local.day}: running {up_h:.1f} h since its last start",
            f"restarts in the last 24 h: {restarts}",
            f"loop errors: {self.errors}" + (f" (last: {self.last_error})" if self.errors and self.last_error else ""),
            f"prices from {source}",
            f"signals in the last 24 h: {len(opens)} opened, {len(closes)} closed",
        ]
        if next_session:
            parts.append(f"next session: {next_session}")
        status = "All good." if self.errors < 20 and restarts < 3 else "Worth a look on Render."
        return " · ".join(parts) + f". {status}"

    def posted(self, now=None):
        local = pd.Timestamp(now or time.time(), unit="s", tz="UTC").tz_convert(config.DISPLAY_TZ)
        self.last_day = local.strftime("%Y-%m-%d")
        self.errors, self.last_error = 0, None
