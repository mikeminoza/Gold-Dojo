# Plan: "Similar past trades" filter (machine learning from trade history)

**Goal.** Before the bot takes a session-breakout signal, look up the most similar signals from the
past and use how *they* turned out to decide whether to take this one. The bot learns from history
(years of replayed signals) and from its own live trades (the signal journal), and refreshes monthly.

**Not the goal.** Predicting prices, or changing the strategy's rules. The rules still find the
signal; the filter only decides *take* or *skip*.

**Status:** not started. Everything below is designed to fit the current code (`strategy.py`,
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
| Trades | | |
| Win rate | | |
| Profit factor | | |
| Result on $500 (`sizing.lot_size`, as the live bot) | | |
| Worst drop | | |
| Share of blocks where filtered beat unfiltered | | |

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
| `requirements.txt` | 1 | add `scikit-learn`, `pyarrow` (for parquet) |
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

- [ ] Phase 1: memory built, summary matches `backtest.py`
- [ ] Phase 2: walk-forward table filled in above, robustness checks done, go / no-go decided
- [ ] Phase 3 (if go): `ML_FILTER` code, journal columns, website line, tested with the filter off
      and on
- [ ] Phase 4: monthly refresh scheduled, virtual tracking of skipped signals, first report written
