"""Cost-aware filter (docs/cost-filter-research.md): skip a signal when its expected round-trip cost is
more than X% of its stop distance.

Built on the minute-level bid/ask engine of docs/london-squeeze-research.md (research/intraday2.py):
same minute cache, mid-bar signals, news pause, fills (buy at the ask, sell at the bid, $0.10/oz
slippage per fill), stop-before-target, time exits. What is new here:

  * simulate() = intraday2.simulate with two extra knobs: the minimum stop ($2 or $4; skip for the New
    York breakout as the live bot, widen for the squeeze as the earlier study) and a commission ($/oz
    round trip, paid half per fill; 0 except in the low-cost scenario). With min_stop=2, comm=0 it is
    identical to intraday2.simulate (checked in research/costfilter_null.py).
  * the filter: expected round-trip cost = median spread (ask - bid at the minute closes) of the SIGNAL
    candle + 2 x $0.10 slippage (+ commission). The candidate is skipped (like any other blocked
    candidate: a later New York candidate the same day may still trade; a squeeze setup is lost) when
    expected cost > X x stop distance, the stop distance being the one the trade would use (from the
    entry fill, after the minimum-stop rule). Only data known at entry is used.
  * low-cost scenario: per minute, the bid/ask are rebuilt around the same mid with the spread capped
    at $0.15, plus $0.07/oz commission round trip (slippage stays $0.10 per fill). Signals (mid bars)
    are unchanged.
"""
import os
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research import intraday2 as core  # noqa: E402
from research import squeeze  # noqa: E402

RES = os.path.join(core.ROOT, "research", "costfilter_results")
CACHE = os.path.join(RES, "cache")
SLIP = core.SLIP
XS = [None, 0.05, 0.08, 0.12]          # None = no filter
MIN_STOPS = [2.0, 4.0]
LOW_SPREAD_CAP, LOW_COMM = 0.15, 0.07
SQ = {"S1": squeeze.BV("H1", 8, "ema", "1.0ATR", 2.0),   # best-ranked B point of the earlier study
      "S2": squeeze.BV("H1", 8, "ema", "mid", 3.0),      # the only B point with train PF > 1.0
      "S3": squeeze.BV("H1", 8, "ema", "mid", 2.0),      # wider-stop variants near break-even
      "S4": squeeze.BV("H1", 8, "ema", "1.5ATR", 2.0)}
STRATS = ["NY"] + list(SQ)
TF_SEC = {"NY": 1800, **{k: 3600 for k in SQ}}


def xlabel(x):
    return "none" if x is None else f"{round(100 * x)}%"


@dataclass(frozen=True)
class Spec:
    strat: str          # NY / S1..S4
    m: float            # minimum stop $/oz
    x: object           # None or fraction

    @property
    def key(self):
        return f"{self.strat} m={self.m:g} X={xlabel(self.x)}"

    @property
    def floor(self):    # NY: skip stops < m (live levels()); squeeze: widen to m (earlier study)
        return self.strat != "NY"


def all_specs():
    return [Spec(s, m, x) for s in STRATS for m in MIN_STOPS for x in XS]


# ---------------------------------------------------------------- low-cost minutes
def low_cost(M, cap=LOW_SPREAD_CAP):
    """Same mids, spread per field capped at `cap` (bid = mid - s/2, ask = mid + s/2)."""
    L = core.Minutes.__new__(core.Minutes)
    L.t, L.n = M.t, M.n
    for f in ("o", "h", "l", "c"):
        a, b = getattr(M, "a" + f), getattr(M, "b" + f)
        mid, s = (a + b) / 2, np.minimum(a - b, cap)
        setattr(L, "b" + f, mid - s / 2)
        setattr(L, "a" + f, mid + s / 2)
    for p in ("a", "b"):  # keep each OHLC consistent after the shift
        o, c = getattr(L, p + "o"), getattr(L, p + "c")
        setattr(L, p + "h", np.maximum.reduce([getattr(L, p + "h"), o, c]))
        setattr(L, p + "l", np.minimum.reduce([getattr(L, p + "l"), o, c]))
    return L


# ---------------------------------------------------------------- engine
def signal_spread(M, tc, sec):
    j0, j1 = np.searchsorted(M.t, tc - sec, "left"), np.searchsorted(M.t, tc, "left")
    if j1 <= j0:
        return np.nan
    return float(np.median(M.ac[j0:j1] - M.bc[j0:j1]))


