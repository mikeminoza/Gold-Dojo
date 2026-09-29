"""Market session clock: when do the London / New York sessions open, and where is their opening range?"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from functools import lru_cache

import pandas as pd

import config


@dataclass(frozen=True)
class Session:
    id: str                  # unique per session per day, e.g. "London-2026-09-29"
    name: str
    open: pd.Timestamp       # UTC
    range_end: pd.Timestamp  # UTC: opening range is [open, range_end)
    end: pd.Timestamp        # UTC: no trades after this, open trades close here


class MarketClock:
    """Real sessions from config.ORB_SESSIONS, in each exchange's own time zone."""

    def __init__(self, sessions=None, range_minutes=None):
        self.defs = sessions or config.ORB_SESSIONS
        self.range = pd.Timedelta(minutes=range_minutes or config.ORB_RANGE_MINUTES)

    @lru_cache(maxsize=512)
    def sessions_on(self, day: date):
        out = []
        for d in self.defs:
            opened = pd.Timestamp(datetime.combine(day, time(*d["open"])), tz=d["tz"])
            if opened.weekday() >= 5:
                continue
            ended = pd.Timestamp(datetime.combine(day, time(*d["end"])), tz=d["tz"])
            out.append(Session(f"{d['name']}-{day}", d["name"], opened.tz_convert("UTC"),
                               (opened + self.range).tz_convert("UTC"), ended.tz_convert("UTC")))
        return out

    def _candidates(self, ts):
        day = ts.date()
        return self.sessions_on(day - timedelta(days=1)) + self.sessions_on(day) + self.sessions_on(day + timedelta(days=1))

    def session_at(self, ts):
        """The session whose [open, end) window contains ts, or None."""
        for s in self._candidates(ts):
            if s.open <= ts < s.end:
                return s
        return None

    def next_session(self, ts):
        for offset in range(0, 5):
            for s in sorted(self.sessions_on(ts.date() + timedelta(days=offset)), key=lambda s: s.open):
                if s.open > ts:
                    return s
        return None

    def upcoming(self, ts, n=2):
        """The current session (if any) and the next ones, n in total."""
        found = []
        for offset in range(-1, 5):
            found += [s for s in self.sessions_on(ts.date() + timedelta(days=offset)) if s.end > ts]
        return sorted(found, key=lambda s: s.open)[:n]


class DemoClock:
    """Fast fake sessions for demo mode: one every 2 minutes, with a 15-second opening range."""

    PERIOD, RANGE, LENGTH = 120, 15, 108

    def session_at(self, ts):
        start = int(ts.timestamp()) // self.PERIOD * self.PERIOD
        if ts.timestamp() >= start + self.LENGTH:
            return None
        name = "London" if (start // self.PERIOD) % 2 == 0 else "New York"
        opened = pd.Timestamp(start, unit="s", tz="UTC")
        return Session(f"Demo-{start}", name, opened, opened + pd.Timedelta(seconds=self.RANGE),
                       opened + pd.Timedelta(seconds=self.LENGTH))

    def next_session(self, ts):
        start = (int(ts.timestamp()) // self.PERIOD + 1) * self.PERIOD
        return self.session_at(pd.Timestamp(start, unit="s", tz="UTC"))

    def upcoming(self, ts, n=2):
        current = self.session_at(ts)
        nxt = self.next_session(ts)
        return ([current] if current else []) + [nxt][: n - (1 if current else 0)]
