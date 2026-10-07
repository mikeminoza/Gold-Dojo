"""Web push: the same alerts as Telegram, sent as phone / desktop notifications to everyone who turned
them on in the website (supabase/push.sql). Each browser picks which strategies it wants.

Needs on the host: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL (see make_vapid.py), plus the
Supabase settings the bot already has. Sending runs in a background thread so it never slows the bot;
subscriptions the browser has dropped (404 / 410) are deleted.
"""
import json
import os
import threading
import time

import requests

SUBS_REFRESH = 300  # seconds between re-reading the subscription list


class WebPush:
    def __init__(self, cloud):
        self.cloud = cloud
        self.private = os.getenv("VAPID_PRIVATE_KEY")
        self.email = os.getenv("VAPID_EMAIL") or "admin@example.com"
        self.subs, self.read_at = [], 0.0
        self.lock = threading.Lock()

    @property
    def enabled(self):
        return bool(self.private and self.cloud.enabled)

    def _rest(self, method, params=None, **kw):
        return requests.request(method, f"{self.cloud.url}/rest/v1/push_subscriptions", params=params,
                                headers=self.cloud._headers(), timeout=20, **kw)

    def _subscriptions(self):
        if time.time() - self.read_at > SUBS_REFRESH:
            r = self._rest("GET", {"select": "id,endpoint,p256dh,auth,strategies"})
            if r.ok:
                self.subs = r.json()
            self.read_at = time.time()
        return self.subs

    def send(self, strategy, text, title="Gold Dojo", tag="gold-dojo"):
        """strategy: 'trend' or 'h4' (only browsers following it get it), or None for everyone."""
        if not self.enabled:
            return
        threading.Thread(target=self._send, args=(strategy, text, title, tag), daemon=True).start()

    def _send(self, strategy, text, title, tag):
        from pywebpush import WebPushException, webpush
        with self.lock:
            try:
                subs = self._subscriptions()
            except requests.RequestException as e:
                print(f"web push: couldn't read subscriptions ({e})")
                return
            gone = []
            for s in subs:
                if strategy and strategy not in (s.get("strategies") or []):
                    continue
                try:
                    webpush({"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                            json.dumps({"title": title, "body": text[:240], "url": "/", "tag": tag}),
                            vapid_private_key=self.private, vapid_claims={"sub": f"mailto:{self.email}"},
                            ttl=12 * 3600, timeout=15)
                except WebPushException as e:
                    code = getattr(e.response, "status_code", None)
                    if code in (404, 410):
                        gone.append(s["id"])
                    else:
                        print(f"web push failed ({code}): {str(e)[:120]}")
                except Exception as e:  # one bad subscription must not stop the rest
                    print(f"web push failed: {str(e)[:120]}")
            if gone:
                self._rest("DELETE", {"id": f"in.({','.join(str(i) for i in gone)})"})
                self.subs = [s for s in self.subs if s["id"] not in gone]
