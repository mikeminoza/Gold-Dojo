# Research: Asia-range breakouts into the London open and volatility-squeeze breakouts on real XAUUSD

**Goal.** Find out whether two pre-registered families of intraday rules have an edge on 2003-2026
Dukascopy XAUUSD (real per-minute bid/ask) that holds up on an untouched holdout: (A) the breakout of
the Asia-session range into the London open, (B) Bollinger-inside-Keltner volatility-squeeze
breakouts on M30 / H1. "Nothing survives" is a valid outcome. Nothing here changes the live bot or
`config.py`.

**Status (2026-10-06): done. Verdict: nothing is "Robust".** Not one of the 64 pre-registered
points was even eligible on 2003-2018 (best train PF: A 0.84, B 1.01; every point lost money in 7 or
more of 16 years), so there are no finalists. On the holdout the two reference rows lost too (PF 0.73
and 0.67), below the median of their random-direction runs, and neither would have helped the live
New York breakout. See sections 4-8.

**Code:** `research/intraday2.py` (24-hour minute cache, mid bars, daily features, news pause,
minute-level bid/ask engine, metrics, live New York breakout reference), `research/london.py`
(family A), `research/squeeze.py` (family B), `research/run_intraday2.py` (experiments),
`research/intraday2_null.py` (engine checks on fake prices). Results saved to
`research/intraday2_results/` (the minute cache under `cache/` is git-ignored by its own `.gitignore`).

---

## 1. Pre-registered plan

*Written 2026-10-06 03:17 UTC, before any A or B rule (or the New York reference) was run on XAUUSD
data.*

Disclosure: before writing this I built the minute cache and looked only at data facts, not strategy
results: minutes per year, median close, median ATR (M15, D1), median Asia (00:00-07:00 London)
range width and median spread by time of day per year, the share of squeeze bars (section 3). The
engine was checked on fake prices first (section 2). I have read the three earlier studies
(`docs/strategy-research.md`, `docs/swing-research.md`, `docs/news-research.md`), so I know the live
New York breakout broke even on 2019-2026 there and that London-session breakouts (08:00 London
opening range) mostly failed in the first study.

### Split

- **Train:** 2003-05-05 - 2018-12-31. **Holdout:** 2019-01-01 - 2026-09-30, evaluated **once** per
  finalist after finalists are frozen (`research/intraday2_results/finalists.json`); the holdout
  command refuses a second run.
- Trades belong to train / holdout by signal time. Indicators run continuously across the split (they
  only look backwards), so the first holdout days use pre-2019 bars for warm-up.

### Data and prices

- Dukascopy 1-minute BID and ASK candles from the existing cache (`data/dukascopy/XAUUSD`, read with
  `research.dukascopy.read`, filler minutes dropped as in `research.dukascopy`; nothing downloaded),
  all 24 hours, kept per year in `research/intraday2_results/cache/`. Ask is clipped to >= bid.
