"""Publishes the bot's live state to Supabase so the website (on Vercel) can show it.

Only sends when something the page shows has changed (a signal, the checklist, session status...)
or every HEARTBEAT_SECONDS so the page knows the bot is running. Live prices aren't sent: the
website gets those straight from the price feeds. Sending runs in a background thread so a slow
network never delays the bot's price checks.

Every signal (BUY / SELL / CLOSE) is also saved permanently in the `signals` table - the journal.
Those are queued and retried until Supabase has them, and re-sending never creates duplicates.
"""
import json
import os
import threading
import time
from datetime import datetime, timezone

import requests

import config
from live_state import _plain

HEARTBEAT_SECONDS = 15
RETRY_SECONDS = 5
ROW_ID = "live"
NEWER_COLUMNS = ("mfe_r", "mae_r", "context")  # journal columns added by supabase/analysis.sql
MEMORY_ROW = "memory"  # the bot's own memory (open trade, sessions traded), for restarts

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
        self._journal = []  # signal rows waiting to be saved
        self._memory = None  # latest bot memory to save
        self._memory_sig = None
        self._chat = []  # bot messages waiting to be posted in the website chat
        self._rooms = {}  # chat room name -> id
        self._minutes = []  # live market minutes waiting to be saved
        self._minutes_sent = time.time()
        self._minutes_paused_until = 0.0
        if self.enabled:
            threading.Thread(target=self._run, name="cloud", daemon=True).start()

    def publish(self, state):
        """Hand over the latest state; the background thread decides whether to send it."""
        if not self.enabled:
            return
        with self._lock:
            self._latest = state
        self._wake.set()

    def journal(self, events):
        """Queue signal events to be saved permanently (duplicates are ignored by Supabase)."""
        if not self.enabled:
            return
        rows = [journal_row(e) for e in events]
        with self._lock:
            self._journal.extend(rows)
        self._wake.set()

    def _send_journal(self):
        with self._lock:
            rows, self._journal = self._journal, []
        if not rows:
            return
        try:
            headers = {**self._headers(), "Prefer": "resolution=ignore-duplicates,return=minimal"}
            send = lambda batch: requests.post(f"{self.url}/rest/v1/signals?on_conflict=event_id",  # noqa: E731
                                               headers=headers, data=json.dumps(batch, default=_plain), timeout=10)
            r = send(rows)
            if r.status_code >= 300 and "PGRST204" in r.text:
                # supabase/analysis.sql not run yet: save without the newer columns
                r = send([{k: v for k, v in row.items() if k not in NEWER_COLUMNS} for row in rows])
            if r.status_code >= 300:
                raise RuntimeError(f"Supabase answered {r.status_code}: {r.text[:200]}")
        except (requests.RequestException, RuntimeError) as e:
            with self._lock:
                self._journal = rows + self._journal  # keep them for the next try
            if not self._failing:
                print(f"{datetime.now():%H:%M:%S} Supabase journal: can't save signals yet ({e}); retrying")
            self._failing = True
            self._stop.wait(RETRY_SECONDS)

    def post_chat(self, body, room=None):
        """Post a message in the website chat as the bot (queued and retried like the journal)."""
        if not self.enabled:
            return
        with self._lock:
            self._chat.append((body[:1000], room or config.RECAP_ROOM))
        self._wake.set()

    def _send_chat(self):
        with self._lock:
            queued, self._chat = self._chat, []
        for i, (body, room) in enumerate(queued):
            try:
                room_id = self._room(room)
                r = requests.post(f"{self.url}/rest/v1/chat_messages", headers=self._headers(),
                                  data=json.dumps({"room_id": room_id, "author": config.RECAP_AUTHOR,
                                                   "body": body}), timeout=10)
                if r.status_code >= 300:
                    raise RuntimeError(f"Supabase answered {r.status_code}: {r.text[:200]}")
            except (requests.RequestException, RuntimeError, ValueError) as e:
                with self._lock:
                    self._chat = queued[i:] + self._chat  # try again on the next pass
                print(f"{datetime.now():%H:%M:%S} chat recap not posted yet ({e}); retrying")
                self._stop.wait(RETRY_SECONDS)
                return

    def record_minute(self, row):
        """Queue one minute of live prices (saved in batches every few minutes)."""
        if not self.enabled or time.time() < self._minutes_paused_until:
            return
        with self._lock:
            self._minutes = (self._minutes + [row])[-2000:]  # cap if Supabase is down for a long time

    def _send_minutes(self):
        with self._lock:
            rows = self._minutes
        if not rows or (len(rows) < 5 and time.time() - self._minutes_sent < 300):
            return
        try:
            headers = {**self._headers(), "Prefer": "resolution=ignore-duplicates,return=minimal"}
            r = requests.post(f"{self.url}/rest/v1/market_minutes?on_conflict=minute", headers=headers,
                              data=json.dumps(rows), timeout=15)
            if r.status_code == 404 or "PGRST205" in r.text:
                print("market_minutes table missing: run supabase/market-data.sql to start saving live data; "
                      "trying again in an hour")
                with self._lock:
                    self._minutes = []
                self._minutes_paused_until = time.time() + 3600
                return
            if r.status_code >= 300:
                raise RuntimeError(f"Supabase answered {r.status_code}: {r.text[:200]}")
            with self._lock:
                self._minutes = self._minutes[len(rows):]
            self._minutes_sent = time.time()
        except (requests.RequestException, RuntimeError) as e:
            print(f"{datetime.now():%H:%M:%S} market data not saved yet ({e}); retrying")

    def load_minutes(self, days=14):
        """The live market minutes saved in the last `days` days, oldest first ([] if none or no table)."""
        if not self.enabled:
            return []
        since = datetime.fromtimestamp(time.time() - days * 86400, timezone.utc).isoformat()
        rows, page = [], 1000
        try:
            while True:
                r = requests.get(f"{self.url}/rest/v1/market_minutes",
                                 params={"minute": f"gte.{since}", "order": "minute", "select": "*",
                                         "limit": page, "offset": len(rows)},
                                 headers=self._headers(), timeout=20)
                if r.status_code >= 300:
                    break
                batch = r.json()
                rows += batch
                if len(batch) < page:
                    break
        except (requests.RequestException, ValueError) as e:
            print(f"Couldn't load saved market minutes ({e}); real candles rebuild from live prices")
        return rows

    def _room(self, name):
        """The id of the chat room called `name`, creating the room if it doesn't exist yet."""
        if name not in self._rooms:
            find = lambda: requests.get(f"{self.url}/rest/v1/chat_rooms",  # noqa: E731
                                        params={"name": f"eq.{name}", "select": "id"},
                                        headers=self._headers(), timeout=10).json()
            rows = find()
            if not rows:
                requests.post(f"{self.url}/rest/v1/chat_rooms", headers=self._headers(), timeout=10,
                              data=json.dumps({"name": name, "created_by": config.RECAP_AUTHOR}))
                rows = find()
            if not rows:
                raise RuntimeError(f"couldn't find or create the chat room {name!r}")
            self._rooms[name] = rows[0]["id"]
        return self._rooms[name]

    def remember(self, memory):
        """Keep a copy of the bot's memory in Supabase (sent only when it changes)."""
        if not self.enabled:
            return
        with self._lock:
            self._memory = memory
        self._wake.set()

    def load_memory(self):
        """The memory saved by an earlier run, or None."""
        if not self.enabled:
            return None
        try:
            r = requests.get(f"{self.url}/rest/v1/bot_state", params={"id": f"eq.{MEMORY_ROW}", "select": "data"},
                             headers=self._headers(), timeout=10)
            rows = r.json() if r.ok else []
            return rows[0]["data"] if rows else None
        except (requests.RequestException, ValueError, KeyError, IndexError) as e:
            print(f"Supabase: couldn't load the saved memory ({e}); starting fresh")
            return None

    def _send_memory(self):
        with self._lock:
            memory = self._memory
        if memory is None:
            return
        sig = json.dumps(memory, sort_keys=True, default=_plain)
        if sig == self._memory_sig:
            return
        body = {"id": MEMORY_ROW, "data": memory, "updated_at": datetime.now(timezone.utc).isoformat()}
        try:
            r = requests.post(f"{self.url}/rest/v1/bot_state", headers=self._headers(),
                              data=json.dumps(body, default=_plain), timeout=10)
            if r.status_code < 300:
                self._memory_sig = sig
        except requests.RequestException:
            pass  # tried again on the next pass

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
            self._send_journal()
            self._send_memory()
            self._send_chat()
            self._send_minutes()
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


def journal_row(event):
    """A bot history event -> a row of the `signals` table."""
    size = event.get("size") or {}
    return {
        "event_id": event["id"],
        # an open is its own trade; a close points back at the open
        "trade_id": event.get("trade_id") or (event["id"] if event["type"] == "open" else None),
        "type": event["type"],
        "side": event["side"],
        "strategy": event.get("strategy"),
        "session": event.get("session"),
        "symbol": event.get("symbol"),
        "timeframe": event.get("timeframe"),
        "price": event["price"],
        "entry": event.get("entry"),
        "sl": event.get("sl"),
        "tp": event.get("tp"),
        "lots": event.get("lots") or size.get("lots"),
        "risk": size.get("risk"),
        "pnl": event.get("pnl"),
        "pnl_usd": event.get("pnl_usd"),
        "reason": event.get("reason"),
        "mfe_r": event.get("mfe_r"),
        "mae_r": event.get("mae_r"),
        "context": event.get("context"),
        "created_at": datetime.fromtimestamp(event["time"], timezone.utc).isoformat(),
    }
