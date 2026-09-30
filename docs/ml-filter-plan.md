# Plan: "Similar past trades" filter (machine learning from trade history)

**Goal.** Before the bot takes a session-breakout signal, look up the most similar signals from the
past and use how *they* turned out to decide whether to take this one. The bot learns from history
(years of replayed signals) and from its own live trades (the signal journal), and refreshes monthly.

**Not the goal.** Predicting prices, or changing the strategy's rules. The rules still find the
signal; the filter only decides *take* or *skip*.

**Status:** phases 1 and 2 done (Oct 2026). **Verdict: no-go** - the k-NN filter made results worse
than taking every signal; keep it off. Phases 3-4 are not started. See "Phase 2 results" below.
Everything below is designed to fit the current code (`strategy.py`,
`backtest.py`, `binance_feed.py`, `bot.py`, `cloud_state.py`, `web/`).

---

## How it works (one picture)

```
5 years of M30 candles ─► replay the current strategy ─► ~300-400 past signals
                                                             │  for each: features at signal time
                                                             │            + how the trade ended
                                                             ▼
                                                    trade memory (data/trade_memory.parquet)
                                                             ▲                │
      live closed trades (signal journal) ───monthly─────────┘                │
                                                                              ▼
new signal ─► compute the same features ─► find the 20 most similar past trades ─► take / skip
                                                                              │
                                                  website: "13 of 20 similar trades won, avg +0.5R"
```

---

## Phase 1 - Build the trade memory (research only, no changes to the live bot)

**New file:** `ml/build_memory.py`

1. **Get history.** `binance_feed.get_bars("PAXGUSDT", "M30", N)` for ~5 years, plus `D1` for the
   daily trend. Check the first date PAXG candles exist (Binance listed PAXG in 2020); start from
   the first *full* year with steady volume (probably 2021). Save to `data/history_M30.parquet` so
   later runs don't refetch.
2. **Replay the strategy.** Use the same code the live bot uses so nothing drifts:
   `strat = strategy.create("orb", 1800)`, `df = strat.prepare(bars, daily)`,
   `trades = backtest.run(strat, df, 0.01, 1800)`. This already applies spread, sizing and
   session-end exits.
3. **Record features at the signal candle** (the candle whose close triggered the entry - one candle
   before `entry_time`). Everything must be known *at that moment* (see "No peeking" below).

| Feature | Formula (columns already produced by `SessionBreakout.prepare`) | Why |
|---|---|---|
| `range_atr` | `(range_hi - range_lo) / atr` | Very wide / very narrow ranges behave differently |
| `break_atr` | BUY: `(close - range_hi) / atr`, SELL: `(range_lo - close) / atr` | How decisive the breakout was |
| `trend_strength` | `(daily_close - daily_ema) / daily_ema * 100` (sign-flipped for SELL) | Strong vs barely-there trend |
| `rsi` | `rsi` | Momentum / stretched |
| `atr_pct` | `atr / close * 100` | Overall volatility level |
| `atr_change` | `atr / atr 20 candles earlier` | Volatility rising or falling |
| `candle_body` | `abs(close - open) / (high - low)` on the signal candle | Clean vs wicky breakout |
| `minutes_in` | minutes from session open to the signal | Early vs late breakouts |
| `weekday` | 0-4 (one-hot or cyclic) | Day-of-week effects |
| `side` | BUY = 1, SELL = -1 | Buy and sell breakouts may differ |
| `news_day` *(phase 1b, optional)* | 1 if a high-impact US release that day | Data-day chaos |

   - `news_day` needs a history of release dates. The live Forex Factory feed only covers this
     week, so either (a) leave it out at first, or (b) add `data/us_events.csv` with FOMC, CPI and
     NFP dates (NFP = first Friday of the month; FOMC dates are published; CPI dates listed on the
     BLS site).

