# Research: is there a robust edge on ~20 years of real XAUUSD?

**Goal.** Find out whether the current session-breakout strategy, or a small pre-registered set of
variants of it, has an edge that holds up on long real XAUUSD history with an untouched holdout.
"Nothing survives" is a valid outcome. Nothing here changes the live bot or `config.py`.

**Code:** `research/` (`dukascopy.py` data, `strategies.py` variants, `engine.py` fast replay,
`run.py` experiments, `null_test.py` engine check). Data in `data/` (git-ignored).

**Status (2026-10-02): done. Verdict: nothing survives.** No variant had an edge on the 2003-2018
training years, so there are no finalists; the baseline breaks even on 2019-2026 (PF 1.02, carried by
2025). See sections 5-8.

---

## 1. Pre-registered plan

*Written 2026-10-01 08:15 UTC, before any variant was run on Dukascopy data.*

Disclosure: while building the engine I smoke-tested it on the cached Binance PAXG history
(Aug 2020 - Sep 2026, which lies inside the holdout period) with default parameters only. Seen:
baseline 537 trades (= `publish_backtest.py`), B with threshold 1.0 = 321 trades, London+NY = 1,155
trades, half-at-1R PF 1.00, ATR trail PF 1.01, fade PF 0.37 / 0.59. The grids below were already
chosen and were not changed after seeing these.

### Split

- **Train:** first usable Dukascopy day - 2018-12-31.
- **Holdout:** 2019-01-01 - last complete day. Evaluated **once** per finalist, after finalists
  are frozen. Indicators (ATR, EMA 50, 100-day ATR median) warm up continuously across the split,
  so the first holdout days use only pre-2019 candles for their features (no peeking: features are
  from the previous closed daily candle / closed intraday candles).
- Trades are assigned to train / holdout by **entry time**.

### Common rules (all variants)

- Engine: `research/engine.py`, identical to `backtest.run` for fixed stop/target exits (verified
  trade-for-trade, same `pnl` and `pnl_usd`). Entry at the next candle's open, stop before target
  within a candle, session-end exit at the last candle's close, one trade per session, spread =
  max(candle spread, `BACKTEST_MIN_SPREAD` = $0.25) paid once per trade, lots from
  `sizing.lot_size` on a fixed $500 / 1% risk (as `backtest.summarize`).
- Spread column is in **price units** ($ per oz), so `point = 1.0`.
- Daily features use the previous completed UTC daily candle (weekdays only, like the live feed).
  - trend strength `S = |D1 close - EMA50(D1 close)| / ATR14(D1)` (Wilder ATR as in
    `strategy.add_indicators`)
  - ATR regime `V = ATR14(D1) / median(ATR14(D1), last 100 days incl. that day)`

### Variants and grids

| id | variant | grid |
|---|---|---|
| A0 | Baseline: config exactly (ORB, New York 08:30-11:30 NY, M30, 60-min range, RR 2.0, max stop 1.0 ATR, min stop 0.5 ATR, D1 EMA 50 trend) | - |
| A1 | Baseline on H1 (same code; note the H1 range is the 09:00-10:00 NY candle because H1 candles start on the hour) | - |
| A2 | Baseline with London 08:00-12:00 London + New York | - |
| B | A0 + only trade when `S >= t` | t in {0.5, 1.0, 1.5} |
| C | A0 + only trade when `V >= r` | r in {0.8, 1.0, 1.2} |
| D1 | A0 exits: half off at +1R, stop to breakeven, rest targets 2R | - |
| D2 | A0 exits: no fixed target; after +1R trail the stop at highest high (BUY) - m x signal ATR, from the next candle | m in {0.5, 1.0, 1.5} |
| E | Fade (mean reversion), only when `S < t` | t in {0.5, 1.0} x target in {range, 1.5R} |
| F | Combination, built from train results only: best B or C filter + best D exit for breakout days, and E (its best target) on the days that filter says "no trend" | (no new grid) |

