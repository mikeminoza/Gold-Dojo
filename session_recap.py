"""A short "what happened this session" message for the website chat, posted when a session ends.

Explains a trade's result, or why there was no trade: price stayed inside the opening range, the
breakout went against the daily trend, it came too late in the session, or the bot paused for news
or its loss limits.
"""
import loss_guard


def _price(p):
    return f"{p:.2f}"


def recap(df, sess_id, history, skipped=None):
    """The recap text for a finished session (rows of `df` tagged `sess_id`), or None."""
    rows = df[df["sess"] == sess_id]
    if rows.empty or rows["range_hi"].isna().all():
        return None
    name = rows["sess_name"].iat[0]
    hi, lo = rows["range_hi"].iat[0], rows["range_lo"].iat[0]
    trend = rows["trend"].iat[-1]
    trend_word = "up" if trend > 0 else "down" if trend < 0 else "flat"
    start, end = rows["time"].iat[0].timestamp(), rows["sess_end"].iat[0]
    head = f"{name} session recap: the opening range was {_price(lo)}-{_price(hi)}, daily trend {trend_word}."

    opened = next((e for e in history if e["type"] == "open" and start <= e["time"] <= end + 60), None)
    if opened:
        side = "Buy" if opened["side"] == "BUY" else "Sell"
        closed = next((e for e in history if e["type"] == "close" and e.get("trade_id") == opened["id"]), None)
        if not closed:
            return f"{head} {side} at {_price(opened['price'])} is still open."
        pnl = closed.get("pnl") or 0
        risk = closed.get("risk_oz") or (abs(opened["price"] - opened["sl"]) if opened.get("sl") else None)
        r = loss_guard.r_multiple(pnl, risk)
        result = "profit" if pnl > 0 else "loss" if pnl < 0 else "break-even"
        return (f"{head} {side} at {_price(opened['price'])}, closed at {_price(closed['price'])} "
                f"({(closed.get('reason') or 'closed').lower()}): {result} of {abs(pnl):.2f} per oz ({r:+.1f}R).")

    if skipped:
        return f"{head} A breakout signal came but was skipped: {skipped}."
    trade = rows[rows["phase"] == "trade"]
    up, down = (trade["close"] > hi).any(), (trade["close"] < lo).any()
    if not up and not down:
        return f"{head} No trade: price stayed inside the range all session."
    if (up and trend <= 0) and (down and trend >= 0):
        return f"{head} No trade: price broke both ways, but never in the direction of the trend."
    if up and trend <= 0:
        return f"{head} No trade: price broke above the range, but the daily trend is down, so no buy."
    if down and trend >= 0:
        return f"{head} No trade: price broke below the range, but the daily trend is up, so no sell."
    return f"{head} No trade: the breakout came too late in the session to open a trade."
