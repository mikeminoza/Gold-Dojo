"""Daily-candle swing strategies and engine for docs/swing-research.md.

No peeking:
  * every signal uses only the closed daily candle t and earlier ones; entry is at day t+1's open
  * moving stops (channel / trail) are recomputed after a close and apply from the next day
  * stop + target touched on the same day is resolved with that day's real H1 path, then M30, then
    stop-first (worst case)

Prices are Dukascopy BID, $/oz (point = 1.0). Costs: entry-day spread (min BACKTEST_MIN_SPREAD) once,
slippage per fill, swap per calendar night on the entry price (see COSTS).
"""
import contextlib
import os
from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

import config
import sizing

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BALANCE = 500.0
MIN_STOP = 2.0          # $/oz, as config.MIN_STOP_DISTANCE
SLIPPAGE = 0.20         # $/oz per fill
SWAP = 0.0002           # fraction of entry price per calendar night, longs and shorts
MIN_SPREAD = config.BACKTEST_MIN_SPREAD


@dataclass(frozen=True)
class V:
    family: str                 # S1 Donchian, S2 pullback, S3 momentum
    n: int = 0                  # S1 breakout channel
    k: float = 2.0              # initial stop (and S1 trail) in ATR20
    exit: str = "channel"       # S1: channel / trail; S2: 3R / trail; S3: rebalance
    trend: str = "sma200"       # S2: sma200 / 50>200
    months: int = 0             # S3 lookback
    long_only: bool = False

    @property
    def key(self):
        lo = "S4 long-only " if self.long_only else ""
        if self.family == "S1":
            return f"{lo}S1 N={self.n} k={self.k:g} {self.exit}"
        if self.family == "S2":
            return f"{lo}S2 {self.trend} {self.exit}"
        return f"{lo}S3 L={self.months}m"

    def with_(self, **kw):
        return replace(self, **kw)


