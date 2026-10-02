# Research: does trading gold's reaction to major US releases have a robust edge?

**Goal.** Find out whether a small, pre-registered family of rules that trade XAUUSD's reaction to
the three biggest scheduled US releases (NFP, CPI, FOMC statements) has an edge on 2003-2026
Dukascopy minute data that holds up on an untouched holdout, and that comes from the news rather
than the time of day. "Nothing survives" is a valid outcome. Nothing here changes the live bot or
`config.py`.

**Code:** `research/news_calendar.py` (event calendar), `research/news.py` (minute data, signals,
engine, metrics), `research/run_news.py` (experiments), `research/news_null.py` (engine checks on fake
prices). Calendar in `research/news/us_events.csv`; results saved to `research/news/results/`.

**Status (2026-10-02): done. Verdict: nothing is "Robust".** One finalist passed the train selection
(FOMC 30-minute range breakout, N3 W=30 2R). On the holdout it made money (PF 1.41, 59 trades) and
passed five of the six checks, but it beat only 87.8% of random-direction runs (needs 90%). It is
very thin: +0.05 to +0.10 R per trade, PF exactly 1.00 under the cost stress on train, and the
$ result is mostly 2026. NFP and CPI rules lost money on train in almost every form. See sections 4-8.

---

## 1. Pre-registered plan

*Written 2026-10-02 06:10 UTC, before any rule was run on XAUUSD data and before I looked at any
price or spread data around the releases.*

Disclosure: before writing this I had only compiled the event calendar from official pages (section
3). I have not looked at XAUUSD prices, spreads or volatility on or around any event date. From
general knowledge I expect spreads to widen at releases (that is why real per-minute bid/ask is used).
The engine is smoke-tested on fake prices first (section 2).

### Events

- `research/news/us_events.csv`: NFP (BLS Employment Situation) and CPI at 08:30 ET; scheduled FOMC
  statements at 14:15 ET until 2013-03-13, 12:30 ET on the eight 2011-2012 press-briefing days, 14:00
  ET from 2013-03-20. ET is converted to UTC with daylight saving (America/New_York).
  Unscheduled FOMC actions are not traded (irregular times, not knowable in advance).
- Scopes: **NFP**, **CPI**, **FOMC** separately, and **ALL** pooled (same parameters for every event,
  events in time order, an event is skipped if the previous trade is still open).

### Data and prices

- Dukascopy 1-minute BID and ASK candles from the existing cache (`data/dukascopy/XAUUSD`, read with
  `research.dukascopy.read`; nothing downloaded). Filler minutes dropped as in `research.dukascopy`.
  Kept per weekday: 06:00-17:00 ET. Ask is clipped to at least the bid.
- **Signals use mid prices** (mid OHLC = average of bid and ask OHLC), so a widening spread at the
  release does not look like a move. **Fills use the real bid/ask of that minute**: buy at the ask,
  sell at the bid.
- Release minute `T` = the minute starting at the release time.
- **Pre-release price** `P0` = mid close of the last minute in [T-5 min, T). No such minute: event
  skipped.
- **Pre-release ATR** = mean true range of the 14 clock-aligned M5 mid candles in [T-70 min, T),
  at least 10 of them present (else the event is skipped). Only data before `T`.

### Variants and grids

| id | rule | grid |
|---|---|---|
| N1 | **Momentum.** At `T+W`, move = mid close of the last minute in [T, T+W) - `P0`. If abs(move) >= m x ATR, trade in the move's direction. Stop: "ext" = the release minute's opposite extreme (BUY: mid low of minute T), or 1 x ATR / 2 x ATR from the entry fill. | W in {5, 15, 30} min x m in {0.5, 1.0} x stop in {ext, 1ATR, 2ATR} x exit in {2R, 2h, EOS} = 54 |
| N2 | **Fade.** Same trigger, opposite direction. Stop = beyond the post-release extreme: the highest mid high (SELL) / lowest mid low (BUY) in [T, T+W), plus 0.1 x ATR. Target = `P0`. Skipped if the entry is already past `P0`. Time exit if the target isn't reached. | W in {5, 15, 30} x m in {0.5, 1.0} x time exit in {2h, EOS} = 12 |
| N3 | **Post-release range breakout.** Range = mid high / low of [T, T+W). From T+W, clock-aligned M5 mid candles; the first one that closes above the range high = BUY (below the low = SELL), entered at the next minute's open. Only breaks whose M5 candle closes by T+120 min. Stop = the other side of the range. | W in {5, 15, 30} x exit in {2R, 2h, EOS} = 9 |
| N4 | **Trend-aligned.** For each scope, the best-on-train N1 or N3 point of that scope (ranking rule below, among points with >= 80 train trades; if none has, the highest PF), but BUY only if the previous UTC day's D1 bid close > EMA50 of D1 closes (up to that day), SELL only if below. | 1 per scope (+ trend-filtered versions of its parent's neighbours, for the stability check) |