def simulate(M, i, side, stop_level, stop_dist, rr, t_exit, floor, min_stop=2.0, cm=1.0, comm=0.0,
             x=None, sig_spread=np.nan):
    """intraday2.simulate + min_stop, commission and the cost filter (see module doc)."""
    s = side
    sl = SLIP * cm
    sp_in = M.ao[i] - M.bo[i]
    extra_in = (cm - 1) * 0.5 * sp_in
    entry = (M.ao[i] + sl + extra_in) if s > 0 else (M.bo[i] - sl - extra_in)
    # decisions (minimum stop, filter) and the stop / target prices come from the base-cost entry, so the
    # cost stress (cm > 1) trades exactly the same signals with the same levels, only with worse fills
    base_entry = (M.ao[i] + SLIP) if s > 0 else (M.bo[i] - SLIP)
    floored = False
    cands = []
    if np.isfinite(stop_level):
        d = (base_entry - stop_level) * s
        if d > 0:
            cands.append(d)
    if np.isfinite(stop_dist):
        cands.append(stop_dist)
    if not cands:
        return None, "stop on the wrong side"
    r = min(cands)
    if r < min_stop:
        if not floor:
            return None, f"stop < ${min_stop:g}"
        r, floored = min_stop, True
    est_cost = sig_spread + 2 * SLIP + comm      # decided with base costs (cm does not enter)
    if x is not None:
        if not np.isfinite(est_cost):
            return None, "no signal spread"
        if est_cost > x * r:
            return None, "cost filter"
    tdist = rr * r if np.isfinite(rr) else np.inf
    stop = base_entry - s * r
    target = base_entry + s * tdist if np.isfinite(tdist) else np.nan
    r = (entry - stop) * s          # actual risk from the (possibly stressed) fill; = r when cm = 1
    j_end = int(np.searchsorted(M.t, t_exit, "left"))
    seg = slice(i, j_end)
    if s > 0:
        hit_sl = M.bl[seg] <= stop
        hit_tp = M.bh[seg] >= target if np.isfinite(target) else np.zeros(j_end - i, bool)
    else:
        hit_sl = M.ah[seg] >= stop
        hit_tp = M.al[seg] <= target if np.isfinite(target) else np.zeros(j_end - i, bool)
    any_hit = hit_sl | hit_tp
    if any_hit.any():
        j = i + int(np.argmax(any_hit))
        sp_out = M.ao[j] - M.bo[j]
        so = sl + (cm - 1) * 0.5 * sp_out
        if hit_sl[j - i]:
            reason = "SL"
            px = (min(stop, M.bo[j]) - so) if s > 0 else (max(stop, M.ao[j]) + so)
        else:
            reason = "TP"
            px = (target - so) if s > 0 else (target + so)
    elif j_end < M.n and M.t[j_end] < t_exit + 3600:
        j = j_end
        sp_out = M.ao[j] - M.bo[j]
        so = sl + (cm - 1) * 0.5 * sp_out
        reason = "Time"
        px = (M.bo[j] - so) if s > 0 else (M.ao[j] + so)
    else:
        j = max(j_end - 1, i)
        sp_out = M.ac[j] - M.bc[j]
        so = sl + (cm - 1) * 0.5 * sp_out
        reason = "Day end"
        px = (M.bc[j] - so) if s > 0 else (M.ac[j] + so)
    c_paid = comm * cm
    pnl = s * (px - entry) - c_paid
    spread_cost = 0.5 * sp_in + 0.5 * sp_out
    return {"side": s, "entry": entry, "stop": stop, "target": target, "risk": r, "exit_px": px,
            "entry_t": int(M.t[i]), "exit_t": int(M.t[j]), "reason": reason, "pnl": pnl, "R": pnl / r,
            "spread_R": spread_cost * cm / r, "slip_R": 2 * sl / r, "comm_R": c_paid / r,
            "cost_R": (spread_cost * cm + 2 * sl + c_paid) / r, "floored": floored, "tdist": tdist,
            "sig_spread": sig_spread, "est_cost": est_cost, "est_cost_pct": 100 * est_cost / r}, ""


