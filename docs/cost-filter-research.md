# Research: does a cost-aware filter make the New York breakout or the H1 squeeze pay after costs?

**Goal.** Test whether skipping signals whose expected round-trip cost is a large share of the stop
makes (1) the live New York opening-range breakout, exactly as `config.py`, or (2) the H1
trend-filtered volatility squeeze (the near-miss of `docs/london-squeeze-research.md`) profitable after
realistic costs on 2003-2026 Dukascopy XAUUSD. "Nothing survives" is a valid outcome. Nothing here
changes the live bot or `config.py`.

**Status (2026-10-06): done.**
- **Squeeze: not worth it** in every form (walk-forward PF 0.89-1.05).
- **New York breakout + filter:** its walk-forward **meets the pre-registered "worth paper-tracking"
  bar** (PF 1.28 on 163 trades; PF 1.17 at costs x1.5). But all of its profit is in the contaminated
  2019-2026 years: the 2008-2018 part has PF 0.93, and 2025 alone is 64% of the R.
- **A low-cost broker** would not change either verdict.
- **Recommendation:** paper-track the filter only, no live change. See sections 4 and 7-9.

**Code:** `research/costfilter.py` (filter, minimum stop, commission and low-cost scenario on top of the
minute-level bid/ask engine of `research/intraday2.py`), `research/costfilter_null.py` (engine checks on
fake prices), `research/run_costfilter.py` (experiments). Results in `research/costfilter_results/`.

---

## 1. Pre-registered plan

*Written 2026-10-06 06:46 UTC, before any filtered variant was run on XAUUSD data.* The engine code was
written and checked on fake prices only (section 2). I have read the four earlier studies, so I know
their numbers for the unfiltered rules (New York breakout PF 0.61 train / 0.82 holdout under this cost
model; the H1 squeeze points PF 0.98-1.01 train, gross PF 1.42-1.55, costs 0.12-0.24 R per trade).

### Engine, data and costs (unchanged from `docs/london-squeeze-research.md`)

- Dukascopy 1-minute bid and ask (the existing 24-hour cache in `research/intraday2_results/cache/`,
  nothing downloaded), signals on mid bars, fills at the real bid/ask of the fill minute (buy at the
  ask, sell at the bid) plus **$0.10/oz slippage per fill**, stop before target in the same minute, no
  overnight positions, one position at a time per rule.
- News pause as the live bot: no entry within 30 minutes of an NFP / CPI / FOMC release in
  `research/news/us_events.csv`.
- **R** = net result per oz / stop distance (from the entry fill). PF on R.
- The engine must reproduce the earlier study's train numbers for the unfiltered rules (X = none,
  minimum stop $2) before anything else is read: NY 1,161 trades PF 0.61 -227.3 R; S1 309 / 0.98 /
  -3.1; S2 309 / 1.01 / +1.0; S3 309 / 0.99 / -1.3; S4 309 / 0.98 / -3.5.

### Rules tested

1. **NY** = the live New York breakout exactly as `config.py` (`intraday2.ny_candidates`: 08:30-11:30
   ET, M30, 60-minute range, close beyond it in the D1 EMA50 direction, stop clamped to 0.5-1.0 x ATR14,
   target 2R, time exit 11:30 ET, one trade per session). Minimum stop as live (`strategy.levels`): a
   stop closer than m to the entry fill **skips** the trade.