**E defined precisely.** Same New York session, same 60-min opening range, M30. A "break" is a
trade-phase candle that **closes** outside the range (the candle the breakout strategy would
trade, ignoring trend). After an up-break, the first later candle that closes back strictly inside
the range is a SELL signal (down-break mirrored, BUY). Stop = beyond the highest high (SELL) / lowest
low (BUY) of the session's trade phase so far, including the signal candle; the distance is kept
between 0.5 and 1.0 x M30 ATR like the breakout. Target: "range" = the opposite side of the opening
range (skipped if that is less than 0.5R away at the signal close, or if the entry has already passed
it), or a fixed 1.5R. Trend direction is ignored; one trade per session; the same session-end exit
and "no signal in the last candle" rule as the breakout. Entry at the next open, as everything else.

**F defined precisely.** Filter = the B or C setting ranked best on train by the finalist rule
below; exit = the D setting (D1, or D2 with its best m; or fixed if neither beats A0 on train PF);
on sessions where the filter is off, E with its better train target (E's own `t` is replaced by
"filter off"). One trade per session in total.

### Metrics

Trades, trades/week, win rate, profit factor (gross wins / gross losses in $/oz), total R, result
and worst drop on $500 at 1% risk (`sizing.lot_size`, `backtest._drawdown`), per-year table
(trades, PF, $ result), number of losing years, longest losing streak.

### Choosing finalists (train only)

1. Eligible: >= 100 train trades and train PF >= 1.10.
2. Stable: every immediate grid neighbour (one step either way in each parameter) has PF within
   0.15 of it and >= 1.0. Variants without a grid (A1, A2, D1, F) count as stable.
3. Rank eligible + stable variants by train PF; ties (within 0.03) broken by fewer losing years,
   then smaller worst drop. At most 3 finalists, at most one per letter (B, C, D, E, F; A1/A2 as A).
4. If nothing qualifies, there are no finalists; only the baseline is run on the holdout.

### Holdout and robustness (finalists only, run once, no re-selection)

- Holdout metrics + per-year table; baseline A0 on holdout too.
- +/-1 grid step parameter perturbation on holdout (reported, not used to select).
- Spread stress: every trade's charged spread x 1.5.
- Random-direction benchmark: the finalist's own holdout trades (same entry candles, same stop and
  target distances, same exit rules, same spread and lots), each with a random BUY/SELL; 1,000 runs;
  report the finalist's PF percentile among them.
- **Verdict "Robust"** only if: holdout PF > 1.15, holdout worst drop smaller than A0's holdout
  worst drop, >= 80 holdout trades, PF beats >= 90% of random runs, and PF > 1.0 with +50% spread.
  Otherwise "Not robust".

---

## 2. Engine checks (before any real-data results)

- **Same as `backtest.run`:** on the cached PAXG history, `research/engine.py` gives the same
  trades, `pnl` and `pnl_usd` as `backtest.run` for A0 (537 trades), B t=1.0 (321) and London+NY
  (1,155); the research strategy class with default settings gives the same trades as the live
  `strategy.SessionBreakout`. Re-checked on Dukascopy data with `python -m research.run verify`.
- **Null test** (`python -m research.null_test`): 12 independent driftless random walks
  (2.5 years of 1-minute prices each, zero spread, random entries in the New York trade window).
  Every exit rule should average 0 R. This caught a real bug: the half-at-1R exit counted the full
  position at the session-end close when +1R was reached in the session's last candle (+0.05 R per
  trade of fake profit). Fixed before any Dukascopy run. After the fix (avg R per trade, se in
  brackets; difference vs A0 on the same entries):

  | exit | avg R | minus A0 |
  |---|---|---|
  | A0 fixed 1R stop / 2R target | +0.013 (0.014) | - |
  | D1 half at 1R + breakeven | +0.002 (0.013) | -0.011 (0.002) |
  | D2 trail m=0.5 | +0.023 (0.015) | +0.010 (0.004) |
  | D2 trail m=1.0 | +0.019 (0.015) | +0.006 (0.003) |
  | D2 trail m=1.5 | +0.018 (0.015) | +0.006 (0.002) |

  So candle-resolution fills cost D1 about 0.01 R per trade (pessimistic: stop-first rule) and
  flatter D2 by about 0.006-0.010 R per trade. Differences between exits smaller than ~0.02 R per
  trade should be treated as noise / fill-model artefacts. A moved stop (breakeven / trail) that a
  candle has already opened past is filled at that candle's open, not at the stop.

