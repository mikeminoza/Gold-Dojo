"""Paper tracking of the daily swing candidate from docs/swing-research.md (S1: 100-day breakout,
2 x ATR20 stop that trails behind the best price). Nothing here is a signal: it only records what the
rule would have done, going forward from the day tracking started, so it can be re-tested later
against the backtest and against simply holding gold.

Same steps as research/swing.py, once per closed daily candle:
  entry at this day's open (signal from yesterday's close) -> stop hit during the day? -> trail the
  stop for tomorrow -> new signal at this close (only when flat).
Costs are estimated like the research: spread + 2 x slippage + financing per night held.
"""
import time

import numpy as np

import config

N, STOP_K, ATR_N = config.SWING_CHANNEL_DAYS, config.SWING_STOP_ATR, config.SWING_ATR_PERIOD
SLIPPAGE, SWAP_PER_NIGHT, SPREAD = 0.20, 0.0002, 0.40
MIN_STOP = config.MIN_STOP_DISTANCE
KEEP = 50  # closed paper trades kept in memory (and shown on the website)


def _atr(d):
    prev = d["close"].shift(1)
    tr = np.maximum(d["high"] - d["low"], np.maximum((d["high"] - prev).abs(), (d["low"] - prev).abs()))
    return tr.ewm(alpha=1 / ATR_N, adjust=False).mean()


class SwingPaper:
    def __init__(self, memory=None):
        m = memory or {}
        self.last_day = m.get("last_day")      # UTC seconds of the last daily candle processed
        self.pending = m.get("pending", 0)     # +1 / -1: enter at the next open
        self.position = m.get("position")
        self.trades = m.get("trades", [])
        self.started = m.get("started")

    def memory(self):
        return {"last_day": self.last_day, "pending": self.pending, "position": self.position,
                "trades": self.trades, "started": self.started}

    def update(self, daily):
        """Process any closed daily candles not seen yet. `daily`: the bot's D1 bars (closed only)."""
        if daily is None or len(daily) < N + ATR_N + 2:
            return
        d = daily.reset_index(drop=True).copy()
        d["atr"] = _atr(d)
        d["hh"] = d["high"].shift(1).rolling(N).max()
        d["ll"] = d["low"].shift(1).rolling(N).min()
        days = [int(t.timestamp()) for t in d["time"]]
        if self.last_day is None:  # first run: start tracking from now, never back-fill a record
            self.last_day, self.started = days[-1], int(time.time())
            return
        for i in range(len(d)):
            if days[i] > self.last_day:
                self._day(d, i, days[i])
                self.last_day = days[i]

    def _day(self, d, i, day):
        o, h, lo, c, atr = (float(d[k].iat[i]) for k in ("open", "high", "low", "close", "atr"))
        prev_atr = float(d["atr"].iat[i - 1])
        if self.position is None and self.pending:
            side, dist = self.pending, STOP_K * prev_atr
            if dist >= MIN_STOP:
                sl = o - side * dist
                self.position = {"side": side, "entry": o, "sl": sl, "stop": sl, "risk": dist, "best": o,
                                 "opened": day}
        self.pending = 0
        p = self.position
        if p is not None:
            s = p["side"]
            if day > p["opened"] and ((o <= p["stop"]) if s > 0 else (o >= p["stop"])):
                self._close(day, o, "Stop (gap)")
            elif (lo <= p["stop"]) if s > 0 else (h >= p["stop"]):
                self._close(day, p["stop"], "Stop" if p["stop"] == p["sl"] else "Trailing stop")
            else:
                p["best"] = max(p["best"], h) if s > 0 else min(p["best"], lo)
                cand = p["best"] - s * STOP_K * atr
                p["stop"] = max(p["stop"], cand) if s > 0 else min(p["stop"], cand)
        if self.position is None and not np.isnan(d["hh"].iat[i]):
            self.pending = 1 if c > d["hh"].iat[i] else -1 if c < d["ll"].iat[i] else 0

    def _close(self, day, price, reason):
        p = self.position
        nights = max(0, round((day - p["opened"]) / 86400))
        gross = p["side"] * (price - p["entry"])
        costs = SPREAD + 2 * SLIPPAGE + SWAP_PER_NIGHT * p["entry"] * nights
        net = gross - costs
        self.trades = (self.trades + [{
            "side": "BUY" if p["side"] > 0 else "SELL", "entry": round(p["entry"], 2), "exit": round(price, 2),
            "opened": p["opened"], "closed": day, "nights": nights, "reason": reason,
            "pnl": round(net, 2), "r": round(net / p["risk"], 2),
        }])[-KEEP:]
        self.position = None

    def summary(self):
        """For the website: the open paper trade and the closed ones, results in R (risk units)."""
        rs = [t["r"] for t in self.trades]
        won, lost = sum(r for r in rs if r > 0), -sum(r for r in rs if r < 0)
        pos = self.position and {k: self.position[k] for k in ("side", "entry", "stop", "risk", "opened")}
        return {
            "rule": f"{N}-day breakout, {STOP_K:g} x ATR{ATR_N} trailing stop (paper only)",
            "started": self.started, "position": pos, "trades": self.trades[-20:][::-1],
            "count": len(rs), "total_r": round(sum(rs), 2), "win_rate": round(100 * sum(r > 0 for r in rs) / len(rs)) if rs else None,
            "profit_factor": round(won / lost, 2) if lost else None,
        }