2. **H1 trend-filtered squeeze** (`research/squeeze.py`, H1, N = 8, daily EMA50 trend filter, time exit
   16:55 New York), four points: **S1** stop 1.0 x ATR, 2R (the earlier study's best-ranked B point);
   **S2** middle-band stop, 3R (the only B point with train PF > 1.0); **S3** middle-band stop, 2R and
   **S4** 1.5 x ATR stop, 2R (the wider-stop variants noted as near break-even). Minimum stop as in the
   earlier study: a stop closer than m is **widened** to m.

### The filter F

- **Expected round-trip cost** = the signal candle's spread (median of ask - bid at the minute closes
  of the signal candle, the same as `intraday2.mid_bars`' per-candle spread) + 2 x $0.10 slippage
  (+ $0.07 commission in the low-cost scenario). Known at the signal; the stop distance is the one the
  trade would use (from the entry fill, after the minimum-stop rule), known at entry.
- **Skip** the candidate when expected cost > X x stop distance. A skipped NY candidate is treated
  like any other blocked one (a later signal bar the same session may still trade); a skipped squeeze
  setup is lost.
- Grid: **X in {none, 5%, 8%, 12%}** x **minimum stop m in {$2 (live), $4}** x 5 rules = **40 points**.

### Cost settings

- **Base (used for all selection and the verdict):** real bid/ask + $0.10/oz per fill.
- **Costs x1.5 (stress):** every fill pays an extra 0.25 x that minute's spread and slippage x 1.5
  (as the earlier study). The filter's decisions stay those of the base estimate (same trades).
- **Low-cost broker scenario (labelled as a scenario, never used for the main verdict):** per minute
  the spread is capped at $0.15 (bid and ask rebuilt around the same mid), plus $0.07/oz commission round
  trip; slippage stays $0.10 per fill. The filter's expected cost uses the capped spread + commission.
  Selection, walk-forward and checks are re-run inside the scenario.

### Split and evidence

- **Train 2003-05-05 - 2018-12-31:** the full 40-point grid. Train choice of X per (rule, m) = highest
  train total R (ties -> less filtering: none, 12%, 8%, 5%).
- **Walk-forward (main evidence):** for each (rule, m) and each year Y = 2008 ... 2026, choose X with the
  highest total R over Y-5 ... Y-1 (same tie rule), trade year Y with it, stitch the years. Reported for
  the whole 2008-2026 and split 2008-2018 / 2019-2026. Also reported for information (no verdict
  weight): a family-level walk-forward choosing (m, X) for NY and (rule, m, X) for the squeeze.
- **2019-2026 "holdout":** already seen by four earlier studies, so every result there is labelled
  **contaminated holdout, weak evidence**. Run for the train choice of each (rule, m).
- Trades belong to a year by entry time. Indicators run continuously.

### Metrics

Trades, trades/year, win %, PF (R), total R, average cost in R (spread + slippage + commission over
risk), gross PF, $ result and worst drop with live sizing (`sizing.lot_size`, $500, 1%), worst drop of
cumulative R at a fixed 1% (1 R = 1% of $500), per-year table, losing years.

### Verdict (per (rule, m) walk-forward, base costs)

**"Worth paper-tracking"** only if all hold, otherwise **"Not worth it"**:

1. walk-forward PF > 1.15 with >= 150 trades;
2. losing years <= 40% of the walk-forward years with trades;
3. robust to the neighbouring X: the fixed-X runs over 2008-2026 at the X chosen most often in the
   walk-forward and at its neighbours in the ordered grid (5% - 8% - 12% - none) all have PF > 1.0;
4. PF > 1.0 with costs x1.5 (same yearly X choices).

There are 10 (rule, m) walk-forwards, so one pass by luck is possible; a pass would be reported with
that caveat. The low-cost scenario gets the same four checks, reported separately as "would a cheaper
broker change the answer".

---

## 2. Engine checks (fake prices only, before any real-data result)

`python -m research.costfilter_null`, output in `research/costfilter_results/null_output.txt`. Fake
prices = the driftless random walk of `research/intraday2_null.py` with a random spread (hourly level
around $0.30, minute noise, independent of price) so the filter has something to select on.

- **Same engine as before.** With X = none, m = $2 and no commission, `costfilter.run_many` reproduces
  `intraday2.run_many` trade for trade (401 fake trades in the 5 rules, $0.30 spread, $0.10
  slippage: 0 rules differ).
- **Filter does what it says.** 0 kept trades with expected cost > X x risk; the signal spread equals
  the signal candle's median spread from `intraday2.mid_bars` (1,786 trades compared, 0 differ). Kept
  trades on fake data (5 rules, m = $2): none 412, 12% 321, 8% 125, 5% 44.
- **No peeking.** 12 random cut times on 1.5 years of fake minutes; every minute after the cut deleted
  and candidates, bars, daily table and trades rebuilt for all 40 specs: 5,677 trades closed before the
  cut compared, **0 differ**.
- **Null test (random walk).** 24 random walks x 3 years, both cost settings (base and low-cost), both
  minimum stops pooled: gross R per trade (before costs) must be ~0 for every rule and X. 36 of the 37
  non-empty groups are within 2.1 standard errors of zero; one (NY X=8%, base) was -0.074 R (z = -2.88).
  Re-run on 72 fresh seeds it was +0.011 R (se 0.017; none +0.004, 12% +0.006), so that was noise: the
  filter itself does not create gross edge on prices that have none. Net R is gross minus costs, as it
  should be (NY about -0.12 R per trade, squeeze -0.01 to -0.15 R).
- **Reproduces the earlier baseline on real data.** X = none, m = $2, train 2003-05-05 - 2018-12-31
  (`python -m research.run_costfilter repro`, `repro_output.md`): NY 1,161 trades PF 0.61 -227.3 R;
  S1 309 / 0.98 / -3.1; S2 309 / 1.01 / +1.0; S3 309 / 0.99 / -1.3; S4 309 / 0.98 / -3.5. All five
  match `docs/london-squeeze-research.md` exactly. The unfiltered holdout rows match too (NY 726 trades
  PF 0.82 -64.8 R; S1 113 / 0.67 / -23.9).
- **Cost stress keeps the same trades.** The minimum-stop rule, the filter and the stop / target prices
  are decided from the base-cost fill; costs x1.5 only worsen the fills. Checked: all 40 specs have the
  same trade count at base and x1.5 (10,203 trades), and at low and low x1.5 (13,323).

---

## 3. Train grid (2003-05-05 - 2018-12-31, base costs)

*Run 2026-10-06 06:49 UTC.* Full table in `research/costfilter_results/train_base.md`. PF and R are net;
"gross" is before spread and slippage; "cost" is the average cost per trade in R.

| rule, m | X = none | X = 12% | X = 8% | X = 5% | train choice |
|---|---|---|---|---|---|
| NY m=$2 | 1,161 tr, PF 0.61, -227 R (gross 1.00) | 126, 0.75, -14.7 (gross 0.98) | 20, 0.63, -3.5 | 3, 2.10, +1.1 | 5% |
| NY m=$4 | 235, 0.72, -30.9 | 123, 0.74, -14.8 | 20, 0.63, -3.5 | 3, 2.10, +1.1 | 5% |
| S1 m=$2 | 309, 0.98, -3.1 (gross 1.55) | 15, 1.03, +0.2 | 1, -, -0.1 | 0 | 12% |
| S1 m=$4 | 309, 0.99, -0.9 | 53, 0.81, -5.3 | 1, -, -0.1 | 0 | 5% (no trades) |
| S2 m=$2 | 309, 1.01, +1.0 (gross 1.44) | 175, 1.08, +4.7 | 97, 0.95, -1.6 | 26, 0.89, -0.6 | 12% |
| S2 m=$4 | 309, 1.02, +1.8 | 181, 1.05, +3.5 | 97, 0.95, -1.6 | 26, 0.89, -0.6 | 12% |
| S3 m=$2 | 309, 0.99, -1.3 | 175, 1.04, +2.6 | 97, 0.96, -1.2 | 26, 1.03, +0.2 | 12% |
| S3 m=$4 | 309, 0.98, -2.5 | 181, 1.02, +1.3 | 97, 0.96, -1.2 | 26, 1.03, +0.2 | 12% |
| S4 m=$2 | 309, 0.98, -3.5 | 81, 0.92, -3.2 | 15, 1.29, +1.7 | 1, -, -0.0 | 8% |
| S4 m=$4 | 309, 0.98, -2.3 | 103, 0.83, -8.9 | 15, 1.29, +1.7 | 1, -, -0.0 | 8% |

**Reading the train grid.**
- **On 2003-2018 the filter does not rescue the New York breakout.** It cuts the cost per trade from
  0.20 R to 0.08-0.11 R, but the trades it keeps have no gross edge either (gross PF 0.76-0.98), so
  they still lose (PF 0.63-0.75). Before 2008 gold's stops were $2-3 against about $0.65 of expected
  cost (spread + $0.20), so X <= 12% removes every trade.
- **Section 7 (post-hoc) shows why:** on 2003-2018 the New York breakout's gross R is about 0 at every
  cost / stop level. A filter can only remove costs; it cannot create an edge that is not there.
- **Squeeze:** the filter moves PF by a few hundredths at most (best S2 m=$2 X=12%, PF 1.08 on 175
  trades, 6 losing years of 15). Nothing reaches the PF the verdict needs.
- The minimum stop $4 matters little: for NY, with X <= 12% the filter already demands a stop of
  about $4-6 or more, so m = $2 and m = $4 give almost the same trades.

## 4. Walk-forward 2008-2026 (main evidence, base costs)

*Run 2026-10-06 06:49 UTC.* Each year's X is chosen on the prior 5 years only. Full output in
`wf_base.md`. Years 2019-2026 are the contaminated period (shown separately).

| walk-forward | trades | /yr | win % | PF | gross PF | total R | cost R | drop (R at 1%) | $ live sizing | $ drop | losing yrs | 2008-2018 part | 2019-2026 part |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **NY m=$2** | 163 | 8.7 | 45.4 | **1.28** | 1.52 | +17.5 | 0.075 | -10.3% | +$185.72 | -34.5% | 3 / 10 | 54 tr, PF 0.93, -1.8 R | 109 tr, PF 1.50, +19.3 R |
| NY m=$4 | identical to m=$2 (163 trades) | | | | | | | | | | | | |
| S1 m=$2 | 153 | 8.2 | 37.3 | 0.91 | 1.19 | -8.0 | 0.148 | -16.8% | -$35.40 | -20.5% | 11 / 16 | PF 1.05 | PF 0.79 |
| S1 m=$4 | 187 | 10.0 | 38.5 | 0.89 | 1.16 | -10.9 | 0.135 | -23.7% | -$45.36 | -24.7% | 11 / 17 | PF 0.93 | PF 0.54 |
| S2 m=$2 | 231 | 12.3 | 45.0 | 1.01 | 1.22 | +0.8 | 0.073 | -16.3% | +$45.76 | -34.4% | 11 / 19 | PF 1.12 | PF 0.78 |
| S2 m=$4 | 226 | 12.1 | 45.1 | 1.05 | 1.27 | +3.8 | 0.074 | -9.9% | +$69.24 | -27.3% | 12 / 19 | PF 1.07 | PF 0.95 |
| S3 m=$2 | 235 | 12.5 | 45.1 | 0.97 | 1.18 | -3.1 | 0.074 | -15.2% | +$22.24 | -32.7% | 12 / 19 | PF 1.01 | PF 0.83 |
| S3 m=$4 | 221 | 11.8 | 45.2 | 0.94 | 1.15 | -5.0 | 0.072 | -13.2% | +$15.15 | -31.5% | 12 / 19 | PF 0.97 | PF 0.87 |
| S4 m=$2 | 167 | 8.9 | 40.7 | 1.01 | 1.25 | +0.8 | 0.102 | -14.9% | +$32.70 | -28.9% | 8 / 16 | PF 1.09 | PF 0.86 |
| S4 m=$4 | 167 | 8.9 | 40.1 | 0.90 | 1.12 | -8.3 | 0.103 | -15.8% | -$27.48 | -25.9% | 9 / 16 | PF 0.96 | PF 0.72 |
| *NY family (m, X), info* | 163 | 8.7 | 45.4 | 1.28 | 1.52 | +17.5 | | | | | 3 / 10 | | |
| *Squeeze family (rule, m, X), info* | 233 | 12.4 | 39.1 | 0.84 | 1.07 | -19.2 | 0.114 | -26.4% | -$126.30 | -38.6% | 12 / 19 | | |

X chosen per year for NY (m=$2 and $4 alike): 2008 12%, 2009 8%, 2010-2011 12%, **2012-2021 5%**
(which kept 0-1 trades a year: in effect "don't trade"), **2022-2026 8%**.

New York walk-forward, R (trades) per year: 2008 -0.9 (12), 2009-2010 0, 2011 -3.0 (40), 2012 0,
2013 +2.0 (1), 2014-2015 0, 2016 +0.1 (1), 2017-2019 0, 2020 -0.7 (1), 2021 0, 2022 +1.9 (3),
2023 +0.9 (1), 2024 +4.3 (8), **2025 +11.2 (30)**, 2026 +1.6 (66). The squeeze per-year tables are in
`wf_base.md`.

**Pre-registered verdict checks:**

| walk-forward | PF > 1.15 and >= 150 trades | losing years <= 40% | neighbouring X PF > 1.0 (fixed X, 2008-2026) | PF at costs x1.5 | verdict |
|---|---|---|---|---|---|
| NY m=$2 | 1.28 / 163 pass | 3 / 10 pass | modal 5%: 5% 1.30 (38 tr), 8% 1.31 (136 tr) pass | 1.17 pass | **Worth paper-tracking** |
| NY m=$4 | same trades as m=$2 | | | | **Worth paper-tracking** (same result) |
| S1 m=$2 | 0.91 FAIL | 11 / 16 FAIL | 8% 0.98, 12% 0.98, none 0.90 FAIL | 0.80 FAIL | Not worth it |
| S1 m=$4 | 0.89 FAIL | 11 / 17 FAIL | 12% 0.83, none 0.88 FAIL | 0.79 FAIL | Not worth it |
| S2 m=$2 | 1.01 FAIL | 11 / 19 FAIL | 8% 1.04, 12% 1.08, none 1.03 pass | 0.92 FAIL | Not worth it |
| S2 m=$4 | 1.05 FAIL | 12 / 19 FAIL | 12% 1.04, none 1.02 pass | 0.95 FAIL | Not worth it |
| S3 m=$2 | 0.97 FAIL | 12 / 19 FAIL | 12% 1.06, none 0.99 FAIL | 0.88 FAIL | Not worth it |
| S3 m=$4 | 0.94 FAIL | 12 / 19 FAIL | 5% 0.88, 8% 1.05, 12% 1.02 FAIL | 0.85 FAIL | Not worth it |
| S4 m=$2 | 1.01 FAIL | 8 / 16 FAIL | 8% 1.09, 12% 0.90, none 0.96 FAIL | 0.91 FAIL | Not worth it |
| S4 m=$4 | 0.90 FAIL | 9 / 16 FAIL | 12% 0.84, none 0.95 FAIL | 0.81 FAIL | Not worth it |

The fixed-X New York runs over 2008-2026: none 1,683 trades PF 0.72 (-228 R); 12% 473, PF 0.93
(-14.4 R); 8% 136, PF 1.31 (+15.8 R); 5% 38, PF 1.30 (+4.6 R).

## 5. Contaminated holdout (2019-01-01 - 2026-09-30): weak evidence

The train choice of each (rule, m), run on years that four earlier studies have already looked at
(`holdout_base.md`):

| rule, m, train X | trades | PF | total R | $ live sizing | PF costs x1.5 | unfiltered on the same years |
|---|---|---|---|---|---|---|
| NY m=$2 / $4, X=5% | 35 | 1.24 | +3.5 | +$40.18 | 1.18 | 726 tr, PF 0.82, -64.8 R |
| S1 m=$2, X=12% | 53 | 0.96 | -1.0 | +$8.66 | 0.88 | 113, 0.67, -23.9 |
| S1 m=$4, X=5% | 4 | 1.97 | +1.0 | +$24.81 | 1.85 | 113, 0.74, -17.7 |
| S2 m=$2, X=12% | 109 | 1.09 | +3.5 | +$66.88 | 1.00 | 113, 0.99, -0.6 |
| S2 m=$4, X=12% | 111 | 1.04 | +1.5 | +$58.68 | 0.95 | 113, 0.99, -0.6 |
| S3 m=$2, X=12% | 109 | 1.10 | +3.6 | +$67.66 | 1.00 | 113, 0.99, -0.5 |
| S3 m=$4, X=12% | 111 | 1.04 | +1.6 | +$59.46 | 0.95 | 113, 0.99, -0.5 |
| S4 m=$2 / $4, X=8% | 53 | 1.03 | +0.7 | +$20.76 | 0.95 | 113, 0.93, -4.1 |

The filter improved every row on these years (it always removed the highest-cost trades). But only the
New York X=5% row is clearly positive, on 35 trades, 26 of them in 2026.

## 6. Low-cost broker scenario (spread capped at $0.15 + $0.07/oz commission)

*A scenario, not the main result.* Same pipeline, with selection and the walk-forward re-run inside the
scenario (`train_low.md`, `wf_low.md`, `holdout_low.md`). Slippage stays $0.10 per fill. The expected
cost is lower (capped spread + $0.20 + $0.07, about $0.42 vs $0.50-0.80), so the same X keeps more
trades.

| | train, unfiltered (PF) | walk-forward (trades, PF, total R) | losing years | neighbour X | costs x1.5 | verdict in the scenario |
|---|---|---|---|---|---|---|
| NY m=$2 / $4 | 0.72 / 0.75 | 194, **1.26**, +19.4 (2008-2018 PF 1.06; 2019-2026 PF 1.39) | 4 / 14 | 5% 1.23, 8% 1.07, **12% 0.85** FAIL | 1.19 | Not worth it |
| S1 m=$2 | 1.16 | 246, 1.07, +10.0 | 7 / 19 | FAIL | 0.97 | Not worth it |
| S1 m=$4 | 1.10 | 210, 1.13, +14.6 | 7 / 17 FAIL | FAIL | 1.04 | Not worth it |
| S2 m=$2 / $4 | 1.11 / 1.12 | 256 / 251, 1.12 / 1.13 | 11 / 19 FAIL | pass | 1.04 / 1.06 | Not worth it |
| S3 m=$2 / $4 | 1.07 / 1.08 | 247, 1.13 | 10 / 18 FAIL | pass | 1.05 | Not worth it |
| S4 m=$2 | 1.12 | 248, 1.12, +14.2 | 9 / 17 FAIL | pass | 1.04 | Not worth it |
| S4 m=$4 | 1.11 | 244, **1.19**, +21.6 (2008-2018 PF 1.19; 2019-2026 PF 1.19) | **8 / 17 FAIL** | pass | 1.11 | Not worth it (fails only on losing years) |
| *Squeeze family, info* | | 290, 1.01, +1.2 | 10 / 19 | | 0.92 | |

**What a cheaper broker would change:**
- The New York breakout still loses unfiltered (train PF 0.72, 2008-2026 PF 0.81).
- The filtered New York walk-forward stays around PF 1.26. It fails the scenario's neighbour check,
  because with cheaper costs X = 12% lets in many more marginal trades (PF 0.85).
- The squeeze goes from break-even to modestly positive, with or without the filter (unfiltered train
  PF 1.07-1.16; walk-forward PF 1.07-1.19). It still loses in 40-60% of years. S4 m=$4 is the closest
  to the bar and fails only on losing years (8 of 17).
- The filter itself matters little here: at a $0.42 expected cost, X = 12% already passes almost every
  squeeze trade.
- So a raw-spread account would turn the squeeze from a slow loser into a marginal, lumpy
  small-winner. It would not change the verdict for either rule.

## 7. Post-hoc diagnostics (written after the walk-forward, no verdict weight)

`python -m research.run_costfilter diag`, `diag_ny.md`. They explain the New York pass.

- **Before 2019, low-cost New York trades had no edge either.** The unfiltered New York trades are
  split by expected cost / stop below.

  | period | expected cost / stop | trades | gross R / trade | cost R / trade | net PF |
  |---|---|---|---|---|---|
  | 2003-2018 | 5-8% | 13 | -0.16 | 0.08 | 0.55 |
  | 2003-2018 | 8-12% | 99 | +0.02 | 0.11 | 0.80 |
  | 2003-2018 | 12-20% | 502 | -0.00 | 0.17 | 0.64 |
  | 2003-2018 | > 20% | 546 | -0.00 | 0.24 | 0.54 |
  | 2019-2026 | < 5% | 32 | +0.20 | 0.05 | 1.37 |
  | 2019-2026 | 5-8% | 74 | +0.25 | 0.07 | 1.54 |
  | 2019-2026 | 8-12% | 214 | +0.05 | 0.11 | 0.87 |
  | 2019-2026 | 12-20% | 356 | -0.01 | 0.15 | 0.69 |

  On 2003-2018 the gross edge is zero at every level, so removing costly trades only reduced losses.
  On 2019-2026 the wide-stop trades (cost < 8% of the stop) had a real gross edge of +0.2 R. Those are
  the high-volatility days of 2024-2026.
- **Random benchmark.** Within the same years, the walk-forward's New York trades beat 100% of 2,000
  random subsets of the same size drawn from that year's unfiltered trades (random median PF 0.87,
  90th percentile 1.02). So inside 2019-2026 the selection is not luck. But that is the contaminated
  period, and the same selection did nothing before 2019.