---

## 3. Data (Dukascopy XAUUSD)

- **Source:** Dukascopy public datafeed, 1-minute BID and ASK candles per day
  (`research/dukascopy.py`, cached under `data/dukascopy/`). Price divisor **1000**, checked on
  known dates: 2003-06-16 $358, 2011-09-06 $1,893, 2018-06-15 $1,299, 2024-11-15 $2,566. Files before
  May 2003 are flat placeholders (1.250, zero volume) and are dropped with the other filler minutes
  (zero volume and O=H=L=C). Saturdays are not requested.
- **Period:** 2003-05-05 to 2026-09-30. **M30 276,316 candles, H1 138,292, D1 6,055**, after the same
  gold market-hours filter as `binance_feed._frame` (D1 = UTC days, weekdays only).
- **Prices:** BID OHLC; `spread` = median over the candle's minutes of (ask close - bid close), in
  $ per oz, so `point = 1.0`. Ask <= bid in 0.10% of minutes.
- **Spread by year** (median M30; New York session about the same): 2003-2010 $0.41-0.51
  (Dukascopy's older, nearly fixed spread), 2012-2019 $0.24-0.36, 2020 $0.40 (p90 $0.79, Covid),
  2021-2024 $0.33-0.38, 2025 $0.58, 2026 $0.69 (gold at $3,300-4,500). Every trade pays at least $0.25.
- **Caveats:** 2003-2005 are thin (median 10-25 of 30 minutes have a price per M30 candle), so
  ranges, ATR and stops are noisier there. Dukascopy is one ECN's feed, not your broker's. No news
  pause (no historical calendar), as in `backtest.py`.
- **Price check vs Binance PAXG** (67,607 matching M30 candles since 2021): PAXG - XAUUSD median
  +$1.40 (IQR -$7.55..+$8.19); correlation of 30-minute returns only 0.715. PAXG is a noisy proxy
  for intraday gold.

## 4. Sanity check: current strategy, Dukascopy vs Binance PAXG (Aug 2020 - Sep 2026)

*Run after the finalists were frozen, so the baseline's holdout-period result could not influence
selection.*

| | trades | win % | PF | result on $500 | worst drop |
|---|---|---|---|---|---|
| Binance PAXG (`publish_backtest.py --dry-run`; same on the cached history) | 537 | 41.0 | 0.98 | -$54.93 | -80.0% |
| Dukascopy XAUUSD | 588 | 45.9 | 1.09 | +$133.60 | -27.0% |

PF by year, PAXG / Dukascopy: 2021 0.48 / 0.89, 2022 0.83 / 1.27, 2023 0.75 / 0.98,
2024 0.73 / 1.06, 2025 1.56 / 1.59, 2026 1.33 / 1.01. Both traded 425 of the same sessions (423 in the
same direction). The rest differ because PAXG's intraday path differs (0.715 return correlation),
so ranges, breakouts and stop/target hits differ. Both show the 2025 boom; PAXG makes 2021-2024 look
worse. The gap is explainable, and Dukascopy is the closer-to-spot source.

## 5. Train results (2003-05-05 - 2018-12-31)

*Run 2026-10-02 05:08 UTC, grids exactly as pre-registered.*

| id | trades | /week | win % | PF | total R | result on $500 | worst drop | losing years | loss streak |
|---|---|---|---|---|---|---|---|---|---|
| A0 baseline | 1,424 | 1.74 | 38.8 | 0.74 | -293.1 | -$1,244.92 | -252.6% | 15 / 16 | 11 |
| A1 baseline H1 | 0 | - | - | - | - | - | - | - | - |
| A2 London + NY | 3,030 | 3.71 | 37.2 | 0.69 | -658.5 | -$2,771.97 | -561.3% | 16 / 16 | 16 |
| B t=0.5 | 1,199 | 1.47 | 39.2 | 0.74 | -248.3 | -$1,081.84 | -220.0% | 14 / 16 | 12 |
| B t=1.0 | 948 | 1.16 | 38.8 | 0.74 | -199.6 | -$923.02 | -188.3% | 13 / 16 | 13 |
| B t=1.5 | 713 | 0.87 | 41.0 | 0.84 | -72.1 | -$340.55 | -71.8% | 12 / 16 | 13 |
| C r=0.8 | 1,239 | 1.52 | 38.6 | 0.73 | -266.1 | -$1,121.75 | -224.4% | 15 / 16 | 11 |
| C r=1.0 | 606 | 0.74 | 39.9 | 0.79 | -82.8 | -$351.60 | -70.4% | 12 / 16 | 19 |
| C r=1.2 | 232 | 0.28 | 42.7 | 0.79 | -23.0 | -$97.77 | -21.8% | 10 / 14 | 11 |
| D1 half at 1R + BE | 1,424 | 1.74 | 44.8 | 0.70 | -301.3 | -$1,277.26 | -258.1% | 14 / 16 | 11 |
| D2 trail m=0.5 | 1,424 | 1.74 | 41.5 | 0.73 | -288.5 | -$1,231.52 | -252.1% | 15 / 16 | 11 |
| D2 trail m=1.0 | 1,424 | 1.74 | 39.4 | 0.73 | -291.6 | -$1,252.48 | -256.3% | 14 / 16 | 13 |
| D2 trail m=1.5 | 1,424 | 1.74 | 37.1 | 0.72 | -299.4 | -$1,294.68 | -264.7% | 14 / 16 | 11 |
| E fade S<0.5, target range | 121 | 0.15 | 36.4 | 0.57 | -25.2 | -$89.11 | -20.8% | 12 / 16 | 5 |
| E fade S<0.5, 1.5R | 129 | 0.16 | 34.1 | 0.51 | -33.0 | -$119.83 | -24.5% | 11 / 16 | 6 |
| E fade S<1.0, target range | 240 | 0.29 | 42.1 | 0.74 | -34.4 | -$109.57 | -25.8% | 12 / 16 | 10 |
| E fade S<1.0, 1.5R | 261 | 0.32 | 39.8 | 0.67 | -44.9 | -$152.23 | -31.3% | 12 / 16 | 11 |
| F = B 1.5 + fixed exit + fade (range) on the other days | 1,064 | 1.30 | 40.7 | 0.79 | -132.5 | -$564.56 | -116.6% | 13 / 16 | 12 |

A worst drop below -100% means a fixed $500 account would have been wiped out. The sizing keeps
using $500, as `backtest.summarize` does.

**A0 per year (train), PF:** 2003 0.50, 2004 0.71, 2005 0.29, 2006 0.65, 2007 0.45, 2008 0.88,
2009 0.75, 2010 0.70, 2011 0.73, 2012 0.96, 2013 0.83, **2014 1.18**, 2015 0.70, 2016 0.62,
2017 0.76, 2018 0.52. Only 2014 made money.

**Deviations / notes (the plan itself was not changed):**
- **A1 cannot trade as specified.** H1 candles start on the hour, so the 08:30-11:30 NY session's
  "range" is the 09:00 candle and the first possible signal is the 10:00 candle. The rule "the trade
  must open with at least one candle left before 11:30" rejects that candle, so A1 has 0 trades. The
  live code would behave the same on H1.
- F was built mechanically by the pre-registered rule: best filter = B 1.5 (PF 0.84); no D exit beat
  A0's PF, so the fixed exit; E's better target = "range".
- Total R is distorted by a sizing quirk (section 8): one 2005 trade opened $0.006 from its stop
  (-60 R, -$302 on 7.78 lots). PF is in $/oz and barely affected.

**Diagnostics (not used for selection), A0 on train:** before costs, gross PF 1.02 and +0.01 R per
trade. The median spread is 0.15 R of the median $2.40 stop (0.32 R in 2003-2005). So before costs
the breakout was a coin flip over 2003-2018, and the spread turned it into a steady loser. In the
random-direction benchmark on train (same entries, 1,000 runs), A0's PF of 0.74 sits at the 62nd
percentile (random median 0.72): the daily-trend direction added nothing over 2003-2018.

## 6. Finalists

**None.** Every variant has a train PF below 1.0 (the best is B 1.5 at 0.84), so none meets the
pre-registered bar (>= 100 trades and PF >= 1.10). As the plan says, only the baseline goes to the
holdout, and there is no finalist robustness section (perturbation, +50% spread, random entry).

## 7. Holdout (2019-01-01 - 2026-09-30), baseline only, run once

*Run 2026-10-02, after the (empty) finalist list was frozen.*

| | trades | /week | win % | PF | total R | result on $500 | worst drop | losing years | loss streak |
|---|---|---|---|---|---|---|---|---|---|
| A0 baseline | 755 | 1.87 | 43.8 | 1.02 | -22.1 | +$29.10 | -48.8% | 4 / 8 | 9 |
| *extra:* A0 with the live loss limits (5 losses in a row -> 7-day pause; -6R in a month -> pause to month end) | 722 | 1.79 | 43.5 | 0.99 | -30.4 | -$32.21 | -47.6% | 6 / 8 | 9 |

A0 per year (holdout): 2019 PF 0.91 (-$17.95), **2020 0.45 (-$163.73)**, 2021 0.89 (-$17.78),
2022 1.27 (+$43.80), 2023 0.98 (-$6.57), 2024 1.06 (+$11.85), **2025 1.59 (+$175.44)**,
2026 1.01 (+$4.05). Without 2025 the holdout loses money.

Extras (labelled, not part of any verdict): gross PF before costs 1.21 (+0.066 R per trade); median
spread 0.09 R of a $4.23 stop; with the spread x1.5, PF 0.94. In the random-direction benchmark, A0's
PF is at the 97.8th percentile (random median 0.84). So over 2019-2026 the daily-trend direction did
carry information (gold's bull market, mostly buys), but the same rule carried none over 2003-2018,
and after costs the strategy is about break-even. The loss limits did not help: PF went from 1.02
to 0.99 on the holdout, and stayed at 0.74 on train.

## 8. Verdicts and recommendation

| variant | verdict |
|---|---|
| B, C, D1, D2, E, F, A2 | **Not robust**: no edge even on train, so not taken to the holdout |
| A1 | Not testable as specified (0 trades on H1) |
| A0 baseline (reference) | Not robust either: train PF 0.74 with 15 of 16 losing years; holdout PF 1.02, carried by 2025 |

**Plain English.** On 23 years of real XAUUSD, the New York opening-range breakout loses money in
almost every year before 2019 and roughly breaks even after, thanks to one big year (2025). None of
the pre-registered tweaks turned it into a winner on the training years: a stronger-trend filter,
a volatility filter, partial profits with breakeven, trailing stops, fading failed breakouts, or a
combination. Most changed little, because before costs the breakout is close to a coin flip, and
the spread (0.1-0.3 R per trade) decides the result.

**What to change in `config.py`:** the evidence supports no change as an improvement. The data
argues against adding London (A2 is worse) and against the exit changes, and gives no basis for any
filter value. The honest reading is that the current strategy has no demonstrated edge. If it keeps
running, treat it as an experiment on demo or minimum size, and don't extrapolate the 2025-2026
results.

**Worth knowing (not fixed here; live code untouched):**
- `strategy.levels` accepts any risk > 0, and `sizing.lot_size` ignores the spread. A trade that
  opens a few cents from its stop gets a huge lot (7.78 lots on $500 in 2005), and the spread alone
  costs about 60 R. A minimum stop distance measured from the actual entry would prevent this (e.g.
  skip if the entry is within 0.5 x ATR or 2 x spread of the stop).
- Candle-resolution backtests fill stops exactly at the stop price. With real slippage, results
  would be slightly worse than shown.

**Reproduce:** `python -m research.dukascopy --no-download`, then `python -m research.run data`,
`verify`, `train`, `holdout` (refuses a second run; delete `data/research_holdout.json` only if the
plan is pre-registered again), `sanity`, `costs`; and `python -m research.null_test`.