Exits: **2R** = fixed target at 2R, otherwise time exit at EOS; **2h** = no target, time exit at
T+120 min; **EOS** = no target, time exit at 16:55 ET (end of the New York day, 5 minutes before
gold's daily break). A time exit fills at the open of the first minute at or after the exit time.
Every grid point runs in every scope (N1 54 x 4, N2 12 x 4, N3 9 x 4, N4 4 = 304 rows).

### Common rules

- **Entry** at the open of the first minute in [signal time, signal time + 5 min) (no minute: no
  trade). One trade per event per variant.
- **Fills.** BUY entry at ask open + slippage; SELL entry at bid open - slippage. Long stop
  triggers when the bid low <= stop and fills at min(stop, bid open) - slippage; short stop triggers
  when the ask high >= stop and fills at max(stop, ask open) + slippage. Targets: long when bid high
  >= target, filled at target - slippage (short mirrored on the ask). Stops and targets are checked
  from the entry minute on; if one minute touches both, the stop wins (worst case).
- **Slippage:** $0.30/oz per fill within 15 minutes of the release (fill time - T <= 15 min),
  $0.10/oz otherwise, on entries and on every exit (stops, targets, time exits).
- **Risk** = distance from the entry fill to the stop. **Minimum stop: skip if risk < $2.00/oz**
  (as the live `MIN_STOP_DISTANCE`), or if the stop is on the wrong side.
- **R** = net result per oz (after spread and slippage) / risk. **Profit factor on R** (sum of winning
  R / sum of losing R).
- **Sizing:** `sizing.lot_size(entry fill, stop, target)` on $500 at 1% (live config: standard
  account, 1 lot = 100 oz, min 0.01 lot); time-exit variants get a nominal 2R target. $ =
  `sizing.money`. Worst drop = `backtest._drawdown` of the trades' $ / $500. Trades where `lot_size`
  says "skip" (even 0.01 lot > 2% risk) are still counted at 0.01 lot; their number is reported.
- **Split:** train 2003-05-05 - 2018-12-31, holdout 2019-01-01 - 2026-09-30, by entry time. Features
  only look backwards, so nothing needs a warm-up across the split except the D1 EMA (computed on the
  full daily series, using only days before the event).

### Metrics

Trades, win %, PF (R), total R, $ result and worst drop on $500, per-year table (trades, PF, R),
losing years (calendar years with net R < 0) / years with trades, longest losing streak, average
spread paid in R (half the spread at the entry minute's open + half at the exit minute's open,
over risk), average slippage in R, gross R per trade (mid to mid, no costs), "skip" count, events
used / skipped.

### Choosing finalists (train only)

1. **Eligible:** >= 80 train trades, train PF >= 1.15, worst drop < 30% of $500, losing years <=
   6 of the years with trades.
2. **Stable:** every grid neighbour has train PF >= 1.0 and within 0.25 of the candidate's PF.
   Neighbours, same scope: W one step either way (5 / 15 / 30), the other m, stop one step in the
   order ext / 1ATR / 2ATR, exit one step in the order 2R / 2h / EOS (N2: the other time exit).
   N4: the trend-filtered versions of its parent's neighbours.
3. Rank eligible + stable points by train PF; ties (within 0.05) broken by fewer losing years, then
   smaller worst drop. **At most 3 finalists, at most one per family (N1-N4).**
4. If nothing qualifies: no finalists, and nothing can be "Robust". The holdout is then run once
   for reference only: the best-ranked point of each family (all scopes together), with the full
   robustness battery reported as "what the checks would have said", no verdict weight.

### Holdout and robustness (finalists, once, no re-selection)

- Holdout metrics + per-year table (the holdout command refuses a second run).
- +/-1 grid step neighbours on the holdout (reported, not used to select).
- **Cost stress:** each fill an extra 0.25 x that minute's spread (spread x 1.5 overall) and slippage
  x 1.5.
- **Random-entry benchmark:** the finalist's holdout trades, same entry minutes, same stop distance,
  same target distance (or R multiple), same exit rule and costs, each with a random BUY/SELL (50/50);
  1,000 runs; report the finalist's PF percentile.
- **Non-event-days benchmark:** the same rule, same clock time (08:30 ET for NFP / CPI, 14:00 ET for
  FOMC, both for ALL), on every holdout weekday without an NFP, CPI or FOMC release. Shows whether the
  edge is the news or just the time of day.
- **Verdict "Robust"** only if all hold on the holdout: PF > 1.2; >= 40 trades; worst drop < 30% of
  $500; PF beats >= 90% of random-entry runs; PF > 1.0 under the cost stress; PF above the
  non-event-days benchmark's PF. Otherwise "Not robust".

### Addendum, written after the train run and before any holdout run (2026-10-02 06:24 UTC)

The train run (section 4) froze **one finalist: FOMC N3 W=30 2R** (`research/news/results/finalists.json`).
Declared now, before the holdout is seen: two more points that met the eligibility bar but failed the
stability rule also get the full holdout battery, reported as **"what the checks would have said",
with no verdict weight**: the best eligible N1 point (FOMC N1 W=30 m=0.5 stop=ext 2R) and the only
eligible N4 point (ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend). This cannot change the official result.

Disclosure on the holdout run: the first `holdout` invocation (06:24 UTC) crashed in the
random-entry benchmark (a pandas column-name bug) before printing or saving anything; it was fixed
and re-run unchanged. Nothing was seen from the crashed run.

---

## 2. Engine checks (before any real-data results)

All on fake prices (`python -m research.news_null`), never on XAUUSD. Output in
`research/news/results/null_output.txt` and `overshoot_output.txt`.

- **No peeking.** 9,424 signals (every pooled-scope variant on three years of fake prices) were
  re-computed after replacing every price from the entry minute on with noise (keeping only the
  entry minute's open): **0 changed**. The daily trend computed from D1 candles cut at the event day
  matched the full-series trend on every checked event (0 differences). By construction P0 and the
  ATR use minutes before T, N1/N2 minutes before T+W, N3 closed M5 candles.
- **Null test (random walk).** 96 independent driftless random walks, 10 years each, real
  2009-2018 event times, volatility x10 for 5 minutes and x3 for 55 minutes after each release (so
  the rules trigger as on news), true paths of 12 steps per minute, zero spread and slippage. Every
  rule should average 0 R per trade. Average R per trade by group (se across walks):

  | group | avg R (2R / 2h / EOS) | se |
  |---|---|---|
  | N1 stop=ext | +0.002 / +0.008 / +0.011 | 0.005-0.006 |
  | N3 range | -0.001 / -0.006 / -0.001 | 0.003-0.004 |
  | N1 stop=2ATR | +0.015 / +0.046 / +0.053 | 0.005-0.011 |
  | N1 stop=1ATR | +0.043 / +0.123 / +0.138 | 0.005-0.017 |
  | N2 fade (2h / EOS) | +0.029 / +0.031 | 0.007 |
  | N4 (trend-filtered N1 / N3) | same pattern as the matching N1 / N3 group | 0.004-0.024 |

  **The test found a fill-model bias:** tight stops (1-2 x pre-release ATR, about $2-3) and the fade
  are flattered by up to +0.14 R per trade. Cause: the engine only sees minute high/low, so a stop
  the price jumps past inside a minute is filled at the stop instead of beyond it (the overshoot is
  a free gain). With finer fake paths (240 steps per minute, `overshoot_check`, same seeds) the
  1ATR/2R bias falls from +0.040 to +0.015 R and the 2ATR groups to +0.01-0.02 R, so it scales with
  the jump size relative to the stop. Real prices do jump at news, so **N1 with ATR stops and N2 are
  flattered on real data by roughly 0.02-0.14 R per trade**; N1 "ext" and N3 (stops farther away)
  are not measurably biased (|avg| <= 0.011 R). The rules were not changed (the plan was already
  registered). The random-direction benchmark uses the same fill model, so it controls for this.
- **Bookkeeping, by hand on real data** (after the train run): FOMC 2005-03-22 (14:15 ET), N3 W=30:
  range 14:15-14:45 mid high $431.567 / low $428.386; the 14:45 M5 candle closed at $428.565
  (inside), the 14:50 one at $427.925 (below) -> SELL at the 14:55 bid open $427.980 - $0.10
  slippage = $427.880; stop $431.567 (risk $3.687), target $420.506; time exit at the 16:55 ask open
  $426.453 + $0.10 = $426.553; +$1.327/oz = +0.36 R. Matches the engine exactly.

## 3. Data and event calendar

### Calendar (`research/news/us_events.csv`, built by `python -m research.news_calendar`)

| type | releases in the file | first - last | time (ET) | used (from 2003-05-05, with data) |
|---|---|---|---|---|
| NFP (Employment Situation) | 280 | 2003-05-02 - 2026-09-04 | 08:30 | 271 (184 train, 87 holdout) |
| CPI | 283 | 2003-02-21 - 2026-09-11 | 08:30 | 276 (185 train, 91 holdout) |
| FOMC (scheduled statements) | 189 | 2003-01-29 - 2026-09-16 | 14:15 (73), 12:30 (8), 14:00 (108) | 180 (119 train, 61 holdout) |

- **Sources (official only, read 2026-10-02):** BLS release archives
  (bls.gov/bls/news-release/empsit.htm and cpi.htm; release date = the MMDDYYYY in each archived
  release's file name) and the Federal Reserve's FOMC calendars (federalreserve.gov/monetarypolicy/
  fomccalendars.htm for 2021-2026, fomchistorical2003.htm to fomchistorical2020.htm). The FOMC date
  is the last day of each scheduled meeting with a statement.
- **Times:** BLS embargo lines say 8:30 a.m. ET on every release checked. FOMC: the Fed's 2011-03-24
  release says statements on press-briefing days would come at about 12:30 p.m., "one hour and
  forty-five minutes earlier than for other FOMC meetings" (= 2:15 p.m.); the Fed's 2013-03-13
  release moved all statements to 2 p.m. (first meeting: 2013-03-20). So: 14:15 until 2013-01-30,
  12:30 on the eight 2011-2012 press-briefing days, 14:00 from 2013-03-20. The 14:15 time for
  2003-2010 rests on the 2011 release's wording; the statement pages themselves show no time.
- **Exceptions in the official lists (kept as published):** NFP not on a Friday 12 times
  (2003-07-03, 2008-07-03, 2009-07-02, 2014-07-03, 2015-07-02, 2020-07-02, 2025-07-03, 2026-07-02
  around Independence Day; 2013-10-22, 2025-11-20, 2025-12-16 after shutdowns; 2026-02-11). CPI
  delayed by shutdowns: 2013-10-30, 2025-10-24.
- **Gaps:** no October 2025 Employment Situation and no October 2025 CPI (the BLS releases of
  2025-12-16 and 2025-12-18 say they were not published / data not collected because of the
  2025-10-01 to 11-12 shutdown). Unscheduled FOMC actions (2007-08-10, 2007-08-17, 2008-01-22,
  2008-03-11, 2008-10-08, 2010-05-09, 2020-03-03, 2020-03-15) are listed in the code but not traded;
  the 2020-03-18 scheduled meeting was replaced by the Sunday 2020-03-15 action, so 2020 has 7
  scheduled statements. The 2025-08-22 notation vote (framework statement, no rate decision) is
  excluded. 19 events had no usable pre-release data in the Dukascopy minutes (8 NFP, 4 CPI, 6 FOMC
  without a minute in the 5 minutes before T, 1 FOMC with too few pre-release M5 candles), mostly
  2003-2005.
- **Extraction check.** BLS refuses scripted downloads (HTTP 403), so the archive pages were read
  with WebFetch, which returns a model-written summary of the page. Each BLS list was extracted
  twice independently and compared: NFP agreed on 279 of 280 dates, CPI differed on 4 months (one
  run dropped 3 and mis-read 1). Every disagreement was resolved from the individual
  release's own page: NFP 2009-01-09; CPI 2005-11-16, 2006-04-19, 2011-01-14, 2023-11-14.
- **Spot checks against a second official page (all matched):**
  - BLS annual release schedules for **2004 and 2016**: all 24 NFP and all 24 CPI dates (and the
    08:30 time) of those years match the file.
  - Individual BLS release pages (embargo line: date and 8:30 a.m.): NFP 2009-01-09, 2013-10-22,
    2025-11-20, 2025-12-16, 2026-02-11; CPI 2005-11-16, 2006-04-19, 2011-01-14, 2023-11-14,
    2025-10-24, 2025-12-18.
  - Fed statement pages: 2020-11-05 (released 2:00 p.m.), 2024-11-07 and 2026-09-16 (statements
    with a rate decision on those dates). One oddity: the 2007 historical page's statement link for
    the June 27-28, 2007 meeting was summarised under a "20070618" name; the meeting dates on the
    same page were used (2007-06-28).

### Prices (Dukascopy XAUUSD 1-minute bid and ask, from the existing cache)

- `python -m research.news build` reads `data/dukascopy/XAUUSD` (no download) and keeps 06:00-17:00
  ET on weekdays: **3,779,485 minutes, 6,035 ET days, 2003-05-05 - 2026-09-30**, cached in
  `research/news/cache/` (git-ignored). D1 bid candles for the trend: `data/xauusd_D1.parquet`.
- **Spread at the releases** (`python -m research.run_news data`, after the plan; ask - bid at the
  minute's open, $/oz, medians; "no-event days" = same clock minute on weekdays without a release):

  | type | years | T-5 min | T: median / p90 | T+5 | T+15 | no-event days at T | pre-release M5 ATR |
  |---|---|---|---|---|---|---|---|
  | NFP | 2003-2008 | 0.46 | 0.51 / 0.55 | 0.41 | 0.43 | 0.51 | 0.91 |
  | NFP | 2009-2018 | 0.32 | 0.65 / 1.55 | 0.35 | 0.33 | 0.36 | 1.09 |
  | NFP | 2019-2026 | 0.37 | 0.85 / 2.66 | 0.43 | 0.37 | 0.42 | 1.58 |
  | CPI | 2003-2008 | 0.46 | 0.50 / 0.51 | 0.46 | 0.41 | 0.51 | 0.96 |
  | CPI | 2009-2018 | 0.31 | 0.42 / 0.90 | 0.31 | 0.31 | 0.36 | 1.21 |
  | CPI | 2019-2026 | 0.36 | 0.65 / 2.41 | 0.39 | 0.36 | 0.42 | 1.60 |
  | FOMC | 2003-2008 | 0.50 | 0.41 / 0.51 | 0.41 | 0.50 | 0.50 | 0.99 |
  | FOMC | 2009-2018 | 0.35 | 0.59 / 1.46 | 0.41 | 0.40 | 0.32 | 0.98 |
  | FOMC | 2019-2026 | 0.39 | 0.83 / 2.00 | 0.43 | 0.40 | 0.35 | 1.20 |

  Since 2009 the spread roughly doubles in the release minute (p90 $1.5-2.7) and is back to normal
  within 5 minutes. Before 2009 Dukascopy's gold spread was nearly fixed and shows no widening, so
  release-minute costs are understated for 2003-2008 (every rule here enters 5+ minutes after the
  release, so this matters little). The **pre-release M5 ATR is only $0.9-1.6**, so a 1 x ATR stop is
  usually below the $2 minimum (1ATR variants trade rarely) and 2 x ATR is often skipped too.

## 4. Train results (2003-05-05 - 2018-12-31)

*Run 2026-10-02 06:23 UTC, grids exactly as pre-registered.* Full table (all 304 rows, all metrics)
in `research/news/results/train_output.md`. R and PF are net of spread and slippage; "gross R" = per
trade before costs; "spread R" = average half-spread in + out, over risk.

**Summary of the grid (train):**

| scope | family | points | trades (median) | PF median | points PF > 1.0 | points >= 80 trades | best PF with >= 80 trades | gross R/trade (median) | spread R (median) |
|---|---|---|---|---|---|---|---|---|---|
| NFP | N1 momentum | 54 | 82 | 0.73 | 12 | 30 | 1.16 | +0.072 | 0.150 |
| NFP | N2 fade | 12 | 86 | 0.66 | 0 | 8 | 0.78 | +0.057 | 0.102 |
| NFP | N3 range breakout | 9 | 157 | 0.65 | 0 | 9 | 0.85 | -0.007 | 0.063 |
| CPI | N1 | 54 | 66 | 0.51 | 5 | 18 | 0.72 | -0.119 | 0.137 |
| CPI | N2 | 12 | 41 | 0.79 | 0 | 0 | - | +0.112 | 0.120 |
| CPI | N3 | 9 | 155 | 0.67 | 1 | 9 | 1.03 | -0.009 | 0.089 |
| FOMC | N1 | 54 | 44 | 1.67 | 50 | 12 | 1.46 | +0.745 | 0.163 |
| FOMC | N2 | 12 | 47 | 0.38 | 0 | 0 | - | -0.193 | 0.112 |
| FOMC | N3 | 9 | 90 | 1.21 | 9 | 9 | 1.34 | +0.133 | 0.065 |
| ALL | N1 | 54 | 193 | 0.88 | 15 | 36 | 1.20 | +0.178 | 0.151 |
| ALL | N2 | 12 | 177 | 0.54 | 0 | 12 | 0.66 | -0.024 | 0.110 |
| ALL | N3 | 9 | 399 | 0.76 | 0 | 9 | 0.91 | +0.023 | 0.074 |

**Best points with >= 80 train trades, per scope:**

| id | trades | win % | PF | total R | result $500 | worst drop | losing yrs | loss streak | spread R | gross R | lot "skip" |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NFP N1 W=30 m=0.5 stop=2ATR 2h | 84 | 36.9 | 1.16 | 8.7 | +5.10 | -12.0% | 5 / 14 | 6 | 0.148 | 0.324 | 0 |
| NFP N1 W=30 m=0.5 stop=2ATR EOS | 84 | 26.2 | 1.10 | 6.2 | -5.73 | -20.8% | 7 / 14 | 16 | 0.153 | 0.299 | 0 |
| NFP N1 W=30 m=1 stop=ext EOS | 139 | 41.0 | 0.98 | -1.4 | +45.82 | -21.2% | 9 / 16 | 11 | 0.082 | 0.110 | 38 |
| CPI N3 W=30 2R | 140 | 43.6 | 1.03 | 2.0 | +41.60 | -12.1% | 8 / 16 | 8 | 0.080 | 0.135 | 12 |
| CPI N3 W=30 EOS | 140 | 41.4 | 0.98 | -1.6 | +17.17 | -11.4% | 8 / 16 | 10 | 0.082 | 0.111 | 12 |
| FOMC N1 W=30 m=0.5 stop=ext 2R | 87 | 55.2 | 1.46 | 11.0 | +131.66 | -6.7% | 5 / 15 | 6 | 0.078 | 0.243 | 21 |
| FOMC N1 W=15 m=0.5 stop=ext EOS | 88 | 50.0 | 1.42 | 13.6 | +147.14 | -7.6% | 6 / 15 | 6 | 0.086 | 0.324 | 13 |
| **FOMC N3 W=30 2R** | 80 | 48.8 | 1.34 | 3.8 | +38.47 | -7.9% | 6 / 15 | 3 | 0.058 | 0.133 | 37 |
| FOMC N3 W=15 2R | 90 | 50.0 | 1.18 | 3.1 | +52.84 | -7.1% | 6 / 15 | 3 | 0.065 | 0.129 | 35 |
| ALL N1 W=30 m=1 stop=2ATR EOS | 186 | 30.1 | 1.20 | 26.6 | +118.42 | -15.9% | 6 / 15 | 10 | 0.155 | 0.371 | 0 |
| ALL N1 W=30 m=1 stop=2ATR 2h | 187 | 37.4 | 1.12 | 14.2 | +50.89 | -12.4% | 6 / 15 | 8 | 0.150 | 0.300 | 0 |

N4 (trend-aligned) parents, chosen by the rule: NFP N1 W=30 m=0.5 stop=2ATR 2h, CPI N3 W=30 2R,
FOMC N1 W=30 m=0.5 stop=ext 2R, ALL N1 W=30 m=1 stop=2ATR EOS. With the trend filter only the
pooled one keeps >= 80 trades (ALL: 91 trades, PF 1.57; FOMC: 41 trades, PF 2.15).

**Reading the train table.**
- **NFP and CPI: no edge.** Momentum, fade and range breakout lose after costs in nearly every form
  (CPI momentum PF median 0.51, negative even before costs). Fading the spike never paid (0 of 48 N2
  points above PF 1.0 in any scope). The few NFP points above 1.0 use 2 x ATR stops, the group the
  null test says is flattered by about 0.02-0.05 R per trade, and they are small (PF 1.10-1.16).
- **FOMC is different:** trading in the direction of the post-statement move was profitable in 50
  of 54 N1 points and the 30-minute range breakout in all 9 N3 points. But most N1 points have few
  trades (1 x ATR stops are usually under $2 and skipped), the ATR-stop points are the ones the fill
  model flatters most, and the realistic ones (stop at the release-minute extreme, 81-88 trades) have
  PF 1.33-1.46 with 5-6 losing years out of 15.
- Costs are large relative to these edges: the spread alone is 0.06-0.16 R per trade and slippage
  0.03-0.15 R.

## 5. Finalists

Eligible points (>= 80 trades, PF >= 1.15, drop < 30%, <= 6 losing years) and the stability rule
(every neighbour PF >= 1.0 and within 0.25):

| candidate | train PF | stable? |
|---|---|---|
| FOMC N1 with stop=ext: 10 points (W=15/30, m=0.5/1, 2R/2h/EOS) | 1.33-1.46 | **no**: the 1ATR-stop neighbour has PF 1.9-10 on a handful of trades, the W=5 neighbours 2.2-2.4, and the W=15 2R points 1.13-1.15 (all more than 0.25 away) |
| NFP N1 W=30 m=0.5 stop=2ATR 2h | 1.16 | no: W=15 neighbour 0.79 |
| ALL N1 W=30 m=1 stop=2ATR EOS | 1.20 | no: 1ATR neighbour 2.68 |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | 1.57 | no: 1ATR neighbour 2.06, 2h neighbour 1.27 |
| FOMC N3 W=5 2h, W=15 2R, W=15 EOS, W=30 2R, W=30 EOS | 1.18-1.34 | **yes** |

**Finalist (one; at most one per family): FOMC N3 W=30 2R.** After a scheduled FOMC statement, take
the mid high and low of the first 30 minutes; trade the first M5 close outside that range (within 2
hours of the statement), stop at the other side of the range, target 2R, otherwise exit at 16:55 ET.
Train: 80 trades (exactly the minimum), PF 1.34, total +3.8 R (+0.05 R per trade), worst drop
-7.9%, 6 losing years of 15. Its 2R and EOS versions are identical on train: 78 of 80 trades ended
at the time exit (the range is wide and the late afternoon quiet), so in practice it is "hold the
breakout until the end of the New York day".

Per year (train), R (trades): 2004 -0.3 (2), 2005 +0.9 (3), 2006 +0.2 (7), 2007 -0.7 (6), 2008
+0.2 (8), 2009 -1.0 (4), 2010 -0.2 (6), 2011 +1.1 (7), 2012 +0.3 (5), 2013 +0.9 (5), 2014 +0.3 (3),
2015 -0.7 (4), 2016 +1.7 (5), 2017 +1.5 (7), 2018 -0.4 (8).

Diagnostics on train (`python -m research.run_news diag`, run after the holdout, not used for
selection): random-direction percentile 99.5 (random median PF 0.61); non-event days at 14:00 ET
1,622 trades, PF 0.38; **PF with costs x1.5: 1.00**; 37 of 80 trades get `lot_size` verdict "skip"
(median stop $9.55, so even 0.01 lot risks more than 2% of $500).

## 6. Holdout (2019-01-01 - 2026-09-30), run once

*Run 2026-10-02 06:25 UTC, after the finalist and the addendum were frozen.*

| id | role | trades | win % | PF | total R | result $500 | worst drop | losing yrs | loss streak | spread R | gross R/trade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **FOMC N3 W=30 2R** | finalist | 59 | 52.5 | 1.41 | 6.2 | +$117.14 | -12.7% | 3 / 8 | 4 | 0.035 | 0.154 |
| FOMC N1 W=30 m=0.5 stop=ext 2R | extra, no verdict weight | 56 | 46.4 | 0.99 | -0.2 | +$159.84 | -14.2% | 3 / 8 | 5 | 0.063 | 0.088 |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | extra, no verdict weight | 83 | 14.5 | 0.69 | -22.8 | -$77.10 | -27.1% | 5 / 8 | 17 | 0.122 | -0.093 |

**The pre-registered checks:**

| id | PF > 1.2 | >= 40 trades | drop < 30% | random-entry pctl (median, p90) | PF costs x1.5 | non-event days (trades, PF) | robust |
|---|---|---|---|---|---|---|---|
| **FOMC N3 W=30 2R** | 1.41 pass | 59 pass | -12.7% pass | **87.8** (0.96, 1.45) **FAIL** | 1.31 pass | 1,274, 0.53 pass | **no** |
| FOMC N1 W=30 m=0.5 stop=ext 2R | 0.99 FAIL | 56 pass | -14.2% pass | 70.9 (0.86, 1.23) FAIL | 0.93 FAIL | 628, 0.60 pass | no |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | 0.69 FAIL | 83 pass | -27.1% pass | 25.7 (0.82, 1.10) FAIL | 0.64 FAIL | 709, 0.74 FAIL | no |

Neighbours on the holdout (reported, not used to select):

| reference | neighbour | trades | PF | total R | drop |
|---|---|---|---|---|---|
| FOMC N3 W=30 2R | FOMC N3 W=15 2R | 59 | 1.20 | 3.7 | -16.0% |
| FOMC N3 W=30 2R | FOMC N3 W=30 2h | 59 | 1.44 | 6.3 | -13.1% |
| FOMC N1 W=30 m=0.5 ext 2R | W=15 / m=1 / stop=1ATR / 2h | 54 / 52 / 9 / 56 | 0.95 / 0.99 / 0.96 / 0.99 | -1.4 / -0.3 / -0.2 / -0.4 | -13.8% / -14.2% / -3.4% / -17.4% |
| ALL N4 N1 W=30 m=1 2ATR EOS | W=15 / m=0.5 / stop=1ATR / 2h | 82 / 88 / 25 / 83 | 0.58 / 0.69 / 1.12 / 0.78 | -31.0 / -23.7 / +2.7 / -15.2 | -37.3% / -28.0% / -8.8% / -19.0% |

Per year (holdout), R / $ (trades):

| year | FOMC N3 W=30 2R (finalist) | FOMC N1 W=30 m=0.5 ext 2R | ALL N4 N1 W=30 m=1 2ATR EOS |
|---|---|---|---|
| 2019 | -0.7 / -$9.46 (7) | +1.7 / +$10.24 (8) | -2.1 / -$7.54 (2) |
| 2020 | -0.4 / -$9.51 (7) | -2.5 / -$17.14 (7) | -7.2 / -$28.35 (7) |
| 2021 | +1.4 / +$29.85 (8) | +1.1 / +$18.09 (5) | -3.8 / -$24.09 (12) |
| 2022 | -2.9 / -$38.29 (8) | -5.1 / -$44.28 (8) | -5.9 / -$14.82 (16) |
| 2023 | +0.5 / +$6.36 (7) | -2.3 / +$8.99 (7) | +0.1 / +$9.75 (10) |
| 2024 | +1.8 / +$11.68 (8) | +1.4 / +$20.21 (8) | -5.8 / -$25.57 (13) |
| 2025 | +3.8 / +$29.28 (8) | +2.9 / +$62.30 (8) | +0.8 / +$15.88 (13) |
| 2026 | +2.8 / +$97.23 (6) | +2.5 / +$101.43 (5) | +1.3 / -$2.36 (10) |

**Reading the holdout.**
- The finalist made money (PF 1.41, +6.2 R, +0.10 R per trade) and passed PF, trade count, drawdown,
  cost stress and the non-event-days benchmark (the same rule at 14:00 ET on quiet days loses, PF
  0.53, so whatever it has comes from the statement, not the clock time). It **failed the
  random-direction benchmark**: 12% of random BUY/SELL assignments on the same 59 entries did at
  least as well (random p90 1.45 vs its 1.41). With 59 trades, a PF of 1.41 is within what luck
  produces.
- **It is carried by 2025-2026.** In R, 2025-2026 are +6.6 and 2019-2024 together -0.3. The $
  result is also inflated: 43 of 59 holdout stops were wide (median $14.95), so `lot_size` returns
  0.01 lot with verdict "skip" (more than 2% risk instead of 1%); +$97 of the +$117 is 2026.
- The FOMC momentum point that looked best on train (PF 1.46) broke even on the holdout (0.99), and
  the trend-aligned pooled rule lost badly (PF 0.69, 17 losses in a row): the train strength of FOMC
  momentum did not carry over.

## 7. Verdicts

| variant | verdict |
|---|---|
| FOMC N3 W=30 2R (finalist) | **Not robust**: 5 of 6 checks pass; fails the random-entry benchmark (87.8th percentile, needs 90th). Thin: PF 1.00 under the cost stress on train, 2019-2024 flat in R |
| All other NFP, CPI, FOMC and pooled N1 / N2 / N3 / N4 points | **Not robust**: did not pass the train selection (no edge, too few trades, or unstable) |
| FOMC N1 W=30 m=0.5 stop=ext 2R (extra, eligible but unstable) | Not robust; extra checks: holdout PF 0.99 |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend (extra, eligible but unstable) | Not robust; extra checks: holdout PF 0.69 |

## 8. Plain-English recommendation

On 23 years of real XAUUSD with real per-minute bid/ask, **trading the reaction to NFP and CPI does
not pay**: following the move, fading it, or trading the breakout of the first 5-30 minutes all lose
after spread and slippage in almost every form over 2003-2018. The spread widens 2-5x in the release
minute and the stops that fit the move are small, so costs take 0.1-0.3 R per trade from a reaction
that is close to a coin flip.

**FOMC statements are the one place with something there.** On 2003-2018 the post-statement
direction persisted more often than chance, and the pre-registered finalist (trade the first M5
close outside the 30-minute post-statement range, hold to the end of the New York day) also made
money on 2019-2026. But it is not strong enough to call an edge: about +0.05 R per trade on train
and +0.10 R on the holdout, 8 trades a year, beaten by 12% of random-direction runs on the holdout,
break-even with costs x1.5 on train, flat over 2019-2024. Its stops (median $15/oz on the holdout,
$32 in 2025-2026, up to $110) are too wide to size at 1% on the $500 standard account.

**Worth adding live? No.** The evidence does not support a news-trading strategy. It does support
keeping the live bot's **news pause** (`NEWS_PAUSE`, no new signals 30 minutes around high-impact
releases): the release minutes are where spreads are widest and where every NFP / CPI rule here lost.

If you want to keep watching the FOMC idea, paper-track FOMC N3 W=30 (no money) and re-test it
after 2-3 more years (16-24 statements). What adding it live would need (nothing implemented):

- **Calendar:** the FOMC statement schedule, which the Fed publishes in advance (format of
  `research/news/us_events.csv`), separate from the Forex Factory feed the news pause uses, with the
  time handled in New York time (14:00 ET).
- **Strategy:** a new class in `strategy.py`: on FOMC days, record the mid high/low of 14:00-14:30
  ET from M1 (or M5) candles, then on each M5 close until 16:00 ET open BUY/SELL on the first close
  outside the range; stop at the other side; target 2R; close at 16:55 ET. One trade per statement;
  it must be exempt from `NEWS_PAUSE` for that window.
- **Sizing:** stops of $10-110/oz (median $32 in 2025-2026) need a cent account (`OZ_PER_LOT = 1`) or a much larger balance;
  the existing `MIN_STOP_DISTANCE` check applies. Fills at the live bid/ask, with the spread checked
  at entry.

**Caveats.**
- **Release times.** 14:15 ET for 2003-2010 FOMC statements comes from the Fed's 2011 wording, not
  per-statement timestamps. Every rule waits 5-30 minutes after the release, so a few minutes' error
  mostly shifts the pre-release price; N1 W=5 and the release-minute stop are the most sensitive.
  Calendar dates were read with a summarising fetch tool and cross-checked (section 3).
- **Fill model:** minute candles; stop before target in the same minute; a stop the price jumps
  past inside a minute is filled at the stop (plus slippage), which flatters tight stops and the
  fade (section 2). Dukascopy is one ECN's bid/ask; a retail broker's news spreads and slippage are
  usually wider, and some brokers widen or freeze quotes at the release. 2003-2008 spreads are
  Dukascopy's near-fixed spread, too low at the release.
- **Multiple testing:** 304 train points (75 per scope plus N4). With that many, a train PF of
  1.3-1.5 on 80-90 trades is partly luck; the stability rule and the holdout exist for this. FOMC
  samples are small (8 statements a year).
- Trades where `lot_size` says "skip" are counted at 0.01 lot, so $ results and drops for wide-stop
  rules (FOMC) are at more than 1% risk; R and PF are the honest measures. Fixed $500, not
  compounded (as `backtest.summarize`).

**Deviations from the brief.**
- "Stop = release-minute extreme or k x ATR" became three stop options (release-minute extreme, 1 x
  and 2 x pre-release ATR from the entry fill); "pre-release ATR" = mean true range of the 14 M5 mid
  candles before the release. "Target 2R or exit at a fixed time (2h / end of NY session)" became
  three exits: 2R (with a time exit at 16:55 ET), 2h, and 16:55 ET ("end of NY session" = 5 minutes
  before gold's 17:00 ET daily break).
- N2's stop "beyond the post-release extreme" = extreme + 0.1 x ATR; N3's breakout only within 2
  hours of the release; N4's parent picked by the train ranking rule among N1 and N3 of the same
  scope. The finalist bar was made concrete (PF >= 1.15, <= 6 losing years, neighbours within 0.25).
- Signals on mid prices, fills on bid/ask (declared in the plan), so spread widening is not taken
  for a move.
- The minute cache and results live under `research/news/` (only `research/` and this doc were to
  be written); the cache is git-ignored by its own `.gitignore`.
- One holdout invocation crashed before showing anything (section 1) and was re-run.

**Reproduce:** `python -m research.news_calendar`, `python -m research.news build`,
`python -m research.news_null`, then `python -m research.run_news data`, `train`, `holdout` (refuses
a second run; delete `research/news/results/holdout.json` only if the plan is pre-registered again),
`diag`. Raw outputs in `research/news/results/`.