4. **Record the outcome** for each trade: `won` (pnl > 0), `r_multiple` (pnl / initial risk, e.g.
   +2.0, -1.0, +0.4 when closed at session end), `exit_reason`, `hold_minutes`.
5. **Save** `data/trade_memory.parquet` (one row per trade: time, features, outcome, `source =
   "backtest"`).

**Done when:** the memory has at least ~250 trades and a quick summary prints (count, win rate,
average R) that matches running `backtest.py` on the same period.

---

## Phase 2 - Test whether it helps (the go / no-go step)

**New file:** `ml/evaluate.py`. **Rule: for any date, only trades that *closed before* that date may
be used as "past trades".** Anything else is looking into the future and will make results look
fake-good.

1. **Model: k-nearest neighbours** (scikit-learn `KNeighborsClassifier` / manual distances).
   - Standardise features with a `StandardScaler` fitted **only on the training trades**.
   - `k = 20` neighbours, distance-weighted.
   - Score for a new signal = win rate of its neighbours, and average `r_multiple` of its neighbours.
   - Take the signal if `win_rate >= 0.50` **and** `avg_r > 0` (both configurable).
   - Also try, for comparison only: logistic regression on the same features (tells you which
     features matter via its coefficients).
2. **Walk-forward test** (expanding window):
   - Start with the first 18 months as memory; then step forward 3 months at a time.
   - In each 3-month test block, score each signal using only earlier trades, record take/skip.
   - Repeat until the end of the data.
3. **Compare, over the test blocks only:**

| | All signals (current bot) | Filtered signals |
|---|---|---|
| Trades | 376 | 40 |
| Win rate | 43.4% | 40.0% |
| Profit factor | 1.14 | 0.67 |
| Result on $500 (`sizing.lot_size`, as the live bot) | +$156.64 | -$62.03 |
| Worst drop | -38.9% | -17.8% (random 40 trades: -9.9% median) |
| Share of blocks where filtered beat unfiltered | - | 53% by $ result; 29% on higher PF **and** smaller drop |

*(k = 20, take if neighbour win rate >= 0.50 and avg R > 0; 17 test blocks, Jul 2022 - Sep 2026.
Filled in from `python -m ml.evaluate --shuffles 200 --randoms 5000`, Oct 2026.)*

