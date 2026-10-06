"""Saves a one-minute summary of every live price the bot sees, to build fresh data for future tests.

The research has used up 2003-2026 as test data, so new strategy ideas need prices from after
Sep 2026 - with the real spread at each moment. Each minute becomes one row in the Supabase
`market_minutes` table (supabase/market-data.sql): bid open/high/low/close, the last ask, average and
widest spread, how many prices were seen, and the PAXG-to-spot gap in use.
"""
import time

MINUTE = 60


class MinuteRecorder:
    def __init__(self, gap=None):
        self.gap = gap  # function returning the current PAXG-above-spot shift, or None
        self.bucket = None

    def tick(self, bid, ask, now=None):
        """Add one price; returns the finished minute's row when a new minute starts, else None."""
        now = now or time.time()
        minute = int(now // MINUTE) * MINUTE
        done = None
        if self.bucket and self.bucket["minute"] != minute:
            done = self._row()
            self.bucket = None
        spread = ask - bid
        b = self.bucket
        if b is None:
            self.bucket = {"minute": minute, "open": bid, "high": bid, "low": bid, "close": bid, "ask": ask,
                           "spread_sum": spread, "spread_max": spread, "ticks": 1}
        else:
            b["high"], b["low"], b["close"], b["ask"] = max(b["high"], bid), min(b["low"], bid), bid, ask
            b["spread_sum"] += spread
            b["spread_max"] = max(b["spread_max"], spread)
            b["ticks"] += 1
        return done

    def _row(self):
        b = self.bucket
        gap = None
        if self.gap:
            try:
                gap = round(float(self.gap()), 2)
            except Exception:  # never let recording disturb the bot
                gap = None
        return {
            "minute": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(b["minute"])),
            "bid_open": round(b["open"], 2), "bid_high": round(b["high"], 2),
            "bid_low": round(b["low"], 2), "bid_close": round(b["close"], 2),
            "ask_close": round(b["ask"], 2),
            "spread_avg": round(b["spread_sum"] / b["ticks"], 3), "spread_max": round(b["spread_max"], 3),
            "ticks": b["ticks"], "paxg_gap": gap,
        }