- **Concentration.**
  - 2025 alone is +11.2 R of the +17.5 R (64%).
  - 67% of the trades are in 2019-2026.
  - In 9 of the 19 walk-forward years there was no trade at all.
- **Today the filter would hardly bite.** In 2026 the median New York stop is $14.91 against about
  $0.81 of expected cost (5%), so X = 8% kept 66 of 69 signals.
- **Live sizing on $500.**
  - The median walk-forward stop is $11.57.
  - On 102 of the 163 trades even 0.01 lot risks more than 2% of $500 (`lot_size` says "skip"; counted
    at 0.01 lot). On 53 more it says "high".
  - So the $ column is at 2-5% risk per trade for most of these trades, not 1%. That is also why the
    $ drop (-34.5%) is much deeper than the R drop (-10.3%).

## 8. Verdicts

| rule | verdict (pre-registered, base costs) | low-cost scenario |
|---|---|---|
| New York breakout + cost filter (m = $2 or $4) | **Worth paper-tracking**: passes all four checks. Fragile; see the caveats below | Not worth it (fails the neighbour check at X = 12%) |
| H1 squeeze S1 (1.0 x ATR stop, 2R) | Not worth it | Not worth it |
| H1 squeeze S2 (middle-band stop, 3R) | Not worth it | Not worth it |
| H1 squeeze S3 (middle-band stop, 2R) | Not worth it | Not worth it |
| H1 squeeze S4 (1.5 x ATR stop, 2R) | Not worth it | Not worth it (m = $4: PF 1.19, fails only on losing years) |