4. **Robustness checks** (so a lucky setting doesn't sneak through):
   - Repeat with `k` = 10, 20, 40 and thresholds 0.45 / 0.50 / 0.55. The result should be similar
     across them.
   - Shuffle the `won` labels and rerun: the "improvement" must disappear (if it doesn't, something
     is leaking future information).
   - Check it isn't just "skip more trades": compare with randomly skipping the same number.

**Go / no-go (write the numbers into this file when done):**
- **Go** if, on the test blocks, the filtered version has a **higher profit factor and a smaller
  worst drop**, in **most** blocks, across the nearby `k` / threshold values, and the label-shuffle
  test shows no improvement.
- **No-go** otherwise: keep the filter off. That is a valid, useful result.

### Phase 1 results (Oct 2026)

- **History:** Binance PAXGUSDT from its listing on 28 Aug 2020 to 30 Sep 2026: 73,035 M30 candles
  and 1,588 D1 candles (market hours only, as the live feed). 2020 is thin (median 34 trades per
  candle vs 100-965 later), so trades are kept from **1 Jan 2021**; the indicators and the 50-day EMA
  warm up on the 2020 data.
- **Settings replayed** (from `config.py`): ORB, M30, New York only, 60-minute range, RR 2.0, min
  spread $0.25. Same code path as the bot: `strategy.create("orb", 1800)`, `prepare`,
  `backtest.run(..., 0.01, 1800)` with one fresh strategy (session state starts empty, `on_open` is
  called by `backtest.run`, exactly as `backtest.py` does).
- **Memory:** 509 trades, 2021-01-01 to 2026-09-30, win rate 41.5%, average R -0.045, +$22.57/oz,
  +$7.93 on $500. Exits: 248 session end, 194 stop, 67 target. A separate `backtest.run` +
  `backtest.summarize` on the same period gives the same 509 trades, 41.5%, PF 1.01, +$7.93, worst
  drop -63.3% (93 trades where even 0.01 lot risked over 2%).
- **By year** (avg R): 2021 -0.28, 2022 -0.03, 2023 -0.13, 2024 -0.17, 2025 +0.17, 2026 +0.17. The
  strategy only made money in 2025-2026 on this data.
- `news_day` was left out (no historical calendar yet).

### Phase 2 results (Oct 2026)

Walk-forward as described: memory = first 18 months (2021-01 to 2022-06), then 17 blocks of 3 months.
Each signal's neighbours are only trades whose exit was before its signal candle, and the scaler is
refitted on those past trades for every signal.

**Robustness grid** (filtered results; all signals = 376 trades, PF 1.14, +$156.64, drop -38.9%):

| k | threshold | taken | win % | PF | result on $500 | worst drop | blocks $ beat | blocks PF & drop beat |
|---|---|---|---|---|---|---|---|---|
| 10 | 0.45 | 84 | 35.7 | 0.70 | -$110.49 | -23.8% | 41% | 18% |
| 10 | 0.50 | 62 | 37.1 | 0.77 | -$59.81 | -17.6% | 47% | 29% |
| 10 | 0.55 | 43 | 30.2 | 0.78 | -$43.08 | -19.5% | 53% | 18% |
| 20 | 0.45 | 72 | 37.5 | 0.69 | -$104.69 | -27.5% | 53% | 35% |
| 20 | 0.50 | 40 | 40.0 | 0.67 | -$62.03 | -17.8% | 53% | 29% |
| 20 | 0.55 | 12 | 58.3 | 1.68 | +$27.70 | -7.6% | 59% | 29% |
| 40 | 0.45 | 34 | 38.2 | 0.83 | -$38.82 | -16.9% | 59% | 12% |
| 40 | 0.50 | 11 | 45.5 | 1.93 | +$41.36 | -5.4% | 53% | 12% |
| 40 | 0.55 | 2 | 50.0 | 3.61 | +$20.24 | -1.6% | 53% | 6% |

7 of 9 settings have a *lower* profit factor than taking everything. The two with a higher PF keep
only 11-12 trades in 4 years (too few to mean anything) and still make far less money than all
signals. The "blocks $ beat" share is flattered by blocks where all signals lost and the filter
took ~0 trades.

**Label shuffle** (200 runs, outcomes shuffled across trades, k = 20 / 0.50): shuffled filters
averaged PF 1.21 and +$38.36; 94% of shuffles had a PF at least as good as the real filter. The real
filter is *worse* than one fed random labels - no leak, but no signal either.

**Random skip of the same count** (keep 40 of 376 at random, 5,000 runs): random median PF 1.12,
+$13.77, drop -9.9%. The real filter sits at the 12th percentile for PF, 8th for result and 9th for
worst drop - i.e. worse than skipping at random. Its smaller drop than "all signals" comes only
from taking fewer trades.

**Logistic regression** (for comparison; refit at each block start on trades closed before it):

| rule | taken | win % | PF | result | worst drop | vs random skip (PF pct) | shuffled labels with PF >= real |
|---|---|---|---|---|---|---|---|
| p(win) >= 0.50 | 69 | 47.8 | 1.50 | +$83.85 | -12.1% | 82nd | 20% |
| p(win) >= 0.45 | 123 | 45.5 | 1.26 | +$74.21 | -14.8% | 69th | 16% |
| p(win) >= past win rate | 214 | 45.8 | 1.37 | +$203.70 | -19.0% | 94th | 6% |

Coefficients (standardised, fitted on all 509 trades, for reading only; + = more likely to win):
trend_strength +0.19, candle_body -0.18, atr_pct -0.17, atr_change +0.15, side (BUY) +0.15,
break_atr +0.13, rsi -0.08, weekday_cos +0.06, minutes_in +0.05, weekday_sin -0.03, range_atr 0.00.
Read: stronger daily trend, more decisive breaks, rising-but-not-high volatility and smaller signal
candle bodies did a bit better; BUYs beat SELLs (a gold bull market, 2024-2026).

The logistic regression looks better than k-NN, but it is **not** a go on its own: three thresholds
were tried and only one clears the random-skip / shuffle bars (94th pct, 6%), the block-by-block win
(higher PF *and* smaller drop) is only 35-59%, and "BUY beats SELL" and
"strong trend wins" are probably the 2024-2026 gold rally rather than a stable edge. Worth a
separate, pre-registered test (fix the rule now, judge it only on the next 6-12 months of live /
new data) before any live use.

### Verdict: **no-go** (keep `ML_FILTER` off; don't start phase 3)

Against the criteria above:
- Higher profit factor: **no** (0.67 vs 1.14 at the chosen setting; lower in 7 of 9 grid settings).
- Smaller worst drop: only because it takes 1 in 9 trades; vs random skipping the same number its
  drop is worse (9th percentile).
- In most blocks: **no** - higher PF and smaller drop in 29% of blocks (6-35% across the grid).
- Across nearby k / thresholds: **no** consistent improvement.
- Label shuffle shows no improvement: satisfied in the sense that nothing leaks, but the real filter
  is worse than the shuffled ones, so there is no information to keep.

Likely reasons: ~370 test trades with 11 features is thin for nearest neighbours, the strategy's
own edge is small (PF ~1.0-1.1 over the whole period) and flips by regime (losing 2021-2024,
winning 2025-2026), so "similar past trades" mostly come from a different regime than the trade
being judged. Re-run `python -m ml.build_memory --refetch && python -m ml.evaluate` after more live
history (or on MT5 broker data) before revisiting.

---

## Phase 3 - Put it in the live bot (only if phase 2 says go)

**New file:** `ml_filter.py`

```python
class SimilarTradesFilter:
    def __init__(self, memory_path, k, min_win_rate, min_avg_r): ...
    def features(self, df, i, sig) -> dict          # same formulas as ml/build_memory.py
    def judge(self, features) -> dict               # {"take": bool, "wins": 13, "of": 20,
                                                    #  "avg_r": 0.5, "win_rate": 0.65}
```
- Put the feature formulas in **one shared function** used by both `ml/build_memory.py` and
  `ml_filter.py`, so research and live can never compute them differently.

**`config.py`**
```python
ML_FILTER = False              # turn on only after phase 2 says go
ML_NEIGHBOURS = 20
ML_MIN_WIN_RATE = 0.50
ML_MIN_AVG_R = 0.0
ML_MEMORY_FILE = "data/trade_memory.parquet"
```

**`bot.py` (in `Bot.on_candle_close`)**, after `sig = self.strat.entry(df, i)` and the news check:
```python
if sig and config.ML_FILTER:
    verdict = self.ml.judge(self.ml.features(df, i, sig))
    if not verdict["take"]:
        record a "skip" event with the verdict (so it shows on the site and in the journal)
        return
    attach verdict to the open event ("similar": {...})
```
- Load the memory once at start-up; reload it when the monthly refresh writes a new file.
- If the memory file is missing or broken: log it and **behave as if `ML_FILTER = False`** (never
  block trading because of a missing file).

**Journal (`supabase/signals.sql`)** - add columns, then save them from `cloud_state.journal_row`:
```sql
alter table public.signals add column if not exists features jsonb;   -- the numbers above
alter table public.signals add column if not exists similar jsonb;    -- {"wins":13,"of":20,"avg_r":0.5}
-- allow a 'skip' type as well as 'open' / 'close':
alter table public.signals drop constraint if exists signals_type_check;
alter table public.signals add constraint signals_type_check check (type in ('open', 'close', 'skip'));
```
Saving features for *live* trades is what lets them join the memory later.

**Website (`web/app`)**
- Signal card / history: show *"Similar past trades: 13 of 20 won, avg +0.5R"* on opens, and
  *"Skipped: similar past trades 6 of 20 won, avg -0.3R"* for skips.
- Journal results: add a toggle "include skipped" so you can see what the skipped trades *would*
  have done (the bot keeps tracking a skipped signal's outcome virtually - see phase 4).

---

## Phase 4 - Keep learning (monthly refresh)

**New file:** `ml/refresh.py`, run once a month (Windows Task Scheduler, e.g. 1st of the month,
9:00 AM PH, while the PC is on).

1. Fetch the newest candles and add them to `data/history_M30.parquet`.
2. Rebuild the backtest part of the memory (same code as phase 1).
3. Add **live closed trades from the journal** (Supabase `signals` rows with `features`), tagged
   `source = "live"`. Optionally give live trades more weight than replayed ones.
4. Re-run the phase 2 evaluation on the newest 3 months and write a short report to
   `data/ml_report.md` (and optionally to Supabase so the site can show "Filter check, Oct 2026:
   still helping / not helping").
5. **Safety switch:** if the filter did worse than "all signals" in the latest two monthly checks,
   write a warning and suggest turning `ML_FILTER` off (don't change it automatically).
6. Write the new memory file; the bot picks it up on its next restart (or reload without restart).

**Virtual tracking of skipped signals:** when the filter skips a signal, the bot should still
follow it on paper (stop / target / session end) and record the would-be result. Without this,
the filter can never learn that it's skipping good trades.

---

## Files summary

| File | Phase | What |
|---|---|---|
| `ml/features.py` | 1 | The one shared feature function |
| `ml/build_memory.py` | 1 | Replays history, writes `data/trade_memory.parquet` |
| `ml/evaluate.py` | 2 | Walk-forward test, robustness checks, go/no-go numbers |
| `ml_filter.py` | 3 | Live `SimilarTradesFilter` |
| `config.py`, `bot.py`, `cloud_state.py` | 3 | Switch, gate in `on_candle_close`, journal fields |
| `supabase/signals.sql` | 3 | `features`, `similar`, `skip` type |
| `web/app/components/Dashboard.tsx` | 3 | "Similar past trades" line, skipped signals |
| `ml/refresh.py` + Task Scheduler entry | 4 | Monthly update and report |
| `requirements-ml.txt` | 1 | `scikit-learn`, `pyarrow` (for parquet); kept out of `requirements.txt` so the live bot stays light |
| `.gitignore` | 1 | add `data/` (big, regenerable files) |

---

## Watch-outs

- **No peeking:** features only from candles that had closed at the signal; "past trades" only
  those closed before the current date; scaler fitted on past data only.
- **Small data:** ~300-400 trades is enough for k-NN with ~10 features, not for complex models.
  Don't add dozens of features - every extra one needs more history.
- **PAXG vs broker prices:** memory built on PAXG (shifted) will differ slightly from a broker's
  XAUUSD. Switch the history source to MT5 once account-reading is added, and rebuild.
- **Regime changes:** gold in 2021 behaved differently from 2026. If the evaluation shows old years
  hurting, weight recent trades more (e.g. halve the weight of trades older than 2 years).
- **It's a filter, not a guarantee:** even a filter that helps will have losing streaks. Keep the
  1% risk rule and the demo-first approach.

## Checklist

- [x] Phase 1: memory built, summary matches `backtest.py` (509 trades, 2021-2026)
- [x] Phase 2: walk-forward table filled in above, robustness checks done, go / no-go decided
      (**no-go**)
- [ ] Phase 3 (if go): `ML_FILTER` code, journal columns, website line, tested with the filter off
      and on
- [ ] Phase 4: monthly refresh scheduled, virtual tracking of skipped signals, first report written
