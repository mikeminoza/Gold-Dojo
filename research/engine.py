"""Fast replay of precomputed signals (research.strategies.add_signals), with the same rules as
backtest.run plus two extra exit modes.

Rules shared with backtest.run (checked to give identical trades for fixed exits, see
research/run.py --verify):
  * a signal on candle i enters at candle i+1's open; at most one position; one trade per session
    (a session is "taken" only if the trade opened, i.e. the entry hadn't already run past the stop)
  * every trade pays max(spread of candle i+1 x point, BACKTEST_MIN_SPREAD) once
  * stop is checked before target in the same candle (worst case); early exit at the close of the
    last candle of the session
  * lots from sizing.lot_size on the fixed config.ACCOUNT_BALANCE, as backtest.summarize does

Extra exit modes (docs/strategy-research.md, D):
  * "half_be": half the position closes at +1R; from the next candle the stop on the other half is
    the entry price (breakeven); the other half targets the normal rr. If a candle touches the stop
    and +1R, the stop wins (worst case). The $ result assumes half a lot can be closed (with 0.01
    lot on a small account it can't, so this is the idealised version).
  * "trail": no fixed target. After a candle's high (BUY) reaches +1R, the stop trails at
    highest-high-since-entry - trail_mult x ATR (ATR of the signal candle), never below the original
    stop; the trailed stop applies from the next candle (no use of the candle's own path).
"""
import numpy as np
import pandas as pd

import config
import sizing


