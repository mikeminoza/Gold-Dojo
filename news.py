"""High-impact US economic releases, so the bot can pause new signals around them."""
import time

import pandas as pd
import requests

import config

FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
REFRESH_SECONDS = 6 * 3600  # the feed asks clients not to poll it often


class NewsCalendar:
    def __init__(self, enabled=None):
        self.enabled = config.NEWS_PAUSE if enabled is None else enabled
        self.window = pd.Timedelta(minutes=config.NEWS_PAUSE_MINUTES)
        self.events = []  # [(utc Timestamp, title)]
        self.fetched = 0.0
        self.warned = False

    def refresh(self):
        if not self.enabled or time.time() - self.fetched < REFRESH_SECONDS:
            return
        self.fetched = time.time()
        try:
            data = requests.get(FEED, timeout=10).json()
            self.events = sorted(
                (pd.Timestamp(e["date"]).tz_convert("UTC"), e["title"])
                for e in data
                if e.get("country") == "USD" and e.get("impact") == "High"
            )
            self.warned = False
        except (requests.RequestException, ValueError, KeyError) as e:
            self.fetched -= REFRESH_SECONDS - 600  # retry in 10 minutes
            if not self.warned:
                print(f"News calendar unavailable ({e}); signals will not pause for news.")
                self.warned = True

    def pause_reason(self, ts):
        """Title of a release within the pause window around ts, or None."""
        self.refresh()
        for when, title in self.events:
            if abs(when - ts) <= self.window:
                return title
        return None

    def upcoming(self, ts, hours=24):
        """(time, title) of the next release within `hours`, or None."""
        self.refresh()
        for when, title in self.events:
            if ts - self.window <= when <= ts + pd.Timedelta(hours=hours):
                return when, title
        return None
