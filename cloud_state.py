"""Publishes the bot's live state to Supabase so the website (on Vercel) can show it.

Only sends when something the page shows has changed (a signal, the checklist, session status...)
or every HEARTBEAT_SECONDS so the page knows the bot is running. Live prices aren't sent: the
website gets those straight from the price feeds. Sending runs in a background thread so a slow
network never delays the bot's price checks.
"""
import json
import os
import threading
import time
from datetime import datetime, timezone

import requests

from live_state import _plain

HEARTBEAT_SECONDS = 15
RETRY_SECONDS = 5
ROW_ID = "live"

# Fields that change every tick; they don't count as "something changed"
VOLATILE = ("bid", "ask", "updated")
VOLATILE_POSITION = ("pnl", "pnl_usd")


def _signature(state):
    stable = {k: v for k, v in state.items() if k not in VOLATILE}
    if stable.get("position"):
        stable["position"] = {k: v for k, v in stable["position"].items() if k not in VOLATILE_POSITION}
    return json.dumps(stable, sort_keys=True, default=_plain)


class CloudPublisher:
    def __init__(self, enabled=True):
        self.url = os.getenv("SUPABASE_URL", "").rstrip("/")
        # Newer projects call it the "secret" key; older ones "service_role"
        self.key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        self.enabled = enabled and bool(self.url and self.key)
        self._latest = None
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._sent_sig = None
        self._sent_at = 0.0
        self._failing = False
        if self.enabled:
            threading.Thread(target=self._run, name="cloud", daemon=True).start()

    def publish(self, state):
        """Hand over the latest state; the background thread decides whether to send it."""
        if not self.enabled:
            return
        with self._lock:
            self._latest = state
        self._wake.set()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def _headers(self):
        headers = {"apikey": self.key, "Content-Type": "application/json",
                   "Prefer": "resolution=merge-duplicates,return=minimal"}
        # Older JWT-style keys also go in Authorization; the newer sb_secret_ keys must not
        if self.key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {self.key}"
        return headers

    def _send(self, state):
        body = {"id": ROW_ID, "data": state, "updated_at": datetime.now(timezone.utc).isoformat()}
        r = requests.post(f"{self.url}/rest/v1/bot_state", headers=self._headers(),
                          data=json.dumps(body, default=_plain), timeout=10)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase answered {r.status_code}: {r.text[:200]}")

    def _run(self):
        while not self._stop.is_set():
            self._wake.wait(1.0)
            self._wake.clear()
            with self._lock:
                state = self._latest
            if state is None:
                continue
            sig = _signature(state)
            if sig == self._sent_sig and time.time() - self._sent_at < HEARTBEAT_SECONDS:
                continue
            try:
                self._send(state)
                self._sent_sig, self._sent_at = sig, time.time()
                if self._failing:
                    print(f"{datetime.now():%H:%M:%S} Supabase: sending again")
                self._failing = False
            except (requests.RequestException, RuntimeError) as e:
                if not self._failing:
                    print(f"{datetime.now():%H:%M:%S} Supabase: can't send ({e}); retrying")
                self._failing = True
                self._stop.wait(RETRY_SECONDS)
