"""Price accuracy check: how far are the PAXG-based candles from real XAUUSD?

The free candle history is PAXG (a gold token) shifted to spot. Wherever the bot recorded real XAUUSD
quotes (Swissquote, every minute: market_recorder.py / real_candles.py) those replace PAXG, but any
stretch the bot wasn't running still uses PAXG. A breakout is a close above a high, so a PAXG candle a
few dollars off could fire a signal early or late.

Once a day this compares, for the recent closed daily and 4-hour candles that were recorded almost
completely, the PAXG version with the real one, and reports the biggest difference in high / low /
close, plus how many recent candles are real. A chat message goes out when the difference starts or
stops being too big.
"""
import time

import numpy as np
import pandas as pd

import real_candles

FULL = 0.9               # a candle counts when at least 90% of its minutes were recorded
TOLERANCE_USD = 3.0      # differences up to max(this, TOLERANCE_PCT of price) are normal
TOLERANCE_PCT = 0.08
LOOK = {"D1": 10, "H4": 60}  # recent closed candles examined


def compare(raw, timeframe):
    """For each closed candle with nearly full real coverage: biggest |PAXG - real| in high/low/close."""
    out, real = [], 0
    for _, row in raw.tail(LOOK[timeframe]).iterrows():
        bar = real_candles.real_bar(int(row["time"].timestamp()), timeframe)
        if not bar:
            continue
        o, h, lo, c, cover = bar
        if cover >= real_candles.COVERAGE:
            real += 1
        if cover < FULL:
            continue
        diffs = {"high": row["high"] - h, "low": row["low"] - lo, "close": row["close"] - c}
        worst = max(diffs, key=lambda k: abs(diffs[k]))
        out.append({"candle": timeframe, "time": int(row["time"].timestamp()), "field": worst,
                    "diff": round(float(diffs[worst]), 2), "price": round(float(c), 2)})
    return out, real


def check(raw_bars, symbol, now=None, source="PAXG"):
    """raw_bars(symbol, timeframe, count) -> the candle source alone. Returns a summary for the website."""
    now = int(now or time.time())
    rows, share = [], {}
    for tf, n in LOOK.items():
        raw = raw_bars(symbol, tf, n + 2)
        r, real = compare(raw, tf)
        rows += r
        share[tf] = round(100 * real / max(1, min(n, len(raw))))
    result = {"checked": now, "rows": len(rows), "real_share": share, "source": source}
    if not rows:
        result["ok"] = None  # not enough fully recorded candles yet (e.g. right after a restart)
        return result
    worst = max(rows, key=lambda r: abs(r["diff"]))
    allowed = max(TOLERANCE_USD, TOLERANCE_PCT / 100 * worst["price"])
    result.update(ok=abs(worst["diff"]) <= allowed, worst=worst, allowed=round(allowed, 2),
                  avg_abs=round(float(np.mean([abs(r["diff"]) for r in rows])), 2))
    return result


def message(result, was_ok):
    """A Bot status chat message when the check starts or stops failing (None otherwise)."""
    if result.get("ok") is False and was_ok is not False:
        w = result["worst"]
        when = pd.Timestamp(w["time"], unit="s", tz="UTC").strftime("%a %d %b %H:%M UTC")
        return (f"Price check: the {result.get('source', 'PAXG')}-based {w['candle']} candle of {when} differs from real XAUUSD by "
                f"${abs(w['diff']):.2f} in its {w['field']} (normal: up to ${result['allowed']:.2f}). Candles the bot "
                f"didn't record ({100 - result['real_share']['D1']}% of recent days, "
                f"{100 - result['real_share']['H4']}% of recent 4-hour candles) may trigger breakouts early or late.")
    if result.get("ok") is True and was_ok is False:
        return (f"Price check OK again: {result.get('source', 'PAXG')}-based candles match real XAUUSD within ${result['allowed']:.2f} "
                f"(average difference ${result['avg_abs']:.2f}).")
    return None