class Arrays:
    """Plain Python lists of the columns the loop needs (much faster than DataFrame access)."""

    def __init__(self, df, candle_seconds):
        self.n = len(df)
        self.time = df["time"].tolist()
        self.t = ((df["time"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(seconds=1)).to_numpy(np.int64)
        self.open, self.high, self.low, self.close = (df[c].to_numpy(float).tolist() for c in ("open", "high", "low", "close"))
        self.atr = df["atr"].to_numpy(float).tolist()
        self.spread = df["spread"].to_numpy(float).tolist() if "spread" in df else [0.0] * self.n
        self.sess = df["sess"].tolist()
        self.sess_end = df["sess_end"].to_numpy(np.int64).tolist()
        self.side = df["sig_side"].to_numpy(float).tolist()
        self.stop = df["sig_stop"].to_numpy(float).tolist()
        self.rr = df["sig_rr"].to_numpy(float).tolist()
        self.tp = df["sig_tp"].to_numpy(float).tolist()
        self.candle = candle_seconds
        self.tsec = self.t.tolist()


def simulate(a, i_entry, side, sl, tp, exit_mode, trail_dist, start_check=None):
    """Follow one position opened at the open of candle i_entry. Returns (exit_index, pnl_per_oz_before_spread, reason)."""
    entry = a.open[i_entry]
    risk = entry - sl if side > 0 else sl - entry
    one_r = entry + side * risk
    expires = a.sess_end[i_entry]
    half_done, trail_on = False, False
    best = entry
    stop = sl
    banked = 0.0  # pnl of the closed half, per oz of the whole position
    for i in range(i_entry, a.n - 1):
        hi, lo = a.high[i], a.low[i]
        if side > 0:
            hit_sl, hit_tp, hit_1r = lo <= stop, hi >= tp, hi >= one_r
        else:
            hit_sl, hit_tp, hit_1r = hi >= stop, lo <= tp, lo <= one_r
        rest = 0.5 if half_done else 1.0
        if hit_sl:
            if stop == sl:  # the original stop: filled at the stop price, exactly like backtest.run
                return i, banked + rest * side * (stop - entry), "SL"
            # a stop moved after a candle (breakeven / trail): if this candle already opened past it,
            # fill at the open, not at the better stop price (otherwise moved stops look too good)
            fill = min(stop, a.open[i]) if side > 0 else max(stop, a.open[i])
            return i, banked + rest * side * (fill - entry), "BE" if exit_mode == "half_be" else "Trail"
        if hit_tp:
            if exit_mode == "half_be" and not half_done:
                return i, 0.5 * risk + 0.5 * side * (tp - entry), "TP"
            return i, banked + rest * side * (tp - entry), "TP"
        if exit_mode == "half_be" and not half_done and hit_1r:
            half_done, banked, stop = True, 0.5 * risk, entry
        if a.tsec[i] + a.candle >= expires:
            return i, banked + (0.5 if half_done else 1.0) * side * (a.close[i] - entry), "Session ended"
        if exit_mode == "trail":
            best = max(best, hi) if side > 0 else min(best, lo)
            if not trail_on and hit_1r:
                trail_on = True
            if trail_on:
                stop = max(stop, best - trail_dist) if side > 0 else min(stop, best + trail_dist)
    return a.n - 1, banked + (0.5 if half_done else 1.0) * side * (a.close[a.n - 1] - entry), "End of data"


def run(df, p, candle_seconds, point=1.0, spread_mult=1.0, min_spread=None, arrays=None):
    """All trades of a variant. Columns like backtest.run plus r (R multiple) and sig_i (signal candle)."""
    a = arrays or Arrays(df, candle_seconds)
    min_spread = config.BACKTEST_MIN_SPREAD if min_spread is None else min_spread
    taken, trades = set(), []
    i, free_from = 1, 1
    side_l = a.side
    while i < a.n - 1:
        if i < free_from or side_l[i] == 0 or a.sess[i] in taken:
            i += 1
            continue
        side = int(side_l[i])
        entry = a.open[i + 1]
        sl = a.stop[i]
        risk = entry - sl if side > 0 else sl - entry
        if risk <= 0:
            i += 1
            continue
        if not np.isnan(a.tp[i]):
            tp = a.tp[i]
            if (tp - entry) * side <= 0:  # entry already past the target: skip, like a risk <= 0
                i += 1
                continue
        elif p.exit == "trail":
            tp = np.inf if side > 0 else -np.inf
        else:
            tp = entry + side * a.rr[i] * risk
        taken.add(a.sess[i])
        spread = max(a.spread[i + 1] * point, min_spread) * spread_mult
        j, gross, reason = simulate(a, i + 1, side, sl, tp, p.exit, p.trail_mult * a.atr[i])
        if reason == "End of data":  # backtest.run never closes these either
            break
        size_tp = tp if np.isfinite(tp) else entry + side * 2 * risk
        size = sizing.lot_size(entry, sl, size_tp)
        pnl = gross - spread
        trades.append({"side": "BUY" if side > 0 else "SELL", "entry": entry, "sl": sl, "tp": tp,
                       "spread": spread, "entry_time": a.time[i + 1], "exit_time": a.time[j],
                       "exit": np.nan, "reason": reason, "pnl": pnl, "r": pnl / risk, "risk": risk,
                       "lots": size["lots"], "pnl_usd": sizing.money(pnl, size["lots"]),
                       "verdict": size["verdict"], "sig_i": i, "sess": a.sess[i]})
        # backtest.run checks exits on candle j and may enter again on candle j itself
        free_from = j
        i = j if j > i else i + 1
    return pd.DataFrame(trades)


def both_sides(df, trades, p, candle_seconds, arrays=None, point=1.0):
    """For the random-direction benchmark: pnl / pnl_usd of every trade if taken BUY and if taken SELL,
    same entry candle, same stop distance, same target distance, same exit rules."""
    a = arrays or Arrays(df, candle_seconds)
    out = np.zeros((len(trades), 2, 2))  # trade, side (0 BUY, 1 SELL), (pnl, pnl_usd)
    for k, t in enumerate(trades.itertuples()):
        i = t.sig_i
        entry, risk = a.open[i + 1], t.risk
        tp_dist = abs(t.tp - t.entry) if np.isfinite(t.tp) else np.inf
        for s_i, side in enumerate((1, -1)):
            sl = entry - side * risk
            tp = entry + side * tp_dist
            _, gross, _ = simulate(a, i + 1, side, sl, tp, p.exit, p.trail_mult * a.atr[i])
            pnl = gross - t.spread
            out[k, s_i] = pnl, sizing.money(pnl, t.lots)
    return out
