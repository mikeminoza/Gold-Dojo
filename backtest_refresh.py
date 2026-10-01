"""Keeps the website's backtest up to date, from the candles the live bot already has.

publish_backtest.py replays years of history once. After that, every few hours the bot replays just
its recent candles (no extra price requests) and adds any trades newer than the last one saved, so
the Performance page's backtest always runs up to the latest closed session.

Runs in a background thread; if Supabase is unreachable it simply tries again next time.
"""
import json
import threading
import time
from datetime import datetime, timezone

import requests

import backtest
import config
import strategy
from publish_backtest import ROW_ID, as_row

REFRESH_SECONDS = 6 * 3600


class BacktestRefresher:
    def __init__(self, cloud, candle_seconds):
        self.cloud = cloud  # cloud_state.CloudPublisher: its Supabase URL and key
        self.candle_seconds = candle_seconds
        self.last = 0.0
        self.busy = False

    def maybe_refresh(self, bars, daily):
        """Call with the bot's recent candles; refreshes at most every REFRESH_SECONDS."""
        if not self.cloud.enabled or self.busy or time.time() - self.last < REFRESH_SECONDS:
            return
        self.busy, self.last = True, time.time()
        threading.Thread(target=self._refresh, args=(bars.copy(), daily.copy()), name="backtest", daemon=True).start()

    def _refresh(self, bars, daily):
        try:
            saved = self._load()
            if not saved or saved.get("timeframe") != config.TIMEFRAME or \
                    saved.get("strategy", {}).get("id") != config.STRATEGY:
                return  # nothing published yet, or a different setup: publish_backtest.py rebuilds it
            # A fresh strategy object, so the live bot's own "traded this session" memory isn't touched
            strat = strategy.create(config.STRATEGY, self.candle_seconds)
            df = strat.prepare(bars, daily)
            recent = as_row(strat, df, backtest.run(strat, df, 0.01, self.candle_seconds))
            newest = max((k["t"] for k in saved["trades"]), default=0)
            added = [k for k in recent["trades"] if k["t"] > newest]
            to = max(saved["to"], recent["to"])
            if not added and to == saved["to"]:
                return
            saved.update(trades=saved["trades"] + added, to=to, generated=int(time.time()),
                         strategy=recent["strategy"])
            self._save(saved)
            if added:
                print(f"{datetime.now():%H:%M:%S} backtest: added {len(added)} new trade(s) to the website")
        except Exception as e:  # never let this disturb the live bot
            print(f"{datetime.now():%H:%M:%S} backtest refresh skipped ({e})")
        finally:
            self.busy = False

    def _load(self):
        r = requests.get(f"{self.cloud.url}/rest/v1/bot_state", params={"id": f"eq.{ROW_ID}", "select": "data"},
                         headers=self.cloud._headers(), timeout=20)
        r.raise_for_status()
        rows = r.json()
        return rows[0]["data"] if rows else None

    def _save(self, data):
        body = {"id": ROW_ID, "data": data, "updated_at": datetime.now(timezone.utc).isoformat()}
        r = requests.post(f"{self.cloud.url}/rest/v1/bot_state", headers=self.cloud._headers(),
                          data=json.dumps(body), timeout=30)
        r.raise_for_status()