def run_year(M, cands, spec, releases, cm=1.0, comm=0.0, busy_until=-1):
    """As intraday2.run_year, with the spec's minimum stop and cost filter."""
    rows, skipped, done = [], {}, set()
    sec = TF_SEC[spec.strat]

    def skip(why):
        skipped[why] = skipped.get(why, 0) + 1

    for c in cands:
        if c.group in done:
            continue
        i = int(np.searchsorted(M.t, c.tc, "left"))
        if i >= M.n or M.t[i] >= c.tc + core.ENTRY_WINDOW or M.t[i] >= c.t_exit:
            skip("no entry minute")
            continue
        if M.t[i] < busy_until:
            skip("position open")
            continue
        if core.paused(int(M.t[i]), releases):
            skip("news pause")
            continue
        tr, why = simulate(M, i, c.side, c.stop_level, c.stop_dist, c.rr, c.t_exit, spec.floor, spec.m, cm, comm,
                           spec.x, signal_spread(M, c.tc, sec))
        if tr is None:
            skip(why)
            continue
        done.add(c.group)
        busy_until = tr["exit_t"] + 1
        tr["group"], tr["sig_t"], tr["t_exit_rule"] = c.group, c.tc, c.t_exit
        rows.append(tr)
    return rows, skipped, busy_until


def run_many(cand_sets, specs, releases, cost="base", years=None, loader=None):
    """{strat: candidates}, [Spec] -> {spec.key: trades df}. cost: base / x1.5 / low / low_x1.5."""
    cm = 1.5 if cost.endswith("x1.5") else 1.0
    low = cost.startswith("low")
    comm = LOW_COMM if low else 0.0
    loader = loader or core.load_year
    years = years or core.years_available()
    by_year = {}
    for s, cs in cand_sets.items():
        for c in cs:
            by_year.setdefault((s, pd.Timestamp(c.tc, unit="s", tz="UTC").year), []).append(c)
    rows = {sp.key: [] for sp in specs}
    skipped = {sp.key: {} for sp in specs}
    busy = {sp.key: -1 for sp in specs}
    for y in years:
        need = [sp for sp in specs if (sp.strat, y) in by_year]
        if not need:
            continue
        M = loader(y)
        if low:
            M = low_cost(M)
        for sp in need:
            r, sk, busy[sp.key] = run_year(M, by_year[(sp.strat, y)], sp, releases, cm, comm, busy[sp.key])
            rows[sp.key] += r
            for w, n in sk.items():
                skipped[sp.key][w] = skipped[sp.key].get(w, 0) + n
        del M
    return {k: core.finish(rows[k], skipped[k]) for k in rows}


# ---------------------------------------------------------------- candidates
def candidates_from(bars30, bars60, d1table):
    out = {"NY": core.ny_candidates(core.ny_prepare(bars30, d1table))}
    b = squeeze.prepare(bars60, "H1", d1table)
    sets = squeeze.setups(b, 8)
    for k, v in SQ.items():
        out[k] = squeeze.candidates(b, v, sets)
    return out


def real_candidates():
    d1t = core.daily_table(core.load_d1())
    return candidates_from(core.load_bars("M30"), core.load_bars("H1"), d1t)


# ---------------------------------------------------------------- metrics and walk-forward
def metrics(df, years_span):
    m = core.metrics(df, years_span)
    if len(df):
        m["cost_R"] = round(float(df.cost_R.mean()), 3)
        m["gross_pf"] = round(core.pf(df.R + df.cost_R), 2)
    return m


def year_of(df):
    return df.entry_time.dt.year


def wf_choose(results, keys, year, lookback=5):
    """Key with the highest total R over [year-lookback, year-1]; ties -> the earlier key in `keys`
    (keys are ordered least filtering first)."""
    best, best_r = None, None
    for k in keys:
        df = results[k]
        r = float(df.R[(year_of(df) >= year - lookback) & (year_of(df) < year)].sum()) if len(df) else 0.0
        if best is None or r > best_r + 1e-9:
            best, best_r = k, r
    return best, best_r


def walk_forward(results, keys, years, lookback=5, choices=None):
    """Stitched out-of-sample trades: each year traded with the key chosen on the prior `lookback` years.
    Pass `choices` ({year: key}) to replay given choices on other results (cost stress)."""
    parts, ch = [], {}
    for y in years:
        k = choices[y] if choices else wf_choose(results, keys, y, lookback)[0]
        ch[y] = k
        df = results[k]
        if len(df):
            parts.append(df[year_of(df) == y].assign(wf_key=k))
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
    return out, ch