**Why the New York pass is weak, even though it meets the bar:**
- All of its profit comes from 2019-2026, the contaminated years. Its 2008-2018 part lost (PF 0.93).
- 2025 alone is 64% of the R.
- The filtered rule lost on train (X = 12%: PF 0.75 on 126 trades; X = 8%: PF 0.63 on 20).
- The pass happened because the walk-forward chose X = 5% for 2012-2021, which in practice meant "don't
  trade" through the losing years. It then switched to 8% just before gold's high-volatility 2024-2025.
- With 10 walk-forwards tested (6 distinct, since NY m = $2 and $4 coincide), one pass by luck is
  plausible.

## 9. Plain-English recommendation

- **Squeeze: drop it.** No cost filter makes the H1 squeeze worth trading at Dukascopy-like costs. A
  cheaper raw-spread broker would make it roughly break-even to slightly positive, but it would still
  lose in about half the years.
- **New York breakout with a cost filter: technically passes, practically unproven.**
  - The rule that passed: skip a New York signal when (signal-candle spread + $0.20) > X x stop
    distance, X = 8% (the walk-forward's choice for 2022-2026). The minimum stop stays $2, as now; $4
    changes nothing.
  - What it really did in the backtest was "only trade on very volatile days". That paid in 2024-2025
    and did nothing before 2019.
- **Recommendation: do not change the live bot's trading on this evidence.**
  - If you want to follow it, paper-track it: record for each live New York signal whether it would
    pass X = 8% (expected cost / stop), and compare the two groups after 6-12 months of new data.
  - At today's volatility the filter would block almost nothing (66 of 69 signals in 2026 passed). So
    adding it now would barely change the live bot, and there is no hurry.
- **Practical warning for a $500 account.** The trades this filter keeps have $10-15+ stops. Even 0.01
  lot then risks 2-5% of $500, so the bot's 1% sizing cannot be followed on most of them.
- Nothing was implemented live.

**Caveats.**
- **Costs.**
  - Dukascopy's spread is one ECN's feed; before 2011 it was nearly fixed ($0.41-0.55).
  - $0.10 per fill slippage is an assumption.
  - Expected cost uses the signal candle's median spread, not the exact entry quote.
- **News pause.** Only NFP / CPI / FOMC (the live Forex Factory feed pauses for more events).
- **Squeeze minimum stop.** The squeeze widens stops below m (as the earlier study); the live bot
  would skip instead.
- **Low-cost scenario.** The $0.15 spread cap is applied minute by minute around the Dukascopy mid; a
  real raw-spread account's spread can widen beyond $0.15 around news and at the daily reopen.
- **Stress test.** Costs x1.5 keep the base-cost decisions and levels; only the fills are worse.
- **Sizing.** Live-sizing $ uses a fixed $500, not compounded; trades that `lot_size` marks "skip" are
  counted at 0.01 lot.

**Deviations from the brief.** None in the rules. The tie rule (less filtering wins), "losing years"
counted over years with trades, the neighbour check (fixed-X PF over 2008-2026 at the modal X and its
neighbours) and keeping the same trades under the stress were fixed in the plan. Section 7 is post-hoc,
added only to explain the New York pass, with no verdict weight.

**Reproduce:** `python -m research.costfilter_null`, then `python -m research.run_costfilter runs`,
`repro`, `train`, `wf`, `holdout`, `diag`, and `train low`, `wf low`, `holdout low`. Raw outputs are in
`research/costfilter_results/`; the cached trades are under `cache/` (git-ignored by its own
`.gitignore`).
