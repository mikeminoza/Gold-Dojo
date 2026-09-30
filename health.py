"""A tiny web page that says whether the bot is alive - for hosting on Render (free web service).

Render only runs web services, and puts free ones to sleep after 15 minutes without visits, so a free
pinger (cron-job.org) visits /health every 10 minutes. If the bot's price loop stops for over
STALL_SECONDS the page answers 503, and Render restarts the bot by itself.

Only started when the PORT environment variable is set (Render sets it; your PC doesn't).
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STALL_SECONDS = 90


class Health:
    def __init__(self):
        self.started = time.time()
        self.beat = time.time()
        self.info = {}

    def touch(self, **info):
        """Call on every pass of the bot's main loop."""
        self.beat = time.time()
        self.info.update(info)

    def status(self):
        age = time.time() - self.beat
        return {
            "ok": age < STALL_SECONDS,
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
                self.send_response(200 if status["ok"] else 503)
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
