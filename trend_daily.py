"""Daily trend mode: two long-only rules on daily gold candles, forward-tested on paper.

From docs/swing-research.md, the only rules that made money in both the training years (2003-2018)
and the unseen years (2019-2026), after costs:
  - breakout: buy when the day closes above the previous 100 days' high
  - pullback: in an uptrend (50-day average above the 200-day), buy when price dips to the 20-day
    average and closes back above it
Both enter at the next day's open, start with a stop 2 x ATR20 below, and trail it 2 x ATR20 below
the highest price since entry. Long only (shorts lost money in the research). A few trades a year,
held for days to weeks. They made money mostly because gold rose over time: in a long downtrend
they mostly sit out.

Tracked forward from the day the bot starts tracking (never back-filled), with the same estimated
costs as the research (spread, slippage, overnight financing), so the record is an honest one.
"""
import time

import numpy as np

STOP_K = 2.0
ATR_N = 20
SPREAD, SLIPPAGE, SWAP_PER_NIGHT = 0.50, 0.20, 0.0002
KEEP = 30

RULES = {
    "breakout": "100-day breakout",
    "pullback": "Trend pullback",
}


def _atr(d):
    prev = d["close"].shift(1)
    tr = np.maximum(d["high"] - d["low"], np.maximum((d["high"] - prev).abs(), (d["low"] - prev).abs()))
    return tr.ewm(alpha=1 / ATR_N, adjust=False).mean()


def prepare(daily):
    d = daily.reset_index(drop=True).copy()
    d["atr"] = _atr(d)
    d["hh100"] = d["high"].shift(1).rolling(100).max()
    d["sma50"] = d["close"].rolling(50).mean()
    d["sma200"] = d["close"].rolling(200).mean()
    d["ema20"] = d["close"].ewm(span=20, adjust=False).mean()
    return d


def signal(rule, d, i):
    """True when the rule says buy at the next open, from candles up to and including day i."""
    c = d["close"].iat[i]
    if rule == "breakout":
        hh = d["hh100"].iat[i]
        return bool(np.isfinite(hh) and c > hh)
    up = d["sma50"].iat[i] > d["sma200"].iat[i]
    prev_below = d["close"].iat[i - 1] <= d["ema20"].iat[i - 1]
    return bool(np.isfinite(d["sma200"].iat[i]) and up and prev_below and c > d["ema20"].iat[i])


def waiting_for(rule, d):
    """Plain words: what the rule is waiting for, from the latest closed day."""
    last = d.iloc[-1]
    if rule == "breakout":
        return f"a daily close above {d['high'].iloc[-100:].max():.2f} (the 100-day high)"
    if not np.isfinite(last["sma200"]):
        return "enough history for the 200-day average"
    if last["sma50"] <= last["sma200"]:
        return "an uptrend (50-day average back above the 200-day)"
    return f"a dip to the 20-day average (~{last['ema20']:.2f}) and a close back above it"


class Rule:
    def __init__(self, rule, memory=None):
        m = memory or {}
        self.rule = rule
        self.pending = m.get("pending", False)
        self.position = m.get("position")
        self.trades = m.get("trades", [])

    def memory(self):
        return {"pending": self.pending, "position": self.position, "trades": self.trades}

    def day(self, d, i, day, events):
        o, h, lo, c = (float(d[k].iat[i]) for k in ("open", "high", "low", "close"))
        atr, prev_atr = float(d["atr"].iat[i]), float(d["atr"].iat[i - 1])
        if self.position is None and self.pending:
            dist = STOP_K * prev_atr
            self.position = {"entry": round(o, 2), "sl": round(o - dist, 2), "stop": round(o - dist, 2),
                             "risk": round(dist, 2), "best": o, "opened": day}
            events.append({"rule": self.rule, "type": "open", **self.position})
        self.pending = False
        p = self.position
        if p is not None:
            if day > p["opened"] and o <= p["stop"]:
                self._close(day, o, "Stop (gap)", events)
            elif lo <= p["stop"]:
                self._close(day, p["stop"], "Trailing stop" if p["stop"] > p["sl"] else "Stop", events)
            else:
                p["best"] = max(p["best"], h)
                p["stop"] = round(max(p["stop"], p["best"] - STOP_K * atr), 2)
        if self.position is None and signal(self.rule, d, i):
            self.pending = True

    def _close(self, day, price, reason, events):
        p = self.position
        nights = max(0, round((day - p["opened"]) / 86400))
        net = (price - p["entry"]) - SPREAD - 2 * SLIPPAGE - SWAP_PER_NIGHT * p["entry"] * nights
        trade = {"entry": p["entry"], "exit": round(price, 2), "opened": p["opened"], "closed": day,
                 "nights": nights, "reason": reason, "pnl": round(net, 2), "r": round(net / p["risk"], 2)}
        self.trades = (self.trades + [trade])[-KEEP:]
        self.position = None
        events.append({"rule": self.rule, "type": "close", **trade})


class DailyTrend:
    """Both rules, fed the bot's closed daily candles; remembers its state across restarts."""

    def __init__(self, memory=None):
        m = memory or {}
        self.last_day = m.get("last_day")
        self.started = m.get("started")
        self.rules = {r: Rule(r, (m.get("rules") or {}).get(r)) for r in RULES}
        self.waiting = {}

    def memory(self):
        return {"last_day": self.last_day, "started": self.started,
                "rules": {r: x.memory() for r, x in self.rules.items()}}

    def update(self, daily):
        """Process new closed days; returns paper-trade events (opens / closes) for announcements."""
        if daily is None or len(daily) < 60:
            return []
        d = prepare(daily)
        days = [int(t.timestamp()) for t in d["time"]]
        self.waiting = {r: waiting_for(r, d) for r in RULES}
        if self.last_day is None:  # first run: start the forward test now, never back-fill
            self.last_day, self.started = days[-1], int(time.time())
            return []
        events = []
        for i in range(1, len(d)):
            if days[i] > self.last_day:
                for x in self.rules.values():
                    x.day(d, i, days[i], events)
                self.last_day = days[i]
        return events

    def summary(self, bid=None):
        out = []
        for r, x in self.rules.items():
            rs = [t["r"] for t in x.trades]
            won, lost = sum(v for v in rs if v > 0), -sum(v for v in rs if v < 0)
            pos = None
            if x.position:
                p = x.position
                pos = {k: p[k] for k in ("entry", "stop", "sl", "risk", "opened")}
                if bid is not None:
                    pos["r_now"] = round((bid - p["entry"]) / p["risk"], 2)
            out.append({
                "id": r, "name": RULES[r], "position": pos, "pending": x.pending,
                "waiting": self.waiting.get(r), "trades": x.trades[-10:][::-1], "count": len(rs),
                "total_r": round(sum(rs), 2), "win_rate": round(100 * sum(v > 0 for v in rs) / len(rs)) if rs else None,
                "profit_factor": round(won / lost, 2) if lost else None,
            })
        return {"started": self.started, "rules": out}
