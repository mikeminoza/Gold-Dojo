# Research: is there a robust daily-candle swing edge on 23 years of real XAUUSD?

**Goal.** Find out whether a small, pre-registered family of daily-candle swing strategies (trend
breakouts, trend pullbacks, time-series momentum) has an edge on 2003-2026 Dukascopy XAUUSD that
holds up on an untouched holdout and adds something over simply holding gold. "Nothing survives" is
a valid outcome. Nothing here changes the live bot or `config.py`.

**Status (2026-10-02): done. Verdict: nothing is "Robust".** No variant passed the pre-registered
train selection (two were eligible, both failed the stability rule), so there are no finalists. On
the holdout, the reference rows all made money (PF 1.25-2.87), but none beat simply holding gold per
unit of drawdown, and their shorts lost. See sections 4-8.

**Code:** `research/swing.py` (indicators, signals, daily engine, metrics), `research/run_swing.py`
(experiments), `research/swing_null.py` (engine checks on fake prices). Results saved to
`research/swing_results/`. Same data as `docs/strategy-research.md`.

---

## 1. Pre-registered plan

*Written 2026-10-02 05:30 UTC, before any variant was run on XAUUSD data.*

Disclosure: before writing this I looked only at data facts, not strategy results: row counts,
first/last dates, per-year median close, median Wilder-style ATR20 and median daily spread (section 3).
I have not run any S1-S4 rule on real XAUUSD. The engine may be smoke-tested on random-walk prices
first (section 2).

### Split

- **Train:** 2003-05-05 - 2018-12-31. **Holdout:** 2019-01-01 - 2026-09-30, evaluated **once** per
  finalist after finalists are frozen (the holdout command refuses a second run).
- Indicators are computed once on the full daily series (they only look backwards), so the first
  holdout days use pre-2019 candles for warm-up. For train runs the engine is given candles before
  2019 only; a train position still open on 2018-12-31 is closed at that day's close. Trades belong
  to train / holdout by **entry date**. Holdout runs use the full series; a position open at the
  end of data is closed at the last close.

### Common rules (all variants)

- **Timing.** A signal is computed from the closed daily candle t (UTC day, weekdays, gold market
  hours, as built by `research/dukascopy.py`). Entry at the open of day t+1. One position at a time
  per variant. While a position is open, new signals are ignored. A position closed during day j can
  be replaced by a signal at the close of day j (entry j+1).
- **ATR20** = Wilder ATR, period 20 (same formula as `research.strategies.wilder_atr`), of candle t.
- **Stops are resting orders.** Initial stop is measured from the **actual entry price** (next open).
  A stop that moves (trailing, channel) is recomputed after each close and applies from the next day;
  it never loosens. A stop is filled at the stop price, or at the day's open if the day opened past
  it. A target is filled at the target, or at the open if the day gapped past it.
- **Stop and target on the same day** (only S2 with the 3R target can have both): resolve with the
  real intraday path. Walk that day's H1 candles in order; the first H1 candle touching either level
  decides. If one H1 candle touches both, walk its two M30 candles. If one M30 candle touches both,
  the stop wins (worst case). Counts of each resolution are reported.