- **Signals use mid bars** (M15 / M30 / H1, clock-aligned, OHLC of the minute mids), so a spread
  blow-out (e.g. at gold's daily reopen, inside the A2 window) does not look like a move. **Fills use
  the real bid/ask of the fill minute**: buy at the ask, sell at the bid.
- London and New York local times via `zoneinfo` (`Europe/London`, `America/New_York`), so DST is
  handled day by day, as `sessions.py` does.
- Daily features (trend, D1 ATR) from `data/xauusd_D1.parquet` (UTC days, bid), using the **last D1
  candle of a UTC day strictly before the signal's UTC day**: trend = sign(close - EMA50 of closes)
  (`config.DAILY_TREND_EMA`), D1 ATR = Wilder ATR14.

### Common rules (all variants, A, B and the New York reference)

- **Timing.** A signal is decided at a bar's close. Entry at the open of the first minute at or after
  the bar close (no minute within 5 minutes: no trade). One position at a time per variant.
- **Fills and costs.** BUY entry at ask open + $0.10; SELL at bid open - $0.10. A long stop triggers
  when the bid low <= stop and fills at min(stop, bid open) - $0.10; a short stop when the ask high >=
  stop, filled at max(stop, ask open) + $0.10. Targets: long when bid high >= target, filled at target
  - $0.10 (short mirrored on the ask). Stop and target in the same minute: the stop wins. Time exits
  at the bid (long) / ask (short) open of the first minute at or after the exit time, $0.10 slippage.
  So the real per-minute spread is paid in and out, plus $0.10/oz slippage per side. **No position is
  held overnight** (every rule has a same-day time exit), so no swap.
- **Minimum stop $2/oz.** The brief says "never below $2"; I apply it as a **floor**: a stop closer than
  $2 to the entry fill is widened to $2 (A and B). The live New York reference keeps the live rule
  (skip the trade, `MIN_STOP_DISTANCE`). The number of floored trades is reported. (Section 3: the M15
  ATR was $0.8-2.1 in 2003-2018, so A's k x ATR stops will often be floored on train.)
- **News pause** (as the live bot, `NEWS_PAUSE_MINUTES = 30`): no entry whose fill minute is within 30
  minutes before or after any NFP / CPI / FOMC release in `research/news/us_events.csv` (752 releases,
  NY times converted with DST). A blocked candidate is dropped; for A and the New York reference a
  later candidate the same day may still trade; for B the setup is lost.
- **R** = net result per oz (after spread and slippage) / risk (entry fill to stop). **PF on R.**
- **Sizing, both reported:** (1) **R-multiples at a fixed 1% risk**: 1 R = 1% of $500 = $5, worst drop
  = worst fall of cumulative R, in % of $500 (**used for the verdict**); (2) **live sizing**:
  `sizing.lot_size(entry, stop, target)` on $500 at 1%, live config as is (standard account, 1 lot =
  100 oz, min 0.01 lot), $ via `sizing.money`, worst drop via `backtest._drawdown`; trades where
  `lot_size` says "skip" are still counted at 0.01 lot and their number is reported.

### Family A: Asia range into the London open (`research/london.py`)

Per London day D (Mon-Fri):

- **Range** = mid high / low of the M15 bars of the Asia window: **A1** = [00:00, 07:00) London on D;
  **A2** = [23:00 on D-1, 07:00 on D) (Monday's A2 starts at Sunday's reopen). At least half the
  window's M15 bars must exist (14 of 28 / 16 of 32), else no trade that day.
- **Entry:** the first M15 bar starting 07:00-09:45 London (closing 07:15-10:00) whose mid close is
  above the range high (BUY) or below the range low (SELL), in an allowed direction, that can trade
  (news pause, entry minute). One trade per day.
- **Direction filter:** "none", or "trend" = BUY only if the previous UTC day's D1 close > EMA50, SELL
  only if below.
- **Stop:** the tighter of "other side of the range" (BUY: range low) and k x ATR14 (Wilder, M15 mid
  bars, at the signal bar) from the entry fill, k in {1.0, 1.5}; floored at $2.
- **Exit:** target 2R, else time exit at 16:00 London.
- **Range filter:** "on" = only days with 0.5 x ATR14(D1) <= range width <= 1.5 x ATR14(D1); "off".
- **Grid:** Asia window {A1, A2} x direction {none, trend} x k {1.0, 1.5} x range filter {on, off} =
  **16 points**.

### Family B: volatility squeeze (`research/squeeze.py`)

On continuous mid bars of the timeframe (M30 or H1):

- **Bollinger(20, 2):** SMA20 of close +/- 2 x population standard deviation of the last 20 closes.
  **Keltner(20, 1.5):** EMA20 of close +/- 1.5 x Wilder ATR20. **Squeeze bar:** Bollinger upper <
  Keltner upper and Bollinger lower > Keltner lower.
- **Setup:** a run of >= N consecutive squeeze bars ends at bar e (the first non-squeeze bar).
  **Signal:** the first bar j >= e (no new squeeze bar in between) whose close is above the upper
  Bollinger band (BUY) or below the lower one (SELL). One signal per setup: if it can't be taken
  (outside the entry window, against the trend filter, news pause, a position already open) the setup
  is lost.
- **Entry window:** the signal bar closes within [07:00, 20:00] London on a weekday.
- **Trend filter:** "none" or "ema" (previous UTC day's D1 close vs EMA50).
- **Stop:** "mid" = the middle band (SMA20) at the signal bar, or k x Wilder ATR14 of the timeframe
  from the entry fill, k in {1.0, 1.5}; floored at $2.
- **Exit:** target 2R or 3R, else time exit at 16:55 New York (end of gold's trading day; always after
  20:00 London) on the entry day.
- **Grid:** timeframe {M30, H1} x N {4, 8} x trend {none, ema} x stop {mid, 1.0ATR, 1.5ATR} x target
  {2R, 3R} = **48 points**.

### Reference: the live strategy (New York breakout)

`config.ORB_SESSIONS` exactly as live (New York 08:30-11:30 ET, M30, 60-minute range = the 08:30 and
09:00 bars, signal bars 09:30 / 10:00 / 10:30, close beyond the range in the D1 EMA50 trend direction,
stop distance from the signal close clamped to [0.5, 1.0] x ATR14, target 2R, time exit 11:30 ET, one
trade per session, stops < $2 skipped, news pause), run through the **same engine and costs** (mid
bars, bid/ask fills, $0.10 slippage). Reported on train for context and on the holdout for the
comparison; never selected or tuned.

### Metrics (every variant)

Trades, trades/year, win %, PF (R), total R, average R, worst drop (R at 1%, % of $500), $ result and
worst drop with live sizing, per-year table (trades, PF, R, $), losing years (calendar years with net
R < 0) / years with trades, longest losing streak, average spread paid (R; half the spread at the
entry minute + half at the exit minute, over risk), % of trades reaching the target, floored trades,
`lot_size` "skip" count.

### Choosing finalists (train only)

1. **Eligible:** >= 100 train trades, train PF >= 1.15, worst drop (R at 1%) smaller than 30% of
   $500, losing years <= 6 (of the 16 train years).
2. **Stable:** every grid neighbour has train PF >= 1.0 and within 0.15 of the candidate's PF.
   Neighbours = one parameter changed: A: the other Asia window, the other direction filter, the other
   k, the other range filter; B: the other timeframe, the other N, the other trend filter, **either**
   other stop rule, the other target.
3. Rank eligible + stable points by train PF; ties (within 0.05) broken by fewer losing years, then
   smaller worst drop. **At most 3 finalists, at most 2 per family.**
4. If nothing qualifies there are no finalists and nothing can be "Robust". The holdout is then run
   once for reference only: the best-ranked point of each family among points with >= 100 train
   trades, with the full battery reported as "what the checks would have said", no verdict weight.

### Holdout and robustness (finalists, once, no re-selection)

- Holdout metrics + per-year table, the live New York breakout on the same years next to it.
- +/-1 grid step neighbours on the holdout (reported only).
- **Cost stress:** each fill pays an extra 0.25 x that minute's spread (spread x 1.5 overall) and
  slippage x 1.5.
- **Random-entry benchmark:** the finalist's holdout trades (same days and entry minutes, same stop
  distance, same target distance, same time exit, same costs), each with a random BUY/SELL (50/50);
  1,000 runs; the finalist's PF percentile.
- **Combination with the live strategy:** correlation of daily R (all holdout weekdays, 0 on days
  without a trade) and of monthly R with the New York breakout; total R, worst drop (R) and R per unit
  of drawdown of New York alone vs New York + finalist (each at 1% risk).
- **Verdict "Robust"** only if all hold on the holdout: PF > 1.2; >= 60 trades; worst drop (R at 1%)
  < 30% of $500; PF beats >= 90% of random-direction runs; PF > 1.0 under the cost stress; total R > 0
  and no single calendar year > 50% of the total R. Otherwise "Not robust".

### Addendum, written after the train run and before any holdout run (2026-10-06 03:18 UTC)

The train run (section 4) produced **no finalists**: no A or B point was even eligible (best train PF
0.84 in A, 1.01 in B; every point had 7+ losing years of 16). As pre-registered, the holdout is run
once for **reference rows only**, with no verdict weight: the best-ranked point of each family among
points with >= 100 train trades, **A A1 dir=none k=1.5 rf=on** and **B H1 N=8 dir=ema stop=1.0ATR
2R**, each with the full battery (neighbours, costs x1.5, random direction, New York comparison and
combination), reported as "what the checks would have said". This cannot change the official result
(no finalists = nothing "Robust").

---

## 2. Engine checks (before any real-data results)

All on fake prices (`python -m research.intraday2_null`), never on XAUUSD. Output in
`research/intraday2_results/null_output.txt`.

- **No peeking.** On 1.5 years of fake 24-hour minutes, all 65 rules (16 A, 48 B, New York) were
  re-run with every minute after a cut time **deleted** (12 random cut times; bars, indicators and the
  daily table rebuilt from the truncated data). 105,967 signals up to the cut compared: **0 differ**;
  33,421 trades closed before the cut: **0 differ**.
- **Null test (random walk).** 24 independent driftless random walks (3 years of 24-hour minutes each,
  12 path steps per minute, $0.50/minute volatility), zero spread and slippage, no news pause. Every
  rule should average 0 R per trade. All 17 groups are within 1.4 standard errors of zero: A groups
  +0.002 to +0.017 R (se 0.018-0.023), B groups -0.029 to -0.002 R (se 0.018-0.027), New York -0.013
  (se 0.011); all 65 together -0.003 R per trade. No exit or stop style is flattered by the fill model
  by more than about 0.02-0.03 R per trade.
- **Hand-checked trade (fake prices, $0.30 spread, $0.10 slippage).** A1 dir=none k=1.5 rf=off on
  2013-02-20 recomputed with plain loops (range from minute mids, first M15 close outside, ATR14 by a
  Wilder loop, fill at the bid open - slippage, minute-by-minute stop/target walk): range
  1380.680-1393.643, SELL at 1379.782, risk 4.323, stopped at 1384.205, -1.0231 R. Engine: identical.
  One real trade is hand-checked after the train run (section 4).

## 3. Data

- Minute cache (`python -m research.intraday2 build`): 2003-05-04 - 2026-09-30, 104k minutes in 2003
  (from May), 205k in 2004, 275k in 2005, 330-366k a year from 2006. Mid bars: 560,762 M15, 281,650
  M30, 141,193 H1. Output in `research/intraday2_results/build_output.txt`.
- Data facts (`python -m research.run_intraday2 data`, `data_output.md`), medians per year:

  | years | close | M15 ATR14 | D1 ATR14 | A1 range width | spread 07-10 London |
  |---|---|---|---|---|---|
  | 2003-2005 | 372-435 | 0.82-1.04 | 5.4-6.2 | 2.0-2.5 | 0.41 |
  | 2006-2013 | 611-1,663 | 1.19-2.13 | 9.7-25.7 | 3.2-7.5 | 0.33-0.50 |
  | 2014-2018 | 1,168-1,277 | 1.04-1.51 | 11.9-18.3 | 4.5-6.9 | 0.23-0.30 |
  | 2019-2024 | 1,406-2,380 | 1.16-2.73 | 12.9-33.1 | 4.9-11.9 | 0.29-0.40 |
  | 2025 | 3,346 | 4.96 | 51.8 | 26.1 | 0.56 |
  | 2026 (to Sep) | 4,515 | 9.38 | 109.9 | 52.7 | 0.62 |

  - The median Asia range is only about 0.3 x the D1 ATR, so the "0.5-1.5 x ATR(D1)" range filter will
    keep a minority of days.
  - On train a 1-1.5 x M15 ATR stop is $1-3, so many A stops will sit at the $2 floor, where the
    spread plus slippage ($0.45-0.70 in and out) is about 0.25-0.35 R per trade.
  - Spreads are widest around gold's daily break (21:00-23:00 UTC median $0.27-0.77) and Dukascopy's
    pre-2011 spread is nearly fixed ($0.41-0.55).
  - Squeeze bars: 27.9% of M30 bars, 23.5% of H1 bars.

## 4. Train results (2003-05-05 - 2018-12-31)

*Run 2026-10-06 03:18 UTC, grids exactly as pre-registered.* Full table (all 64 points + the New York
reference, every metric) in `research/intraday2_results/train_output.md`. PF and R are net of the real
spread and $0.10/side slippage. "Drop" = worst fall of cumulative R at 1% risk (1 R = 1% of $500).
"$ / $ drop" = live sizing on $500.

**Summary of the grid (train):**

| family | points | trades / point | PF median (range) | points PF > 1.0 | eligible | best point (PF, trades, total R, losing years) |
|---|---|---|---|---|---|---|
| A Asia range | 16 | 170-2,619 | 0.71 (0.62-0.84) | 0 | 0 | A1 dir=none k=1.5 rf=on (0.84, 333, -36.7 R, 10 / 16) |
| B squeeze M30 | 24 | 798-2,144 | 0.66 (0.59-0.74) | 0 | 0 | M30 N=4 dir=ema stop=mid 3R (0.74, 1,131, -166 R, 14 / 16) |
| B squeeze H1 | 24 | 309-1,006 | 0.87 (0.72-1.01) | 1 | 0 | H1 N=8 dir=ema stop=mid 3R (1.01, 309, +1.0 R, 9 / 16) |
| NY live (reference) | 1 | 1,161 | 0.61 | - | - | -227 R, 15 / 16 losing years |

Selected rows (all points in `train_output.md`):

| id | trades | /yr | win % | PF | total R | drop (R, % of $500) | $ live sizing | $ drop | losing yrs | loss streak | spread R | floored |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A A1 dir=none k=1.5 rf=on (best A) | 333 | 21.3 | 32.1 | 0.84 | -36.7 | -45.5% | -$107.52 | -26.8% | 10 / 16 | 10 | 0.152 | 145 |
| A A1 dir=none k=1.5 rf=off | 2,619 | 167.2 | 27.8 | 0.66 | -654.7 | -655% | -$2,667 | -534% | 16 / 16 | 24 | 0.174 | 1,743 |
| A A1 dir=trend k=1 rf=on | 170 | 10.9 | 30.6 | 0.77 | -28.1 | -35.6% | -$121.08 | -30.0% | 10 / 16 | 14 | 0.175 | 137 |
| A A2 dir=none k=1.5 rf=on | 395 | 25.2 | 29.6 | 0.76 | -69.6 | -70.7% | -$252.70 | -51.2% | 9 / 16 | 15 | 0.155 | 182 |
| B M30 N=4 dir=none stop=mid 2R | 2,143 | 136.8 | 34.4 | 0.70 | -347.2 | -358% | -$1,422 | -296% | 16 / 16 | 14 | 0.105 | 95 |
| B H1 N=4 dir=none stop=mid 3R | 1,006 | 64.2 | 40.0 | 0.85 | -56.2 | -56.2% | -$91.05 | -37.5% | 11 / 16 | 13 | 0.080 | 14 |
| B H1 N=8 dir=ema stop=mid 3R | 309 | 19.7 | 44.0 | 1.01 | +1.0 | -12.6% | +$41.21 | -12.9% | 9 / 16 | 8 | 0.084 | 2 |
| **B H1 N=8 dir=ema stop=1.0ATR 2R** (best B by the ranking rule) | 309 | 19.7 | 38.8 | 0.98 | -3.1 | -22.1% | -$1.74 | -17.3% | 7 / 16 | 8 | 0.161 | 109 |
| NY live (reference) | 1,161 | 74.1 | 35.8 | 0.61 | -227.3 | -227% | -$878.69 | -176% | 15 / 16 | 14 | 0.127 | - |

(The "best B" is H1 N=8 dir=ema stop=1.0ATR 2R rather than the 1.01 point because PFs within 0.05
tie, and the tie goes to fewer losing years: 7 vs 9.)

**Reading the train table.**
- **Family A (Asia range into London) has no edge after costs.** All 16 points lost money. Without
  the range filter it lost in all 16 years (PF 0.62-0.66, about 160 trades a year). The range filter
  (0.5-1.5 x D1 ATR) helps but keeps only about 13% of days, and is still PF 0.65-0.84. The trend
  filter does not rescue it.
- **Family B on M30 is clearly negative** (PF 0.59-0.74, 13-16 losing years of 16).
- **Family B on H1 is the least bad.** It is break-even only with the trend filter and N=8 (PF
  0.98-1.01 on 309 trades), with 7-11 losing years of 16. That is far from the eligibility bar (PF >=
  1.15, <= 6 losing years).
- **Costs are what kill both families.** A diagnostic run after the holdout (`python -m
  research.run_intraday2 diag`, `diag_output.md`, no selection weight) shows this:
  - **Before** spread and slippage, the median point has PF 1.11 in both families (A 0.99-1.23, B
    0.95-1.55). The H1 trend-filtered squeeze points are 1.25-1.55, +0.07 to +0.23 R per trade.
  - Costs take 0.27 R per trade in A and 0.12-0.28 R in B.
  - The train-period M15 ATR was $0.8-2.1, so most A stops and the ATR-stop B points sit at the $2
    floor (median risk $2.00-2.70). There, the $0.25-0.55 spread plus $0.20 slippage is a quarter of
    the risk.
  - The wider "mid" stops ($4-6 on H1) pay half as much in costs but have less gross edge.
- **The live New York breakout, same engine and costs: PF 0.61, -227 R, 15 of 16 losing years** (gross
  PF 1.00). That is worse than `docs/strategy-research.md` reported for the same rule (PF 0.74). The
  difference is the cost model and inputs:
  - here the real spread is paid in and out, plus $0.20 slippage (there: one spread of max(candle
    spread, $0.25) per trade, no slippage);
  - signals are on mid bars;
  - stops < $2 are skipped, as live.

  The conclusion is the same: no edge on 2003-2018.
- Live sizing ($500 standard account): with $2-3 stops, 0.01 lot risks 0.4-0.6%, so `lot_size` sizes
  near 1% for almost every train trade (0-156 "skip" per point).
- **Hand check on real data** (`python -m research.run_intraday2 handcheck`, after the train run), A1
  dir=none k=1 rf=on, 2010-10-07:
  - Asia range (mid) 1344.339-1355.383: width 11.04, D1 ATR 13.73, so inside the filter.
  - The 07:30-07:45 London M15 bar closed at 1357.284, above the range -> BUY at the 07:45 ask open
    1357.612 + $0.10 = 1357.712.
  - M15 ATR14 1.596 was tighter than the range stop and was floored to $2.00 -> stop 1355.712,
    target 1361.712.
  - Stopped at 08:08 London at 1355.712 - $0.10 = 1355.612: -1.050 R.

  This matches the engine exactly.

## 5. Finalists

**None.** No point met the eligibility bar (>= 100 trades, PF >= 1.15, worst drop < 30%, <= 6 losing
years), so the stability rule never came into play. The only point with train PF above 1.0 (B H1 N=8
dir=ema stop=mid 3R, PF 1.01) has 9 losing years of 16.

The holdout reference rows are the best-ranked point of each family with >= 100 train trades. Their
R per year on train (trades in brackets):

| year | A A1 dir=none k=1.5 rf=on | B H1 N=8 dir=ema stop=1.0ATR 2R | NY live (reference) |
|---|---|---|---|
| 2003 | -7.0 (7) | +0.8 (16) | -3.0 (7) |
| 2004 | -0.1 (21) | -7.3 (30) | -3.8 (17) |
| 2005 | -12.2 (37) | -6.8 (35) | -7.7 (22) |
| 2006 | +5.3 (18) | +1.9 (24) | -23.8 (100) |
| 2007 | +0.1 (20) | +1.9 (23) | -25.4 (58) |
| 2008 | +6.6 (14) | +1.1 (15) | -14.4 (102) |
| 2009 | -7.9 (19) | -0.3 (22) | -24.0 (96) |
| 2010 | -9.0 (23) | -4.9 (19) | -17.5 (97) |
| 2011 | -4.4 (19) | +3.7 (16) | -23.5 (121) |
| 2012 | -3.4 (12) | -0.1 (21) | -7.4 (86) |
| 2013 | -1.4 (16) | -4.8 (15) | -12.7 (88) |
| 2014 | -6.2 (29) | +5.1 (13) | +0.5 (91) |
| 2015 | +0.1 (20) | +3.0 (17) | -16.0 (85) |
| 2016 | +4.8 (34) | +5.0 (16) | -22.7 (89) |
| 2017 | +5.3 (15) | +2.2 (11) | -9.2 (55) |
| 2018 | -7.2 (29) | -3.6 (16) | -16.6 (47) |

## 6. Holdout (2019-01-01 - 2026-09-30), reference rows only, run once

*Run 2026-10-06 03:19 UTC, after the empty finalist list and the addendum were frozen. No verdict
weight.* Output in `research/intraday2_results/holdout_output.md` and `holdout.json`.

| id | role | trades | /yr | win % | PF | total R | drop (R, % of $500) | $ live sizing | $ drop | losing yrs | loss streak | spread R | lot "skip" |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A A1 dir=none k=1.5 rf=on | reference | 233 | 30.1 | 27.9 | 0.73 | -45.7 | -48.7% | -$202.45 | -52.3% | 6 / 8 | 12 | 0.092 | 51 |
| B H1 N=8 dir=ema stop=1.0ATR 2R | reference | 113 | 14.6 | 32.7 | 0.67 | -23.9 | -31.6% | -$78.64 | -35.4% | 6 / 8 | 8 | 0.089 | 9 |
| NY live | live strategy | 726 | 93.7 | 40.5 | 0.82 | -64.8 | -82.9% | -$203.80 | -75.0% | 6 / 8 | 12 | 0.087 | 97 |

**The pre-registered checks, applied anyway** ("what a verdict would have said"):

| id | PF > 1.2 | >= 60 trades | drop < 30% | random pctl >= 90 (median, p90) | PF costs x1.5 > 1.0 | no year > 50% of R | passes |
|---|---|---|---|---|---|---|---|
| A A1 dir=none k=1.5 rf=on | 0.73 FAIL | 233 pass | -48.7% FAIL | 23.8 (0.80, 0.93) FAIL | 0.64 FAIL | total R < 0 FAIL | 1 / 6 |
| B H1 N=8 dir=ema stop=1.0ATR 2R | 0.67 FAIL | 113 pass | -31.6% FAIL | 39.7 (0.70, 0.88) FAIL | 0.62 FAIL | total R < 0 FAIL | 1 / 6 |

NY live with costs x1.5: PF 0.70.

Neighbours on the holdout (reported only):

| reference | neighbour | trades | PF | total R | drop |
|---|---|---|---|---|---|
| A A1 none k=1.5 rf=on | A2 window | 265 | 0.73 | -53.4 | -57.3% |
| | dir=trend | 114 | 0.86 | -11.0 | -16.5% |
| | k=1 | 233 | 0.67 | -58.1 | -59.1% |
| | rf=off | 1,317 | 0.75 | -238.7 | -249% |
| B H1 N=8 ema 1.0ATR 2R | M30 | 290 | 0.78 | -44.9 | -64.7% |
| | N=4 | 215 | 0.61 | -53.2 | -54.3% |
| | dir=none | 214 | 0.68 | -45.0 | -52.4% |
| | stop=mid | 113 | 0.99 | -0.5 | -10.6% |
| | stop=1.5ATR | 113 | 0.93 | -4.1 | -19.8% |
| | 3R | 113 | 0.71 | -21.0 | -31.6% |

Per year (holdout), R / $ live sizing (trades in brackets):

| year | A A1 dir=none k=1.5 rf=on | B H1 N=8 dir=ema stop=1.0ATR 2R | NY live |
|---|---|---|---|
| 2019 | -16.3 / -$63.93 (27) | -2.3 / -$11.72 (14) | -14.0 / -$53.65 (64) |
| 2020 | -7.8 / -$68.59 (31) | +5.2 / +$33.53 (19) | -34.8 / -$179.87 (105) |
| 2021 | -3.7 / -$17.30 (24) | -6.6 / -$26.59 (11) | -9.4 / -$43.07 (88) |
| 2022 | +0.4 / +$6.25 (23) | -1.9 / -$6.55 (15) | +1.9 / +$16.88 (96) |
| 2023 | -10.8 / -$33.65 (21) | -10.0 / -$35.58 (23) | -7.3 / -$25.21 (87) |
| 2024 | -6.5 / -$25.58 (24) | -2.9 / -$16.62 (15) | -5.0 / -$6.06 (111) |
| 2025 | +1.3 / +$14.62 (52) | -7.2 / -$60.10 (10) | +4.6 / +$118.54 (106) |
| 2026 | -2.4 / -$14.28 (31) | +1.9 / +$44.99 (6) | -0.7 / -$31.37 (69) |

**Combination with the live New York breakout** (holdout, each at 1% risk, R; daily R summed over
London days):

| stream | total R | worst drop (R) | R per unit of drop | monthly Sharpe | correlation with NY: daily / monthly |
|---|---|---|---|---|---|
| NY live alone | -64.8 | -82.9 | -0.78 | -0.83 | - |
| A reference alone | -45.7 | -48.7 | -0.94 | -0.85 | +0.01 / +0.07 (89 days with both) |
| NY live + A reference | -110.5 | -127.0 | -0.87 | -1.13 | |
| B reference alone | -23.9 | -31.6 | -0.75 | -0.68 | +0.05 / -0.11 (58 days with both) |
| NY live + B reference | -88.7 | -105.9 | -0.84 | -1.08 | |

**Reading the holdout.**
- Both reference rows lost on 2019-2026 too: A PF 0.73 (-46 R, 6 of 8 losing years), B PF 0.67
  (-24 R). Both sit **below the median** of their own random-direction runs (24th and 40th
  percentile), so the breakout direction added nothing.
- Their neighbours lost as well (PF 0.61-0.99). B's wider-stop neighbours were closest to break-even
  (mid band 0.99, 1.5 x ATR 0.93). That fits the train finding: costs on $2-3 stops are what sinks
  the tight versions.
- **The live New York breakout also lost on the holdout under this cost model** (PF 0.82, -65 R). It
  was PF 1.02 in `docs/strategy-research.md`, with that study's lighter one-spread cost model.
- Neither reference row is correlated with the New York breakout (daily +0.01 / +0.05). But adding a
  losing, uncorrelated stream to a losing stream only adds losses: both combinations lose more and
  have deeper drops.

## 7. Verdicts

| variant | verdict |
|---|---|
| all 16 A points (Asia range into London) | **Not robust**: none eligible on train (PF 0.62-0.84, 9-16 losing years of 16) |
| all 48 B points (volatility squeeze, M30 and H1) | **Not robust**: none eligible on train (PF 0.59-1.01, 7-16 losing years of 16) |
| A A1 dir=none k=1.5 rf=on (best A, reference) | Not robust; extra holdout checks 1 / 6 (PF 0.73, 24th percentile vs random) |
| B H1 N=8 dir=ema stop=1.0ATR 2R (best B, reference) | Not robust; extra holdout checks 1 / 6 (PF 0.67, 40th percentile vs random) |

## 8. Plain-English recommendation

On 23 years of real XAUUSD with real per-minute bid/ask, **neither idea pays after costs**:

- **Trading the Asia range into the London open loses money in every pre-registered form.** That
  covers with or without the daily-trend filter, the 00:00 or 23:00 Asia window, tight or wider ATR
  stops, and with or without the range-width filter. Before costs it is close to a coin flip (-0.01 to
  +0.12 R per trade). The spread and slippage on the small stops the setup implies (about 0.27 R per
  trade) turn it into a steady loser. It lost on 2019-2026 as well.
- **Volatility-squeeze breakouts lose on M30, and are at best break-even on H1 with a daily-trend
  filter.** The H1 trend-filtered versions are the one place with something before costs (gross PF
  1.25-1.55 on train). After costs they are PF 0.86-1.01 with 7-11 losing years, and the reference
  row lost on the holdout (PF 0.67).
- **Combining either with the live New York breakout would not help.** They are uncorrelated with it,
  but they lose, so a combination only adds losses and drawdown.

**Worth paper-tracking next to the live strategy? No.** Nothing reached the finalist bar, and the
holdout gave no sign of a hidden edge: both reference rows were below the random median. No code is
needed.

If you ever want to revisit squeezes, the only defensible next step is a **new, separately
pre-registered** test of the H1 trend-filtered squeeze, with stops wide enough that costs are small
relative to risk (for example a minimum stop well above $2). It would need fresh data from after
2026-09 for its holdout, because 2019-2026 has now been looked at. Re-tuning these grids on the same
data until something passes would only find noise.

**Side finding (not part of the brief):** under this stricter cost model (real spread in and out, plus
$0.10 per side), the live New York breakout itself is PF 0.61 on 2003-2018 and 0.82 on 2019-2026. That
reinforces `docs/strategy-research.md`: the live rule has no demonstrated edge either, and broker
costs decide whether it loses slowly or quickly.

**Caveats.**
- **$2 floor instead of skip.** For A and B, stops closer than $2 were widened to $2 (the brief's
  "never below $2"). The live bot would skip such trades instead.
  - On train, most A trades and the 1.0 x ATR B trades were floored (e.g. 2,401 of 2,619 for A1 none
    k=1 rf=off).
  - Skipping them would leave too few trades before 2009 to test. Widening keeps the rule tradable,
    but the stop is then $2 rather than the rule's own.
  - The gross PF of floored-heavy points (k=1, 1.0 x ATR) is similar to the others, so the floor does
    not seem to hide an edge.
- **Costs.**
  - Dukascopy's spread before 2011 is nearly fixed ($0.41-0.55). Its spreads may be tighter than a
    retail broker's today.
  - $0.10 slippage per side is an assumption.
  - With costs x1.5 every row is worse (PF 0.62-0.70).
  - A cheaper venue would not rescue A (gross PF <= 1.23).
- **Rule interpretations** (declared in the plan):
  - signals on mid bars;
  - Bollinger with population standard deviation;
  - Keltner on EMA20 +/- 1.5 x Wilder ATR20;
  - B stops on Wilder ATR14;
  - one signal per squeeze setup (lost if blocked);
  - B's end of day = 16:55 New York;
  - A trades once per day;
  - the news pause blocks entries within +/-30 minutes of NFP / CPI / FOMC only (the live bot's Forex
    Factory feed pauses for more event types).
- **Multiple testing:** 64 points. With that many, one train PF around 1.0-1.2 is expected by luck;
  here not even that appeared at the eligibility bar.
- **Data and sizing:**
  - Dukascopy is one ECN's feed. 2003-2005 minute data is thin (104-275k minutes a year vs ~350k
    later).
  - Live-sizing $ results use a fixed $500, not compounded (as `backtest.summarize`).
  - In 2025-2026, stops are wide enough that `lot_size` returns "skip" for some trades; those are
    counted at 0.01 lot.

**Deviations from the brief.**
- The $2 minimum stop is applied as a floor for A and B (see caveats). The New York reference keeps
  the live skip rule.
- "Worst drop" for the verdict is measured on R at a fixed 1% risk (1 R = 1% of $500), as "judge on R"
  asks. The live-sizing $ drop is reported next to it.
- B's stop grid = {middle band, 1.0 x ATR, 1.5 x ATR} (3 values). B's "end of day" = 16:55 New York.
- The finalist bar was made concrete: >= 100 trades, PF >= 1.15, drop < 30%, <= 6 losing years,
  neighbours PF >= 1.0 and within 0.15, at most 2 finalists per family.
- Results and the 24-hour minute cache live under `research/intraday2_results/` (only `research/` and
  this doc were to be written). The cache is git-ignored by its own `.gitignore`.
- The gross-R diagnostic (`diag`) was added after the holdout. It has no selection weight.

**Reproduce:** `python -m research.intraday2 build`, `python -m research.intraday2_null`, then
`python -m research.run_intraday2 data`, `train`, `handcheck`, `holdout`, `diag`. The holdout command
refuses a second run; delete `research/intraday2_results/holdout.json` only if the plan is
pre-registered again. Raw outputs are in `research/intraday2_results/`.
