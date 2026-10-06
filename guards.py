"""Safety checks around the signals: drift alarm, overall risk cap, silence alarm.

- Drift alarm: are live results within what the backtest expects? Live total R is compared with
  thousands of random same-length stretches of backtest trades; below the DRIFT_PERCENTILE-th
  percentile means "worse than the backtest would normally produce" - something may differ live.
- Risk cap: the total risk of open trades (the New York signal plus Daily trend paper trades) never
  goes above MAX_TOTAL_RISK_PCT of the account.
- Silence alarm: during market hours, no real price or no processed candle for too long.
"""
import random

import config


def drift_percentile(live, pool, runs=2000, seed=7):
    """Where the live total R sits (0-100) among random stretches of len(live) backtest trades."""
    if not live or len(pool) < 30:
        return None
    rng = random.Random(seed)
    total = sum(live)
    n = len(live)
    below = sum(sum(rng.choice(pool) for _ in range(n)) < total for _ in range(runs))
    return round(100 * below / runs)


def drift_verdict(live, pool):
    """None while there are too few trades to judge, else (percentile, too_bad)."""
    if len(live) < config.DRIFT_MIN_TRADES:
        return None
    pct = drift_percentile(live, pool)
    if pct is None:
        return None
    return pct, pct < config.DRIFT_PERCENTILE


def open_risk_pct(ny_position, trend_positions):
    """Total % of the account at risk in open trades: the New York trade's suggested size plus 1% for
    each Daily trend paper trade (they're sized at 1%)."""
    ny = (ny_position or {}).get("size", {}).get("risk_percent", config.RISK_PERCENT) if ny_position else 0.0
    return ny + config.RISK_PERCENT * len(trend_positions)


def risk_cap_reason(ny_position, trend_positions, new_risk_pct):
    """A reason to skip a new trade if it would take total open risk above the cap, else None."""
    total = open_risk_pct(ny_position, trend_positions) + new_risk_pct
    if total > config.MAX_TOTAL_RISK_PCT + 1e-9:
        return f"total open risk would be {total:.1f}% (cap {config.MAX_TOTAL_RISK_PCT:g}%)"
    return None


class Silence:
    """Notices when prices or candles stop during market hours, and when they come back."""

    def __init__(self):
        self.last_price = None   # time of the last real price
        self.alarmed = None      # what we're alarmed about, or None

    def price(self, now):
        self.last_price = now

    def check(self, now, market_open, last_candle_end):
        """Returns a message to post when an alarm starts or ends, else None."""
        problem = None
        if market_open:
            if self.last_price is not None and now - self.last_price > config.SILENCE_PRICE_SECONDS:
                problem = f"no real gold price for {round((now - self.last_price) / 60)} min"
            elif last_candle_end is not None and now - last_candle_end > config.SILENCE_CANDLE_SECONDS:
                problem = f"no new candle processed for {round((now - last_candle_end) / 60)} min"
        if problem and not self.alarmed:
            self.alarmed = problem
            return f"Bot alert: {problem} during market hours. Signals may be delayed; checking automatically."
        if not problem and self.alarmed:
            was, self.alarmed = self.alarmed, None
            return f"Bot recovered: prices and candles are flowing again (was: {was})."
        return None