- **Minimum stop distance:** skip the trade if the initial stop is less than $2.00/oz from the
  actual entry (as the live bot's `MIN_STOP_DISTANCE`).
- **Costs (per trade):**
  - spread: that entry day's median spread from the data (`spread` column, $/oz, point = 1.0),
    at least $0.25 (`BACKTEST_MIN_SPREAD`), paid once;
  - slippage: $0.20/oz on the entry fill and $0.20/oz on the exit fill (stops, targets, time exits
    alike);
  - swap / financing: **0.02% of the entry price per calendar night held**, longs and shorts alike
    (nights = calendar days from entry date to exit date, so a weekend counts 2-3 nights, as brokers'
    triple-swap does). That is about 7.3% a year of notional, in the range of retail XAUUSD CFD swap
    rates in 2023-2026 (longs typically -0.01% to -0.03%/night). It is an assumption: historic broker
    swaps are not in the data, and shorts were often charged less (or paid) in low-rate years.
- **Profit factor** is computed on **R multiples** (sum of winning R / sum of losing R). Gold went
  from $340 to $4,500, so PF in $/oz would mostly measure the last few years. Net R = net $/oz result
  / initial stop distance.
- **Sizing.** `sizing.lot_size(entry, stop, target)` on a fixed $500 balance at 1% risk, not
  compounded (as `backtest.summarize`). Two versions, both reported:
  - **cent account** (`config.OZ_PER_LOT = 1`, set at runtime inside the research code only, as the
    `config.py` comment describes): sizes daily-sized stops close to 1% risk. **This is the $ result
    and worst drop used for the verdict.**
  - **live config as is** (standard account, 1 lot = 100 oz, min 0.01 lot = 1 oz): reported for
    reference. With daily stops of 2-3 x ATR20 ($10-$300/oz, section 3) even 0.01 lot risks 2-60% of
    $500, so almost every trade is forced to the minimum lot and gets `lot_size` verdict "skip". The
    count of such trades is reported.
  - For trailing exits, `lot_size` gets a nominal target of 2R (only its "reward" field uses it).

### Variants and grids

| id | variant | grid |
|---|---|---|
| S1 | Donchian breakout, long and short. Long when close_t > highest high of the N days before t; short when close_t < lowest low of the N days before t. Initial stop = k x ATR20. Exit: "channel" = stop also moves to the lowest low (long) / highest high (short) of the last M = N/2 days (M = 10 / 27 / 50), or "trail" = stop moves to highest high since entry - k x ATR20 (short mirrored), ATR of the latest closed day | N in {20, 55, 100} x k in {2, 3} x exit in {channel, trail} = 12 |
| S2 | Trend + pullback to EMA20, long and short. Trend up = close > SMA200 ("sma200") or SMA50 > SMA200 ("50>200") on day t. Long when trend up, close_(t-1) <= EMA20_(t-1) and close_t > EMA20_t (short mirrored). Stop 2 x ATR20. Exit: "3R" fixed target at 3R, or "trail" = stop moves to highest high since entry - 2 x ATR20, no target | trend in {sma200, 50>200} x exit in {3R, trail} = 4 |
| S3 | Time-series momentum. At each month's last trading day, side = sign of the close vs the close at the month-end L months earlier (0 = flat). Enter at the next open; hold until the next rebalance open (or stop); stop 3 x ATR20 from entry, fixed. Each month is one trade and pays full costs (conservative: a real account carrying the same side would only pay to resize). After a stop-out, flat until the next rebalance | L in {3, 6, 12} months = 3 |
| S4 | Long-only versions of the best-on-train S1 and best-on-train S2 grid point (best = first by the ranking rule below, among all grid points, eligible or not). Run as their own strategies (shorts removed, so longs are not blocked by shorts) | S4-S1, S4-S2 |

For stability checks, long-only versions of all S1 and S2 grid points are run on train too, but only
the two S4 points above are candidates. Shorts' contribution (R and PF of short trades) is reported
for every long/short variant.

Grid neighbours (one step): S1 = N one step either way, the other k, the other exit; S2 = the other
trend, the other exit; S3 = L one step either way; S4 = long-only versions of its parent's neighbours.

### Metrics

Trades, trades/year, win %, PF (R), total R, $ result and worst drop % on $500 (cent sizing,
closed trades, `backtest._drawdown`), worst drop % marked to market on daily closes, per-year table
(trades, PF, R, $), losing years (calendar years with net R < 0) / years, longest losing streak,
average hold (trading days, entry day = 1), exposure % (share of trading days with a position),
long R / short R, standard-account $ result and "skip" count.

### Choosing finalists (train only)

1. **Eligible:** >= 60 train trades, train PF >= 1.20, closed-trade worst drop smaller than 30% of
   $500, losing years <= 6 of 16.
2. **Stable:** every grid neighbour has train PF >= 1.0 and within 0.25 of the candidate's PF
   (0.25 rather than the intraday study's 0.15: daily strategies have 5-10x fewer trades, so PF is
   noisier).
3. Rank eligible + stable candidates by train PF; ties (within 0.05) broken by fewer losing years,
   then smaller worst drop. **At most 3 finalists, at most one per family (S1, S2, S3, S4).**
4. If nothing qualifies, there are no finalists. The holdout is then run once for the reference
   rows only: the best-ranked point of each family (reported, no verdict) and buy-and-hold.

### Holdout and robustness (finalists only, once, no re-selection)

- Holdout metrics + per-year table.
- +/-1 grid step parameter perturbation on holdout (reported, not used to select).
- **Cost stress:** spread, slippage and swap all x 1.5.
- **Random-entry benchmark:** the finalist's holdout trade count and hold lengths; each random trade
  gets a random entry day in the holdout (overlap allowed), a random direction (50/50), the
  finalist's initial stop multiple x ATR20 from the entry open as a stop, and a time exit at the
  close of its hold length; same cost model. 1,000 runs; report the finalist's PF percentile.
  Extra (no verdict weight): for a long-only finalist, the same with all random trades long.
- **Buy-and-hold** on the same period, $500 notional held at constant size (rebalanced daily, not
  compounded, so it is comparable with the strategy's fixed-$500 sizing), with and without the same
  0.02%/night financing. Compared on **return per unit of drawdown** = average yearly $ result /
  worst marked-to-market drop in $ (leverage-free), plus Sharpe of daily $ results.
- **Verdict "Robust"** only if all of these hold on the holdout:
  holdout PF > 1.2; >= 40 holdout trades; worst drop (cent sizing, marked to market) < 30% of $500;
  PF beats >= 90% of random-entry runs; PF > 1.0 under the x1.5 cost stress; and it adds something
  over buy-and-hold: return per unit of drawdown above buy-and-hold's (spot, no financing - the
  harder benchmark), **or** short trades profitable on the holdout (short PF > 1.0 with >= 15 short
  trades). Otherwise "Not robust".

### Addendum, written after the train run and before any holdout run (2026-10-02 05:37 UTC)

The train run (section 4) produced **no finalists**: two points were eligible (S1 N=100 k=2 trail and
S4 long-only S2 50>200 trail) and both failed the stability rule. As pre-registered, the holdout is
run once for reference rows only (best-ranked point of each family + buy-and-hold), with **no
verdict**. Declared now, before the holdout is seen: the reference rows and the second eligible point
(S4 long-only S2 50>200 trail) also get the full robustness battery (cost x1.5, random entry,
buy-and-hold comparison, neighbours), reported as **"what the checks would have said", with no
verdict weight**. This cannot change the official result (no finalists = nothing "Robust").

---

## 2. Engine checks (before any real-data results)

All on fake prices (`python -m research.swing_null`), never on XAUUSD:

- **Null test.** 40 independent driftless random walks, 20 years each (M30 steps with a random gap at
  every day's open, resampled to H1 and D1), zero spread, slippage and swap. Every variant's average
  R per trade should be about 0. Result: all 19 variants between -0.034 and +0.020 R per trade, each
  within about 1.5 standard errors of zero (largest: S1 N=100 k=2 channel -0.034, se 0.042; S1 N=55
  k=3 channel +0.020, se 0.022; trailing exits +0.002..+0.013, se 0.011-0.018). No exit style is
  flattered by the fill model by more than ~0.02 R per trade; differences smaller than that on real
  data are noise. (Gap fills at the open cost stops a little, so slight negatives are expected.)
- **No peeking.** Signals and trades on a fake series vs the same series with everything after day
  3,000 deleted: identical for all 19 variants up to the cut.
- **Bookkeeping.** The daily marked-to-market $ series sums exactly to the trades' $ for every
  variant. One trade checked by hand on real data after the train run (S1 N=100 k=2 trail: entry
  2003-09-23 at $386.00, ATR $6.05, stop $373.89; trailed to $380.68 = the 2003-09-25 high of $393.12
  minus 2 x ATR $6.22; stopped 2003-09-26 at $380.68): matches the engine.
- **Intraday resolver.** Unit cases (target first in H1, stop first in H1, same H1 decided by M30,
  same M30 -> stop) all pass. On real data it was **never needed**: S2's 3R target sits 6 ATR from
  its stop, and no day in 2003-2026 touched both. All other variants have no target (stop only), so
  daily candles are enough and no worst-case assumption was used anywhere.

## 3. Data

- `data/xauusd_D1.parquet` (Dukascopy BID, built by `research/dukascopy.py`, see
  `docs/strategy-research.md` section 3): **6,055 daily candles, 2003-05-05 - 2026-09-30**, UTC
  days, weekdays, gold market-hours filter. 4,054 train days (to 2018-12-31), 2,001 holdout days.
  H1 (138,292) and M30 (276,316) candles available for intraday paths. Nothing was downloaded.
- Gaps: 4,818 next-day steps, 1,188 weekends, 47 holiday gaps of 2-4 days, one 7-day gap (to
  2004-03-11, missing in the source). 2003 has 173 days (starts in May).
- Daily volatility grew with the price. Median ATR20 and median daily spread ($/oz):

  | years | median close | ATR20 | spread | 0.01 lot (1 oz) at a 2 x ATR stop risks |
  |---|---|---|---|---|
  | 2003-2005 | 371-435 | 5.4-6.3 | 0.41-0.46 | 2.2-2.5% of $500 |
  | 2006-2013 | 612-1,663 | 9.7-26.1 | 0.34-0.51 | 3.9-10.4% |
  | 2014-2019 | 1,166-1,410 | 11.9-18.5 | 0.23-0.31 | 4.7-7.4% |
  | 2020-2024 | 1,774-2,381 | 23.0-33.5 | 0.33-0.41 | 9.2-13.4% |
  | 2025 | 3,347 | 52.1 | 0.57 | 20.9% |
  | 2026 (to Sep) | 4,509 | 113.6 | 0.67 | 45.4% |

  So on the live config ($500, standard account, min 0.01 lot = 1 oz) **no daily swing trade can be
  sized at 1%**: `lot_size` returned verdict "skip" for 95-100% of trades in every variant. All $
  figures below use the cent-account sizing declared in the plan (1 lot = 1 oz, sizes close to 1%;
  `lot_size` verdict "ok" for every trade).
- Spread and slippage are small here (about 0.03 R per trade together); **swap is the big cost**:
  0.09-0.55 R per trade (largest for the long-hold channel exits).

## 4. Train results (2003-05-05 - 2018-12-31)

*Run 2026-10-02 05:36 UTC, grids exactly as pre-registered.* PF and R are net of all costs; "result
$500" and "worst drop" are closed-trade on $500 at 1% (cent sizing); "MTM drop" is marked to market on
daily closes; "shorts" = count / net R / PF of the short trades; "gross PF" = before all costs;
"ret/drop" = average yearly $ / worst MTM drop in $. Buy-and-hold over the same period (spot, $500
constant notional): **ret/drop 0.19**, Sharpe 0.55, worst MTM drop -52.8%; with 0.02%/night financing:
ret/drop 0.03, Sharpe 0.15, worst drop -90.9%.

| id | trades | /yr | win % | PF | total R | result $500 | worst drop | MTM drop | losing yrs | loss streak | avg hold (d) | exposure | shorts n / R / PF | gross PF | ret/drop | elig. | stable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 N=20 k=2 channel | 150 | 9.6 | 33.3 | 0.75 | -18.3 | -88.78 | -19.4% | -19.8% | 13 / 16 | 7 | 16.5 | 61.0% | 70 / -21.4 / 0.42 | 1.15 | -0.06 | no | - |
| S1 N=20 k=2 trail | 173 | 11.0 | 36.4 | 1.12 | 7.2 | +34.13 | -11.1% | -11.4% | 6 / 16 | 8 | 10.6 | 45.2% | 78 / -11.5 / 0.64 | 1.55 | 0.04 | no | - |
| S1 N=20 k=3 channel | 147 | 9.4 | 34.7 | 0.77 | -11.1 | -52.13 | -11.6% | -12.7% | 13 / 16 | 7 | 17.5 | 63.4% | 70 / -15.5 / 0.4 | 1.19 | -0.05 | no | - |
| S1 N=20 k=3 trail | 133 | 8.5 | 35.3 | 0.9 | -5.2 | -24.04 | -8.5% | -8.7% | 9 / 16 | 7 | 20.0 | 65.6% | 62 / -14.7 / 0.45 | 1.34 | -0.04 | no | - |
| S1 N=55 k=2 channel | 68 | 4.3 | 25.0 | 0.72 | -14.8 | -72.38 | -17.3% | -21.7% | 10 / 16 | 9 | 30.5 | 51.1% | 31 / -20.0 / 0.29 | 1.2 | -0.04 | no | - |
| S1 N=55 k=2 trail | 101 | 6.5 | 35.6 | 1.15 | 5.9 | +27.44 | -7.0% | -7.7% | 6 / 16 | 6 | 9.6 | 24.0% | 40 / -5.8 / 0.67 | 1.52 | 0.05 | no | - |
| S1 N=55 k=3 channel | 63 | 4.0 | 27.0 | 0.62 | -15.8 | -76.29 | -17.1% | -18.5% | 11 / 16 | 9 | 37.6 | 58.4% | 28 / -16.2 / 0.25 | 1.04 | -0.05 | no | - |
| S1 N=55 k=3 trail | 78 | 5.0 | 35.9 | 0.91 | -2.9 | -14.11 | -6.4% | -7.1% | 10 / 16 | 6 | 18.5 | 35.7% | 32 / -8.5 / 0.4 | 1.29 | -0.03 | no | - |
| S1 N=100 k=2 channel | 34 | 2.2 | 23.5 | 1.03 | 1.0 | +6.36 | -13.6% | -19.6% | 9 / 15 | 13 | 48.8 | 40.9% | 12 / -5.2 / 0.52 | 1.97 | 0.0 | no | - |
| S1 N=100 k=2 trail | 64 | 4.1 | 45.3 | 1.79 | 15.5 | +75.64 | -3.4% | -4.1% | 5 / 16 | 4 | 9.5 | 15.0% | 18 / 3.8 / 1.81 | 2.36 | 0.24 | yes | no |
| S1 N=100 k=3 channel | 30 | 1.9 | 26.7 | 0.93 | -1.5 | -6.43 | -10.8% | -14.9% | 9 / 15 | 11 | 65.0 | 48.1% | 11 / -5.3 / 0.42 | 1.88 | -0.01 | no | - |
| S1 N=100 k=3 trail | 48 | 3.1 | 45.8 | 1.6 | 8.6 | +40.52 | -4.6% | -5.3% | 5 / 16 | 4 | 19.7 | 23.4% | 15 / 0.1 / 1.03 | 2.34 | 0.1 | no | - |
| S2 sma200 3R | 83 | 5.3 | 28.9 | 0.86 | -10.0 | -45.11 | -20.0% | -21.3% | 8 / 15 | 8 | 29.3 | 60.1% | 28 / -7.2 / 0.72 | 1.22 | -0.03 | no | - |
| S2 sma200 trail | 160 | 10.2 | 32.5 | 1.1 | 6.2 | +30.87 | -14.3% | -15.0% | 7 / 15 | 7 | 11.0 | 43.3% | 56 / -7.2 / 0.7 | 1.47 | 0.03 | no | - |
| S2 50>200 3R | 73 | 4.7 | 34.2 | 1.05 | 2.8 | +17.06 | -14.7% | -15.2% | 6 / 15 | 7 | 36.4 | 65.5% | 24 / -3.3 / 0.84 | 1.56 | 0.01 | no | - |
| S2 50>200 trail | 161 | 10.3 | 33.5 | 1.18 | 11.0 | +53.59 | -7.6% | -8.3% | 5 / 15 | 11 | 11.1 | 44.2% | 54 / -4.5 / 0.8 | 1.58 | 0.08 | no | - |
| S3 L=3m | 184 | 11.8 | 40.2 | 0.73 | -23.8 | -111.91 | -27.2% | -27.8% | 9 / 16 | 10 | 17.9 | 81.4% | 76 / -22.5 / 0.45 | 1.01 | -0.05 | no | - |
| S3 L=6m | 181 | 11.6 | 42.5 | 0.86 | -11.7 | -57.19 | -18.4% | -18.7% | 9 / 16 | 8 | 18.2 | 81.1% | 64 / -14.4 / 0.58 | 1.18 | -0.04 | no | - |
| S3 L=12m | 175 | 11.2 | 46.9 | 0.99 | -0.9 | -4.43 | -18.2% | -19.3% | 8 / 15 | 8 | 18.2 | 78.7% | 51 / -5.6 / 0.76 | 1.37 | -0.0 | no | - |
| S4 long-only S1 N=100 k=2 trail | 46 | 2.9 | 45.7 | 1.78 | 11.6 | +56.76 | -5.0% | -6.3% | 6 / 14 | 8 | 9.9 | 11.2% | 0 / 0.0 / - | 2.36 | 0.12 | no | - |
| S4 long-only S2 50>200 trail | 107 | 6.8 | 34.6 | 1.38 | 15.5 | +75.84 | -7.9% | -8.8% | 5 / 14 | 12 | 11.5 | 30.3% | 0 / 0.0 / - | 1.85 | 0.11 | yes | no |

Long-only versions of every S1 / S2 point (used only for the S4 stability check):

| id | trades | PF | total R | worst drop | losing yrs |
|---|---|---|---|---|---|
| S1 N=20 k=2 channel | 80 | 1.09 | 3.1 | -7.7% | 9 / 16 |
| S1 N=20 k=2 trail | 95 | 1.61 | 18.7 | -5.7% | 7 / 16 |
| S1 N=20 k=3 channel | 77 | 1.19 | 4.3 | -5.7% | 7 / 16 |
| S1 N=20 k=3 trail | 71 | 1.43 | 9.9 | -5.2% | 7 / 16 |
| S1 N=55 k=2 channel | 37 | 1.22 | 5.3 | -7.7% | 9 / 16 |
| S1 N=55 k=2 trail | 61 | 1.52 | 11.7 | -5.1% | 6 / 16 |
| S1 N=55 k=3 channel | 35 | 1.02 | 0.3 | -7.5% | 11 / 16 |
| S1 N=55 k=3 trail | 46 | 1.32 | 5.6 | -3.2% | 6 / 16 |
| S1 N=100 k=2 channel | 22 | 1.35 | 6.2 | -7.9% | 7 / 12 |
| S1 N=100 k=2 trail | 46 | 1.78 | 11.6 | -5.0% | 6 / 14 |
| S1 N=100 k=3 channel | 19 | 1.31 | 3.8 | -6.3% | 7 / 12 |
| S1 N=100 k=3 trail | 33 | 1.86 | 8.5 | -3.5% | 3 / 14 |
| S2 sma200 3R | 56 | 0.91 | -4.0 | -19.5% | 10 / 15 |
| S2 sma200 trail | 107 | 1.3 | 12.5 | -12.0% | 7 / 15 |
| S2 50>200 3R | 53 | 1.03 | 1.2 | -16.9% | 7 / 14 |
| S2 50>200 trail | 107 | 1.38 | 15.5 | -7.9% | 5 / 14 |

**Reading the train table.**
- **Before costs almost everything was positive** (gross PF 1.0-2.4): gold trended. After spread,
  slippage and especially swap, 11 of 19 long/short variants lose money.
- **Channel exits and the 3R target are the weakest** (PF 0.62-1.05): they hold 30-65 days, pay
  0.25-0.55 R per trade in swap, and give back much of the move. Trailing exits (hold 10-20 days)
  are better at every N and k.
- **Shorts lose in almost every variant** (short PF 0.25-0.84). The exception is S1 N=100 (18 shorts,
  PF 1.81 with k=2; 15 shorts, PF 1.03 with k=3). Long-only beats long/short in 14 of 16 S1/S2 points.
- **Momentum (S3) does not pay after costs** (PF 0.73-0.99); S3 L=12m lost money every year 2014-2018.
- **Random-entry diagnostic on train** (`python -m research.run_swing train_random`, run after the
  finalists were frozen, not used for selection): S1 N=100 k=2 trail beats 99.6% of random-direction
  runs (random median PF 0.78), S2 50>200 trail 98.2%, S3 L=12m 95.0%. Against long-only random
  timing (drift-controlled), S4 long-only S1 N=100 k=2 trail is at the 94.7th percentile and S4
  long-only S2 50>200 trail at the 90.3th.

## 5. Finalists

**None.** Two points met the eligibility bar (>= 60 trades, PF >= 1.20, worst drop < 30%, <= 6 losing
years); both failed the stability rule:

| candidate | train PF | unstable because (neighbour PF must be >= 1.0 and within 0.25) |
|---|---|---|
| S1 N=100 k=2 trail | 1.79 | N=55 trail 1.15 (gap 0.64); N=100 channel 1.03 (gap 0.76). k=3 trail (1.60) was fine |
| S4 long-only S2 50>200 trail | 1.38 | long-only 50>200 with the 3R target 1.03 (gap 0.35). Long-only sma200 trail (1.30) was fine |

Best point per family by the ranking rule (used as S4 parents and holdout reference rows): S1 N=100
k=2 trail, S2 50>200 trail, S3 L=12m, S4 long-only S1 N=100 k=2 trail (46 trades, below the 60
minimum).

Per year (train), R, for the best point of S1, S2 and S3:

| year | S1 N=100 k=2 trail | S2 50>200 trail (long/short) | S3 L=12m |
|---|---|---|---|
| 2003 | -0.1 (3) | - | - |
| 2004 | -1.5 (4) | -2.8 (11) | +1.0 (7) |
| 2005 | +2.6 (3) | +4.4 (11) | +1.8 (12) |
| 2006 | +1.9 (4) | +0.3 (10) | -0.1 (12) |
| 2007 | +2.0 (5) | +3.4 (12) | +2.3 (12) |
| 2008 | +0.3 (6) | +1.7 (9) | -2.1 (12) |
| 2009 | +2.2 (5) | +2.4 (12) | +4.1 (12) |
| 2010 | -0.1 (6) | +2.9 (12) | +4.9 (12) |
| 2011 | +5.6 (4) | +5.2 (10) | +4.5 (12) |
| 2012 | +0.3 (2) | -1.4 (9) | -3.3 (12) |
| 2013 | +1.9 (5) | +1.6 (12) | +4.8 (12) |
| 2014 | +0.1 (3) | -4.0 (11) | -3.6 (12) |
| 2015 | +0.9 (2) | +2.1 (11) | -0.8 (12) |
| 2016 | -0.8 (4) | -1.6 (10) | -4.0 (12) |
| 2017 | -2.1 (4) | +3.0 (10) | -4.8 (12) |
| 2018 | +2.4 (4) | -6.3 (11) | -5.5 (12) |

(trades in brackets)

## 6. Holdout (2019-01-01 - 2026-09-30), reference rows only, run once

*Run 2026-10-02 05:38 UTC, after the (empty) finalist list and the addendum were frozen. No verdict
weight (see the addendum in section 1).*

Buy-and-hold, same period, $500 constant notional: gold +224%; **spot: ret/drop 0.56**, Sharpe 0.93,
worst MTM drop -29.8%, +$83.89 a year. With 0.02%/night financing (a CFD holder): ret/drop 0.25,
Sharpe 0.53, worst drop -37.8%.

| id | trades | /yr | win % | PF | total R | result $500 | worst drop | MTM drop | losing yrs | loss streak | avg hold (d) | exposure | shorts n / R / PF | gross PF | ret/drop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 N=100 k=2 trail | 40 | 5.2 | 55.0 | 2.32 | 14.5 | +68.54 | -3.1% | -4.1% | 2 / 8 | 4 | 9.0 | 18.0% | 7 / -1.2 / 0.54 | 2.85 | 0.43 |
| S2 50>200 trail | 89 | 11.5 | 34.8 | 1.47 | 15.3 | +68.05 | -16.5% | -17.3% | 3 / 8 | 7 | 11.4 | 50.9% | 18 / -4.4 / 0.43 | 1.9 | 0.1 |
| S3 L=12m | 93 | 12.0 | 50.5 | 1.25 | 9.0 | +40.11 | -13.1% | -14.4% | 3 / 8 | 4 | 18.6 | 86.6% | 20 / -7.1 / 0.31 | 1.71 | 0.07 |
| S4 long-only S1 N=100 k=2 trail | 33 | 4.3 | 60.6 | 2.87 | 15.8 | +74.20 | -3.8% | -4.9% | 2 / 8 | 5 | 9.4 | 15.4% | 0 / 0.0 / - | 3.53 | 0.39 |
| S4 long-only S2 50>200 trail | 71 | 9.2 | 36.6 | 1.79 | 19.7 | +89.22 | -12.6% | -13.4% | 3 / 8 | 11 | 12.0 | 42.7% | 0 / 0.0 / - | 2.33 | 0.17 |

**The pre-registered checks, applied anyway** ("what a verdict would have said"; none of these is a
finalist):

| id | PF > 1.2 | >= 40 trades | MTM drop < 30% | random pctl >= 90 | PF costs x1.5 | ret/drop vs B&H 0.56; shorts | long-only random pctl |
|---|---|---|---|---|---|---|---|
| S1 N=100 k=2 trail | 2.32 pass | 40 pass | -4.1% pass | 99.1 (median 0.86, p90 1.47) pass | 2.08 pass | 0.43; shorts 7 PF 0.54 FAIL | - |
| S2 50>200 trail | 1.47 pass | 89 pass | -17.3% pass | 97.7 (median 0.85, p90 1.22) pass | 1.29 pass | 0.1; shorts 18 PF 0.43 FAIL | - |
| S3 L=12m | 1.25 pass | 93 pass | -14.4% pass | 95.8 (median 0.78, p90 1.1) pass | 1.07 pass | 0.07; shorts 20 PF 0.31 FAIL | - |
| S4 long-only S1 N=100 k=2 trail | 2.87 pass | 33 FAIL | -4.9% pass | 99.7 (median 0.83, p90 1.54) pass | 2.59 pass | 0.39; shorts 0 PF - FAIL | 93.0 |
| S4 long-only S2 50>200 trail | 1.79 pass | 71 pass | -13.4% pass | 99.3 (median 0.85, p90 1.29) pass | 1.57 pass | 0.17; shorts 0 PF - FAIL | 76.4 |

Neighbours on the holdout (reported, not used to select):

| reference | neighbour | trades | PF | total R | MTM drop | ret/drop |
|---|---|---|---|---|---|---|
| S1 N=100 k=2 trail | S1 N=55 k=2 trail | 50 | 2.07 | 15.7 | -4.4% | 0.43 |
| S1 N=100 k=2 trail | S1 N=100 k=3 trail | 29 | 2.28 | 9.5 | -3.6% | 0.3 |
| S1 N=100 k=2 trail | S1 N=100 k=2 channel | 16 | 3.56 | 33.2 | -27.0% | 0.16 |
| S2 50>200 trail | S2 sma200 trail | 90 | 1.8 | 24.5 | -9.2% | 0.31 |
| S2 50>200 trail | S2 50>200 3R | 42 | 1.26 | 8.1 | -14.0% | 0.07 |
| S3 L=12m | S3 L=6m | 93 | 1.17 | 6.1 | -16.8% | 0.04 |
| S4 long-only S1 N=100 k=2 trail | S4 long-only S1 N=55 k=2 trail | 38 | 2.91 | 18.9 | -4.2% | 0.54 |
| S4 long-only S1 N=100 k=2 trail | S4 long-only S1 N=100 k=3 trail | 22 | 3.92 | 12.4 | -2.5% | 0.55 |
| S4 long-only S1 N=100 k=2 trail | S4 long-only S1 N=100 k=2 channel | 10 | 6.72 | 39.3 | -25.0% | 0.2 |
| S4 long-only S2 50>200 trail | S4 long-only S2 sma200 trail | 71 | 2.12 | 25.7 | -7.5% | 0.41 |
| S4 long-only S2 50>200 trail | S4 long-only S2 50>200 3R | 33 | 1.52 | 12.3 | -10.3% | 0.15 |

Per year (holdout), R (trades in brackets):

| year | S1 N=100 k=2 trail | S2 50>200 trail | S3 L=12m | S4 long-only S1 N=100 k=2 trail | S4 long-only S2 50>200 trail |
|---|---|---|---|---|---|
| 2019 | +0.3 (5) | +3.8 (9) | +2.0 (12) | +0.3 (5) | +3.8 (9) |
| 2020 | +2.2 (6) | +3.2 (11) | +2.7 (12) | +2.8 (5) | +3.2 (11) |
| 2021 | -0.5 (2) | -4.8 (13) | -3.9 (12) | -0.4 (1) | -2.2 (4) |
| 2022 | +0.7 (4) | -3.5 (9) | -2.0 (12) | +0.2 (2) | -3.8 (6) |
| 2023 | -1.5 (8) | -4.5 (13) | -4.0 (12) | -2.2 (7) | -2.8 (11) |
| 2024 | +2.1 (6) | +3.0 (14) | +5.2 (12) | +2.1 (6) | +3.0 (14) |
| **2025** | **+8.3 (6)** | **+14.2 (10)** | **+8.6 (12)** | **+8.3 (6)** | **+14.2 (10)** |
| 2026 | +2.9 (3) | +3.9 (10) | +0.6 (9) | +4.7 (1) | +4.3 (6) |
| without 2025 | +6.2 | +1.1 | +0.6 | +7.5 | +5.5 |

**Reading the holdout.**
- Every reference row made money and passed the PF, drawdown, random-direction and cost-stress
  checks. That is mostly **gold's 2019-2026 bull market** (+224%): long trades did the work (long PF
  1.63-2.87), shorts lost in every variant (short PF 0.31-0.54), and 2025 alone is 53-96% of each
  row's total R. Without 2025, S2 and S3 are flat.
- **None adds anything over holding gold.** Per unit of drawdown the best (S1 N=100 k=2 trail, 0.43)
  is below spot buy-and-hold (0.56), with a lower Sharpe (0.68 vs 0.93). It would beat a CFD
  buy-and-hold paying the same 0.02%/night (0.25), but the pre-registered benchmark is spot (an ETF
  or physical holder does not pay ~7% a year).
- The random-direction benchmark is an easy bar in a bull market (half the random trades are
  shorts). The drift-controlled version (random timing, all long) puts S4 long-only S1 N=100 k=2
  trail at the 93rd percentile and S4 long-only S2 50>200 trail at only the **76th**: the S2
  pullback timing adds little over buying gold at random times.
- S1 N=100 k=2 trail has exactly 40 holdout trades (5 a year), the minimum, so its PF of 2.32 rests
  on few trades.

## 7. Verdicts

| variant | verdict |
|---|---|
| all 19 S1 / S2 / S3 points and both S4 points | **Not robust**: none passed the pre-registered train selection, so there are no finalists |
| S1 N=100 k=2 trail (best S1; eligible, unstable) | Not robust. Extra holdout checks: 5 of 6 pass; fails "adds over buy-and-hold" (0.43 vs 0.56; 7 shorts, PF 0.54) |
| S4 long-only S2 50>200 trail (eligible, unstable) | Not robust. Extra checks: 5 of 6 pass; fails buy-and-hold (0.17 vs 0.56); 76th percentile vs long-only random |
| S2 50>200 trail, S3 L=12m (best of family) | Not robust: below eligibility on train (PF 1.18, 0.99); holdout fails buy-and-hold |
| S4 long-only S1 N=100 k=2 trail | Not robust: 46 train / 33 holdout trades, below both minimums; fails buy-and-hold (0.39) |

## 8. Plain-English recommendation

On 23 years of real XAUUSD, daily trend-following "works" before costs because gold went up 13-fold,
but very little of that is an edge of the rules themselves:

- After realistic costs (overnight financing is the big one) most variants lose on 2003-2018, shorts
  lose almost everywhere, and time-series momentum does not pay.
- The best rule, a 100-day breakout with a 2 x ATR trailing stop, is the one interesting result: it
  made money in both periods (train PF 1.79, holdout 2.32) with small drawdowns (-3% to -5% at 1%
  risk) while in the market only 15-18% of the time. But its train neighbours were much weaker
  (55-day 1.15, channel exit 1.03), it trades only 4-5 times a year (every number rests on 40-64
  trades), and on the holdout it earned less per unit of drawdown than just holding gold.
- So the evidence does **not** support adding a swing strategy to the live bot as an edge. For gold
  exposure, plain buy-and-hold did better per unit of risk over 2019-2026.

**Worth adding as a second live strategy? Not now.** If you want to keep an eye on the one
candidate, paper-track S1 N=100 k=2 trail (long-only or long/short) from here and re-test it against
buy-and-hold after a year or two of new data; don't put money on it on this evidence. What it would
need in the live bot (nothing implemented):

- **Account / sizing:** it cannot run on the current $500 standard account: a 2 x ATR20 stop is
  $100-$230 per oz in 2025-2026, so even 0.01 lot risks 20-45%. It needs a cent account
  (`OZ_PER_LOT = 1`) or roughly $10,000-$25,000 balance for 1% risk at 0.01 lot at today's volatility.
- **Code:** a new strategy class in `strategy.py` on D1 candles (signal after the daily close, entry
  at the next open, which the bot's M30 loop would need to schedule); positions that live for days or
  weeks across sessions and weekends (the current bot closes at session end); a daily trailing-stop
  update (highest high since entry - 2 x ATR20, Wilder ATR on D1) sent as a stop modification; swap
  included in P&L and in `loss_guard` R; its own one-position-at-a-time state, separate from the ORB.
- **Config:** e.g. `SWING_ENABLED`, `SWING_CHANNEL_DAYS = 100`, `SWING_STOP_ATR = 2.0`,
  `SWING_ATR_PERIOD = 20`, `SWING_LONG_ONLY`, a separate `SWING_RISK_PERCENT`; the existing
  `MIN_STOP_DISTANCE` check applies as is.

**Caveats.**
- The swap assumption (0.02% of price per night, longs and shorts) is a flat estimate; historic
  broker swaps aren't in the data. Long swaps were lower in the near-zero-rate years (2009-2021) and
  shorts often earned a credit, so train results for long-hold variants and for shorts are probably
  somewhat too pessimistic. The x1.5 cost stress did not change any holdout conclusion.
- 21 candidates were tried; with that many, a train PF of 1.79 on 64 trades is partly luck. The
  stability rule exists for exactly this.
- The random-entry benchmark uses time exits, not trailing stops, so it measures entry timing plus
  exit shape; in a bull market random direction is an easy bar. The long-only random version and the
  buy-and-hold comparison are the more informative tests.
- Dukascopy is one ECN's BID feed; daily candles are UTC days (a broker's daily candle often closes at
  17:00 New York, which shifts signals slightly). 2003-2005 minute data is thin.
- Fixed $500, not compounded (as `backtest.summarize`).

**Deviations from the brief.** Results are saved under `research/swing_results/` instead of `data/`
(only `research/` and this doc were to be written). PF is computed on R rather than $/oz (declared in
the plan). The live-config ($500 standard) sizing is reported but the verdict uses cent-account
sizing, because the standard account cannot size any of these trades near 1% (declared in the plan).

**Reproduce:** `python -m research.swing_null`, then `python -m research.run_swing data`, `train`,
`train_random`, `holdout` (refuses a second run; delete `research/swing_results/holdout.json` only if
the plan is pre-registered again). Raw outputs in `research/swing_results/`.