def wilder_atr(d, period=20):
    prev = d["close"].shift()
    tr = pd.concat([d["high"] - d["low"], (d["high"] - prev).abs(), (d["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def indicators(d1):
    """All columns any variant needs, from closed candles only (row t uses rows <= t)."""
    d = d1[["time", "open", "high", "low", "close", "spread"]].reset_index(drop=True).copy()
    d["atr"] = wilder_atr(d, 20)
    d.loc[:19, "atr"] = np.nan  # warm-up
    for n in (20, 55, 100):
        d[f"hh{n}"] = d["high"].shift(1).rolling(n).max()   # N days BEFORE t
        d[f"ll{n}"] = d["low"].shift(1).rolling(n).min()
    for m in (10, 27, 50):
        d[f"chlo{m}"] = d["low"].rolling(m).min()            # last M days incl. t: the stop for t+1
        d[f"chhi{m}"] = d["high"].rolling(m).max()
    d["sma50"] = d["close"].rolling(50).mean()
    d["sma200"] = d["close"].rolling(200).mean()
    d["ema20"] = d["close"].ewm(span=20, adjust=False).mean()
    month = d["time"].dt.tz_convert(None).dt.to_period("M")
    d["month_end"] = month != month.shift(-1)
    d.loc[len(d) - 1, "month_end"] = False  # the last row has no next open; treat as unknown
    return d


def signals(d, v: V):
    """+1 / -1 / 0 per row: the side to enter at the next open."""
    c = d["close"]
    if v.family == "S1":
        s = np.where(c > d[f"hh{v.n}"], 1, np.where(c < d[f"ll{v.n}"], -1, 0))
    elif v.family == "S2":
        if v.trend == "sma200":
            up, dn = c > d["sma200"], c < d["sma200"]
        else:
            up, dn = d["sma50"] > d["sma200"], d["sma50"] < d["sma200"]
        e, cp, ep = d["ema20"], c.shift(1), d["ema20"].shift(1)
        s = np.where(up & (cp <= ep) & (c > e), 1, np.where(dn & (cp >= ep) & (c < e), -1, 0))
    else:
        me = np.flatnonzero(d["month_end"].to_numpy())
        s = np.zeros(len(d), int)
        for j in range(v.months, len(me)):
            r = c.iat[me[j]] / c.iat[me[j - v.months]] - 1
            s[me[j]] = 1 if r > 0 else (-1 if r < 0 else 0)
    s = np.asarray(s, int)
    s[d["atr"].isna().to_numpy()] = 0
    if v.long_only:
        s = np.where(s > 0, 1, 0)
    return s


class Intraday:
    """H1 and M30 paths per day / hour, to order a stop and a target touched on the same day."""

    def __init__(self, h1, m30):
        self.h1 = self._arrays(h1)
        self.m30 = self._arrays(m30)
        self.counts = {"H1": 0, "M30": 0, "stop-first": 0, "no path": 0}

    @staticmethod
    def _arrays(df):
        t = df["time"].dt.tz_convert(None).to_numpy().astype("datetime64[s]").astype(np.int64)
        return t, df["high"].to_numpy(float), df["low"].to_numpy(float)

    @staticmethod
    def _rows(arr, start, seconds):
        t, h, l = arr
        a, b = np.searchsorted(t, start), np.searchsorted(t, start + seconds)
        return [(int(t[j]), h[j], l[j]) for j in range(a, b)]

    def first(self, day, side, stop, tgt):
        """'stop' or 'target': which level the day's real path reached first."""
        start = int(pd.Timestamp(day).timestamp())
        rows = self._rows(self.h1, start, 86400)
        def touch(hi, lo):
            return (lo <= stop, hi >= tgt) if side > 0 else (hi >= stop, lo <= tgt)
        for t, hi, lo in rows:
            hs, ht = touch(hi, lo)
            if hs and ht:
                for _, h2, l2 in self._rows(self.m30, t, 3600):
                    hs2, ht2 = touch(h2, l2)
                    if hs2 and ht2:
                        break
                    if hs2 or ht2:
                        self.counts["M30"] += 1
                        return "stop" if hs2 else "target"
                self.counts["stop-first"] += 1
                return "stop"
            if hs or ht:
                self.counts["H1"] += 1
                return "stop" if hs else "target"
        self.counts["no path"] += 1
        return "stop"


@contextlib.contextmanager
def oz_per_lot(n):
    """Runtime-only switch between a standard (100 oz) and a cent (1 oz) account; config.py untouched."""
    old = config.OZ_PER_LOT
    config.OZ_PER_LOT = n
    try:
        yield
    finally:
        config.OZ_PER_LOT = old


def run(d, v: V, hi, intraday=None, cost_mult=1.0, sig=None, slippage=SLIPPAGE, swap=SWAP, min_spread=MIN_SPREAD):
    """All trades of variant v using rows 0..hi only (hi inclusive). Returns a DataFrame."""
    sig = signals(d, v) if sig is None else sig
    O, H, L, C = (d[c].to_numpy(float) for c in ("open", "high", "low", "close"))
    atr, spr = d["atr"].to_numpy(float), d["spread"].to_numpy(float)
    day = d["time"].tolist()
    me = np.flatnonzero(d["month_end"].to_numpy())
    next_me = {me[j]: me[j + 1] for j in range(len(me) - 1)}
    chlo = d[f"chlo{v.n // 2}"].to_numpy(float) if v.family == "S1" else None
    chhi = d[f"chhi{v.n // 2}"].to_numpy(float) if v.family == "S1" else None
    trail_k = v.k if v.family == "S1" else 2.0
    stop_k = v.k if v.family == "S1" else (2.0 if v.family == "S2" else 3.0)
    trades, pos, pending = [], None, 0
    pending_from = -1

    def close_pos(i, price, reason, at_open):
        nonlocal pos
        p = pos
        nights = (day[i] - day[p["i"]]).days
        spread = max(spr[p["i"]], min_spread) * cost_mult
        slip = 2 * slippage * cost_mult
        sw = swap * p["entry"] * nights * cost_mult
        gross = p["side"] * (price - p["entry"])
        net = gross - spread - slip - sw
        trades.append({"side": "BUY" if p["side"] > 0 else "SELL", "entry_i": p["i"], "exit_i": i,
                       "entry_time": day[p["i"]], "exit_time": day[i], "entry": p["entry"], "exit": price,
                       "sl": p["sl"], "tp": p["tp"], "risk": p["risk"], "reason": reason, "at_open": at_open,
                       "hold": i - p["i"] + (0 if at_open else 1), "nights": nights,
                       "gross": gross, "spread": spread, "slip": slip, "swap": sw, "pnl": net, "r": net / p["risk"]})
        pos = None

    for i in range(0, hi + 1):
        # a) S3 rebalance: close at this open
        if pos is not None and pos.get("exit_at") == i:
            close_pos(i, O[i], "Rebalance", True)
        # b) entry at this open from the signal at the previous close
        if pos is None and pending != 0 and pending_from == i - 1:
            side, entry = pending, O[i]
            dist = stop_k * atr[i - 1]
            if dist >= MIN_STOP:
                sl = entry - side * dist
                tp = entry + side * 3 * dist if (v.family == "S2" and v.exit == "3R") else np.nan
                pos = {"side": side, "i": i, "entry": entry, "sl": sl, "stop": sl, "tp": tp, "risk": dist,
                       "best": entry, "exit_at": next_me.get(i - 1, hi + 1) + 1 if v.family == "S3" else None}
        pending = 0
        # c) exits during day i
        if pos is not None:
            s, stop, tp = pos["side"], pos["stop"], pos["tp"]
            has_tp = not np.isnan(tp)
            done = False
            if i > pos["i"]:
                if (O[i] <= stop) if s > 0 else (O[i] >= stop):
                    close_pos(i, O[i], "Stop (gap)", True)
                    done = True
                elif has_tp and ((O[i] >= tp) if s > 0 else (O[i] <= tp)):
                    close_pos(i, O[i], "Target (gap)", True)
                    done = True
            if not done:
                hs = (L[i] <= stop) if s > 0 else (H[i] >= stop)
                ht = has_tp and ((H[i] >= tp) if s > 0 else (L[i] <= tp))
                if hs and ht:
                    which = intraday.first(day[i], s, stop, tp) if intraday else "stop"
                    hs, ht = which == "stop", which == "target"
                if hs:
                    close_pos(i, stop, "Stop" if stop == pos["sl"] else "Trail/channel stop", False)
                elif ht:
                    close_pos(i, tp, "Target", False)
        # d) still open: move the stop for tomorrow, or close at the end of the allowed data
        if pos is not None:
            s = pos["side"]
            if i == hi:
                close_pos(i, C[i], "End of data", False)
            else:
                if v.exit == "channel":
                    cand = chlo[i] if s > 0 else chhi[i]
                    pos["stop"] = max(pos["stop"], cand) if s > 0 else min(pos["stop"], cand)
                elif v.exit == "trail":
                    pos["best"] = max(pos["best"], H[i]) if s > 0 else min(pos["best"], L[i])
                    cand = pos["best"] - s * trail_k * atr[i]
                    pos["stop"] = max(pos["stop"], cand) if s > 0 else min(pos["stop"], cand)
        # e) signal at this close
        if sig[i] != 0 and i < hi and (pos is None or v.family == "S3"):
            pending, pending_from = int(sig[i]), i
    return add_money(pd.DataFrame(trades))


def add_money(t):
    """Lots and $ results on a fixed $500 at 1% risk: cent account (used for the verdict) and the live
    standard account (reference)."""
    if t.empty:
        return t
    for col, oz in (("", 1), ("_std", 100)):
        lots, usd, verdict = [], [], []
        with oz_per_lot(oz), _balance(BALANCE):
            for x in t.itertuples():
                tp = x.tp if np.isfinite(x.tp) else x.entry + (1 if x.side == "BUY" else -1) * 2 * x.risk
                s = sizing.lot_size(x.entry, x.sl, tp)
                lots.append(s["lots"])
                usd.append(sizing.money(x.pnl, s["lots"]))
                verdict.append(s["verdict"])
        t["lots" + col], t["pnl_usd" + col], t["verdict" + col] = lots, usd, verdict
    return t


@contextlib.contextmanager
def _balance(b):
    old = config.ACCOUNT_BALANCE
    config.ACCOUNT_BALANCE = b
    try:
        yield
    finally:
        config.ACCOUNT_BALANCE = old


# ---------------------------------------------------------------- metrics
def pf(r):
    r = np.asarray(r, float)
    loss = -r[r <= 0].sum()
    return float(r[r > 0].sum() / loss) if loss > 0 else float("inf")


def streak(r):
    best = cur = 0
    for x in r:
        cur = cur + 1 if x <= 0 else 0
        best = max(best, cur)
    return best


def closed_drop(usd):
    eq = np.cumsum(np.asarray(usd, float))
    return float((eq - np.maximum.accumulate(np.maximum(eq, 0))).min()) if len(eq) else 0.0


def daily_pnl(d, t, cost_mult=1.0, swap=SWAP):
    """Marked-to-market $ per trading day (cent-account lots), summing exactly to the trades' pnl_usd."""
    C = d["close"].to_numpy(float)
    nights = np.r_[0, d["time"].diff().dt.days.to_numpy()[1:]].astype(float)
    out = np.zeros(len(d))
    for x in t.itertuples():
        q, s, a, b = x.lots, (1 if x.side == "BUY" else -1), x.entry_i, x.exit_i
        if b == a:
            out[a] += x.pnl * q
            continue
        out[a] += q * (s * (C[a] - x.entry) - x.spread - x.slip / 2)
        for j in range(a + 1, b):
            out[j] += q * (s * (C[j] - C[j - 1]) - swap * cost_mult * x.entry * nights[j])
        out[b] += q * (s * (x.exit - C[b - 1]) - swap * cost_mult * x.entry * nights[b] - x.slip / 2)
    return out


def mtm_stats(pnl, lo, hi, years):
    p = pnl[lo:hi + 1]
    eq = BALANCE + np.cumsum(p)
    peak = np.maximum.accumulate(np.r_[BALANCE, eq])[1:]
    drop = float((eq - peak).min())
    yearly = p.sum() / years
    sd = p.std()
    return {"mtm_drop_%": round(100 * drop / BALANCE, 1), "per_year_$": round(float(yearly), 2),
            "ret_per_drop": round(float(yearly / -drop), 2) if drop < 0 else float("inf"),
            "sharpe": round(float(p.mean() / sd * np.sqrt(252)), 2) if sd > 0 else 0.0}


def metrics(d, t, lo, hi, cost_mult=1.0):
    days = hi - lo + 1
    years = (d["time"].iat[hi] - d["time"].iat[lo]).days / 365.25
    if t.empty:
        return {"trades": 0}
    yr = t.groupby(t["entry_time"].dt.year)["r"].sum()
    exposed = np.zeros(len(d), bool)
    for x in t.itertuples():
        exposed[x.entry_i:x.exit_i + (0 if x.at_open else 1)] = True
    lg, sh = t[t.side == "BUY"], t[t.side == "SELL"]
    m = {"trades": len(t), "per_year": round(len(t) / years, 1), "win_%": round(100 * float((t.r > 0).mean()), 1),
         "pf": round(pf(t.r), 2), "total_R": round(float(t.r.sum()), 1),
         "result_$": round(float(t.pnl_usd.sum()), 2), "drop_%": round(100 * closed_drop(t.pnl_usd) / BALANCE, 1),
         "losing_years": int((yr < 0).sum()), "years": int(len(yr)), "loss_streak": streak(t.r.tolist()),
         "avg_hold": round(float(t.hold.mean()), 1), "exposure_%": round(100 * exposed[lo:hi + 1].mean(), 1),
         "long_n": len(lg), "long_R": round(float(lg.r.sum()), 1), "long_pf": round(pf(lg.r), 2) if len(lg) else None,
         "short_n": len(sh), "short_R": round(float(sh.r.sum()), 1), "short_pf": round(pf(sh.r), 2) if len(sh) else None,
         "std_result_$": round(float(t.pnl_usd_std.sum()), 2),
         "std_drop_%": round(100 * closed_drop(t.pnl_usd_std) / BALANCE, 1),
         "std_skip": int((t.verdict_std == "skip").sum()), "cent_skip": int((t.verdict == "skip").sum()),
         "cost_R_per_trade": round(float(((t.spread + t.slip + t.swap) / t.risk).mean()), 3),
         "swap_R_per_trade": round(float((t.swap / t.risk).mean()), 3)}
    m.update(mtm_stats(daily_pnl(d, t, cost_mult), lo, hi, years))
    return m


def per_year(t):
    rows = []
    for y, g in t.groupby(t["entry_time"].dt.year):
        rows.append({"year": int(y), "trades": len(g), "win_%": round(100 * float((g.r > 0).mean()), 1),
                     "pf": round(pf(g.r), 2), "R": round(float(g.r.sum()), 1),
                     "result_$": round(float(g.pnl_usd.sum()), 2)})
    return pd.DataFrame(rows)


def buy_hold(d, lo, hi, swap=0.0):
    """$500 notional held constantly (rebalanced daily, not compounded) from the open of lo to the close of hi."""
    C, O = d["close"].to_numpy(float), d["open"].to_numpy(float)
    nights = np.r_[0, d["time"].diff().dt.days.to_numpy()[1:]].astype(float)
    p = np.zeros(len(d))
    p[lo] = BALANCE * (C[lo] / O[lo] - 1)
    p[lo + 1:hi + 1] = BALANCE * (C[lo + 1:hi + 1] / C[lo:hi] - 1) - BALANCE * swap * nights[lo + 1:hi + 1]
    years = (d["time"].iat[hi] - d["time"].iat[lo]).days / 365.25
    m = mtm_stats(p, lo, hi, years)
    m["total_$"] = round(float(p[lo:hi + 1].sum()), 2)
    m["price_change_%"] = round(100 * (C[hi] / O[lo] - 1), 1)
    return m


def random_entry(d, t, lo, hi, stop_k, runs=1000, seed=11, long_only=False, cost_mult=1.0):
    """PF (R) of random trades: same count and hold lengths as t, random entry day in [lo, hi] and random
    direction, stop stop_k x ATR20 of the previous day from the entry open, time exit at the close of
    the hold length; same cost model."""
    O, H, L, C = (d[c].to_numpy(float) for c in ("open", "high", "low", "close"))
    atr, spr = d["atr"].to_numpy(float), d["spread"].to_numpy(float)
    day = d["time"].dt.tz_convert(None).to_numpy()
    holds = np.maximum(t.hold.to_numpy(int), 1)
    rng = np.random.default_rng(seed)
    pfs = np.zeros(runs)
    for k in range(runs):
        rs = []
        for h in holds:
            e = int(rng.integers(max(lo, 1), hi - h + 2))
            s = 1 if long_only else (1 if rng.random() < 0.5 else -1)
            entry, dist = O[e], stop_k * atr[e - 1]
            stop = entry - s * dist
            exit_px, x = None, e + h - 1
            for j in range(e, e + h):
                if j > e and ((O[j] <= stop) if s > 0 else (O[j] >= stop)):
                    exit_px, x = O[j], j
                    break
                if (L[j] <= stop) if s > 0 else (H[j] >= stop):
                    exit_px, x = stop, j
                    break
            if exit_px is None:
                exit_px = C[x]
            nights = (day[x] - day[e]).astype("timedelta64[D]").astype(int)
            cost = (max(spr[e], MIN_SPREAD) + 2 * SLIPPAGE + SWAP * entry * nights) * cost_mult
            rs.append((s * (exit_px - entry) - cost) / dist)
        pfs[k] = pf(rs)
    real = pf(t.r)
    return {"real_pf": round(real, 2), "random_median_pf": round(float(np.median(pfs)), 2),
            "random_p90_pf": round(float(np.quantile(pfs, 0.9)), 2),
            "percentile": round(100 * float((pfs < real).mean()), 1)}


def md(df):
    cols = list(df.columns)
    lines = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    for r in df.itertuples(index=False):
        lines.append("| " + " | ".join("-" if x is None or (isinstance(x, float) and np.isnan(x)) else str(x) for x in r) + " |")
    return "\n".join(lines)
