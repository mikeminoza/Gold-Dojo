"""A tiny web page that says whether the bot is alive - for hosting on Render (free web service).

Render only runs web services, and puts free ones to sleep after 15 minutes without visits, so a free
pinger (cron-job.org) visits /health every 10 minutes. The page answers 503 (and Render restarts the
bot by itself) when the price loop stops for over STALL_SECONDS, or keeps failing / can't get prices
for over STUCK_SECONDS. When only Supabase (the website's database) can't be reached it still answers
200 (a restart wouldn't help) but says "ok": false, so an uptime monitor watching for "ok": true
emails you.

Only started when the PORT environment variable is set (Render sets it; your PC doesn't).
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STALL_SECONDS = 90
STUCK_SECONDS = 300     # failing or waiting for prices this long = stuck
CLOUD_SECONDS = 600     # no successful Supabase write this long = the website is stale


class Health:
    def __init__(self):
        self.started = time.time()
        self.beat = time.time()
        self.info = {}
        self.failing_since = None   # first pass of the current run of failures / waiting for prices
        self.cloud = None           # set by the bot: its Supabase publisher (for last_ok)

    def touch(self, **info):
        """Call on every pass of the bot's main loop."""
        now = time.time()
        self.beat = now
        self.info.update(info)
        bad = bool(info.get("waiting_for_prices"))
        if bad and self.failing_since is None:
            self.failing_since = now
        elif not bad:
            self.failing_since = None

    def problem(self):
        """(problem in plain words, restart_helps) or (None, False) when all is well."""
        now = time.time()
        if now - self.beat > STALL_SECONDS:
            return f"the main loop stopped {now - self.beat:.0f} s ago", True
        if self.failing_since and now - self.failing_since > STUCK_SECONDS:
            return f"failing / no prices for {(now - self.failing_since) / 60:.0f} min", True
        last_ok = getattr(self.cloud, "last_ok", None)
        if last_ok and now - last_ok > CLOUD_SECONDS:
            return f"can't reach Supabase for {(now - last_ok) / 60:.0f} min (the website is stale)", False
        return None, False

    def status(self):
        age = time.time() - self.beat
        problem, restart = self.problem()
        return {
            "ok": problem is None,
            "problem": problem,
            "restart": restart,
            "last_loop_seconds_ago": round(age, 1),
            "up_minutes": round((time.time() - self.started) / 60, 1),
            **self.info,
        }

    def serve(self, port):
        health = self

        class Handler(BaseHTTPRequestHandler):
            def _answer(self, with_body):
                status = health.status()
                body = json.dumps(status, default=str).encode()
                self.send_response(503 if status["restart"] else 200)  # 503 = Render restarts the bot
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if with_body:
                    self.wfile.write(body)

            def do_GET(self):
                self._answer(True)

            def do_HEAD(self):
                self._answer(False)

            def log_message(self, *args):  # keep the bot's log clean
                pass

        server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
        print(f"Health page on port {port} (/health)")
        return server
