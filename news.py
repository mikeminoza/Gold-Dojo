"""High-impact US economic releases, so the bot can pause new signals around them."""
import json
import time
from pathlib import Path

import pandas as pd
import requests

import config

FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
REFRESH_SECONDS = 6 * 3600  # the feed asks clients not to poll it often, and refuses if they do
RETRY_SECONDS = 600
CACHE_FILE = Path(__file__).with_name("news_cache.json")  # survives restarts, so they don't refetch


class NewsCalendar:
    def __init__(self, enabled=None):
        self.enabled = config.NEWS_PAUSE if enabled is None else enabled
        self.window = pd.Timedelta(minutes=config.NEWS_PAUSE_MINUTES)
        self.events = []  # [(utc Timestamp, title)]
        self.fetched = 0.0
        self.warned = False
        if self.enabled:
            self._load_cache()

    @staticmethod
    def _parse(data):
        return sorted(
            (pd.Timestamp(e["date"]).tz_convert("UTC"), e["title"])
            for e in data
            if e.get("country") == "USD" and e.get("impact") == "High"
        )

    def _load_cache(self):
        """Use the calendar saved by an earlier run if it's recent enough."""
        try:
            saved = json.loads(CACHE_FILE.read_text())
            self.events = self._parse(saved["events"])
            self.fetched = float(saved["fetched"])
        except (FileNotFoundError, ValueError, KeyError, TypeError):
            pass

    def refresh(self):
        if not self.enabled or time.time() - self.fetched < REFRESH_SECONDS:
            return
        self.fetched = time.time()
        try:
            data = requests.get(FEED, timeout=10).json()
            self.events = self._parse(data)
            CACHE_FILE.write_text(json.dumps({"fetched": self.fetched, "events": data}))
            self.warned = False
        except (requests.RequestException, ValueError, KeyError) as e:
            self.fetched -= REFRESH_SECONDS - RETRY_SECONDS  # retry in 10 minutes
            if not self.warned:
                kept = f"keeping the {len(self.events)} saved releases" if self.events else \
                    "signals will not pause for news until it's back"
                print(f"News calendar unavailable ({e}); {kept}.")
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
