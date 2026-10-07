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

4-hour trend mode (H4_RULES) is the same breakout rule on 4-hour candles with a wider 3 x ATR20 stop
and trail (research/h4_drift.py): about 14 trades a year. Near break-even in 2003-2018, profitable in
2019-2026, so most of its profit came from gold's recent rise.

Tracked forward from the day the bot starts tracking (never back-filled), with the same estimated
costs as the research (spread, slippage, overnight financing), so the record is an honest one.
"""
import time

import numpy as np

STOP_K = 2.0
ATR_N = 20
SPREAD, SLIPPAGE, SWAP_PER_NIGHT = 0.50, 0.20, 0.0002
KEEP = 200  # closed trades remembered (the website compares them with the backtest)
NEAR_PCT = 1.0  # warn once when price is this close (%) below a breakout trigger

RULES = {
    "breakout": "100-day breakout",
    "pullback": "Trend pullback",
}
H4_RULES = {"h4breakout": "4-hour breakout"}
NAMES = {**RULES, **H4_RULES}
KIND = {"breakout": "breakout", "pullback": "pullback", "h4breakout": "breakout"}
STOP = {"breakout": STOP_K, "pullback": STOP_K, "h4breakout": 3.0}  # x ATR20, initial stop and trail


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
    if KIND[rule] == "breakout":
        hh = d["hh100"].iat[i]
        return bool(np.isfinite(hh) and c > hh)
    up = d["sma50"].iat[i] > d["sma200"].iat[i]
    prev_below = d["close"].iat[i - 1] <= d["ema20"].iat[i - 1]
    return bool(np.isfinite(d["sma200"].iat[i]) and up and prev_below and c > d["ema20"].iat[i])


def trigger(rule, d):
    """The price level the rule is waiting for (None if it isn't a single price), from the latest day."""
    last = d.iloc[-1]
    if KIND[rule] == "breakout":
        return round(float(d["high"].iloc[-100:].max()), 2)
    if np.isfinite(last["sma200"]) and last["sma50"] > last["sma200"]:
        return round(float(last["ema20"]), 2)
    return None


def waiting_for(rule, d):
    """Plain words: what the rule is waiting for, from the latest closed candle."""
    last = d.iloc[-1]
    if rule == "h4breakout":
        return f"a 4-hour close above {d['high'].iloc[-100:].max():.2f} (the 100-candle high)"
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
        self.k = STOP[rule]
        self.pending = m.get("pending", False)
        self.position = m.get("position")
        self.trades = m.get("trades", [])

    def memory(self):
        return {"pending": self.pending, "position": self.position, "trades": self.trades}

    def day(self, d, i, day, events):
        o, h, lo, c = (float(d[k].iat[i]) for k in ("open", "high", "low", "close"))
        atr, prev_atr = float(d["atr"].iat[i]), float(d["atr"].iat[i - 1])
        if self.position is None and self.pending:
            dist = self.k * prev_atr
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
                p["stop"] = round(max(p["stop"], p["best"] - self.k * atr), 2)
        if self.position is None and signal(self.rule, d, i):
            self.pending = True

    def _close(self, day, price, reason, events):
        p = self.position
        nights = max(0, day // 86400 - p["opened"] // 86400)  # rollovers passed (UTC dates)
        net = (price - p["entry"]) - SPREAD - 2 * SLIPPAGE - SWAP_PER_NIGHT * p["entry"] * nights
        trade = {"id": f"dt-{self.rule}-{p['opened']}", "entry": p["entry"], "exit": round(price, 2), "opened": p["opened"], "closed": day,
                 "nights": nights, "reason": reason, "pnl": round(net, 2), "r": round(net / p["risk"], 2)}
        self.trades = (self.trades + [trade])[-KEEP:]
        self.position = None
        events.append({"rule": self.rule, "type": "close", **trade})


class DailyTrend:
    """A set of rules (RULES on daily candles, H4_RULES on 4-hour candles), fed the bot's closed candles;
    remembers its state across restarts."""

    def __init__(self, memory=None, rules=None):
        m = memory or {}
        self.names = rules or RULES
        self.last_day = m.get("last_day")
        self.started = m.get("started")
        self.rules = {r: Rule(r, (m.get("rules") or {}).get(r)) for r in self.names}
        self.waiting = {}
        self.triggers = {}
        self.levels = {}
        self.warned = m.get("warned") or {}  # rule -> trigger already warned about

    def memory(self):
        return {"last_day": self.last_day, "started": self.started, "warned": self.warned,
                "rules": {r: x.memory() for r, x in self.rules.items()}}

    def gap_pct(self, rule, bid):
        """How far (%) price is below a breakout rule's trigger (None for other rules)."""
        trig = self.triggers.get(rule)
        if KIND[rule] != "breakout" or trig is None or bid is None:
            return None
        return round(100 * (trig - bid) / trig, 2)

    def near(self, bid):
        """Breakout rules whose trigger price is now within NEAR_PCT %, once per trigger level.
        Re-arms when price drops back more than twice that far."""
        out = []
        for r, x in self.rules.items():
            gap = self.gap_pct(r, bid)
            if gap is None or x.position or x.pending:
                continue
            if 0 < gap <= NEAR_PCT and self.warned.get(r) != self.triggers[r]:
                self.warned[r] = self.triggers[r]
                out.append({"rule": r, "trigger": self.triggers[r], "gap_pct": gap})
            elif gap > 2 * NEAR_PCT:
                self.warned.pop(r, None)
        return out

    def update(self, daily):
        """Process new closed days; returns paper-trade events (opens / closes) for announcements."""
        if daily is None or len(daily) < 60:
            return []
        d = prepare(daily)
        days = [int(t.timestamp()) for t in d["time"]]
        self.waiting = {r: waiting_for(r, d) for r in self.names}
        self.triggers = {r: trigger(r, d) for r in self.names}
        last = d.iloc[-1]
        self.levels = {k: (round(float(last[k]), 2) if np.isfinite(last[k]) else None)
                       for k in ("ema20", "sma50", "sma200")}
        self.levels["hh100"] = round(float(d["high"].iloc[-100:].max()), 2)
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
                pos["id"] = f"dt-{r}-{p['opened']}"
                nights = max(0, round((time.time() - p["opened"]) / 86400))
                pos["nights"] = nights
                pos["swap_oz"] = round(SWAP_PER_NIGHT * p["entry"] * nights, 2)  # estimated financing so far
                if bid is not None:
                    pos["r_now"] = round((bid - p["entry"]) / p["risk"], 2)
            trig = self.triggers.get(r)
            out.append({
                "id": r, "name": NAMES[r], "position": pos, "pending": x.pending, "trigger": trig,
                "waiting": self.waiting.get(r), "trades": x.trades[-10:][::-1], "count": len(rs),
                "total_r": round(sum(rs), 2), "win_rate": round(100 * sum(v > 0 for v in rs) / len(rs)) if rs else None,
                "profit_factor": round(won / lost, 2) if lost else None,
                "rs": rs, "gap_pct": self.gap_pct(r, bid),
            })
        return {"started": self.started, "rules": out, "levels": self.levels, "swap_per_night": SWAP_PER_NIGHT,
                "near_pct": NEAR_PCT}


def replay(daily, names=None):
    """Every trade the rules would have made over `daily` (for the backtest page), oldest first."""
    names = names or RULES
    d = prepare(daily)
    days = [int(t.timestamp()) for t in d["time"]]
    rules = {r: Rule(r) for r in names}
    for x in rules.values():
        x.trades = []
    out = {r: [] for r in names}
    for i in range(1, len(d)):
        events = []
        for x in rules.values():
            x.day(d, i, days[i], events)
        for e in events:
            if e["type"] == "close":
                out[e["rule"]].append({k: e[k] for k in ("entry", "exit", "opened", "closed", "nights", "reason", "r")})
    return out
