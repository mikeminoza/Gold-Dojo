"""All tunable settings. Change these, re-run backtest.py, compare results."""

# Where prices come from (all free, no API key):
#   "xauusd"  = real XAUUSD spot bid/ask (Swissquote) + candles from PAXG shifted to the spot price
#   "binance" = PAXG/USDT only (gold-backed token, usually a few dollars above spot)
#   "mt5"     = your broker's MetaTrader 5 terminal (for later)
PRICE_FEED = "xauusd"
BINANCE_SYMBOL = "PAXGUSDT"
FEED_MARKET_HOURS_ONLY = True  # drop PAXG candles from when real gold is closed (weekends, daily break)

# MetaTrader 5 symbol (only used when PRICE_FEED = "mt5"). Broker names differ: XAUUSD, XAUUSDm, GOLD ...
# If this exact name isn't found, the bot auto-picks the first symbol containing "XAU" or "GOLD".
SYMBOL = "XAUUSD"

# Candle timeframe: M5, M15, M30, H1
# M30 won a walk-forward test on real gold (Nov 2025 - Sep 2026); M15 lost money in the same test
TIMEFRAME = "M30"

# ======================================================================
# Account and position sizing
# ======================================================================
# Every signal shows a suggested lot size so the trade risks about RISK_PERCENT of the account.
# Update ACCOUNT_BALANCE yourself as the account grows or shrinks.
ACCOUNT_BALANCE = 500.0
RISK_PERCENT = 1.0          # target risk per trade
MAX_RISK_PERCENT = 2.0      # warn "consider skipping" when even the smallest lot risks more than this
# Standard account: 1 lot = 100 oz, smallest trade 0.01 lot (1 oz).
# Cent account: set OZ_PER_LOT = 1 (0.01 lot = 0.01 oz) and ACCOUNT_BALANCE in dollars as usual.
OZ_PER_LOT = 100
MIN_LOT = 0.01
LOT_STEP = 0.01

# Which strategy the live bot runs:
#   "orb" = session breakout (opening range of London / New York, with the daily trend)
#   "ema" = EMA crossover with trend + RSI filters
STRATEGY = "orb"

# Shared by both strategies: volatility measure used to size stops
ATR_PERIOD = 14

# ======================================================================
# Session breakout ("orb")
# ======================================================================
# Session open/end times are in each exchange's own time zone, so daylight saving is automatic.
# In PH time (UTC+8) summer: London 3:00-7:00 PM, New York 8:30-11:30 PM (winter: one hour later).
# New York only: London breakouts mostly failed in the walk-forward test. To trade London too,
# remove the # in front of its line.
ORB_SESSIONS = [
    # {"name": "London", "tz": "Europe/London", "open": (8, 0), "end": (12, 0)},
    # 08:30 New York = US data release time, so the data spike becomes part of the range
    {"name": "New York", "tz": "America/New_York", "open": (8, 30), "end": (11, 30)},
]
ORB_RANGE_MINUTES = 60      # the opening range = first 60 minutes of the session (8:30-9:30 PM PH)
ORB_RR = 2.0                # take profit = 2 x the risk
ORB_MAX_STOP_ATR = 1.0      # cap the stop at 1 x ATR when the range is very wide
ORB_MIN_STOP_ATR = 0.5      # and keep it at least 0.5 x ATR when the range is tiny
# Skip a trade whose stop ends up closer than this ($ per oz) to the actual entry price: by then the
# spread is most of the risk and the suggested lot size would be dangerously big.
MIN_STOP_DISTANCE = 2.0
# Paper-tracked cost filter (docs/cost-filter-research.md): each signal is TAGGED with whether
# (spread + COST_SLIPPAGE) would exceed COST_FILTER_PCT % of its stop. It never skips a signal;
# the Analysis tab compares tagged groups on fresh data before anyone decides to use it.
COST_FILTER_PCT = 8.0
COST_SLIPPAGE = 0.20
DAILY_TREND_EMA = 50        # only buy above the 50-day EMA, only sell below it

# ======================================================================
# EMA crossover ("ema")
# ======================================================================
EMA_FAST = 9
EMA_SLOW = 21
EMA_TREND = 200          # only BUY above it, only SELL below it
RSI_PERIOD = 14
RSI_BUY_RANGE = (50, 70)   # momentum up, but not overbought
RSI_SELL_RANGE = (30, 50)  # momentum down, but not oversold
SL_ATR_MULT = 1.5        # stop loss = 1.5 x ATR away from entry
TP_ATR_MULT = 3.0        # take profit = 3 x ATR (1:2 risk/reward)
CLOSE_ON_OPPOSITE_CROSS = True  # exit early if EMAs cross back the other way

# EMA strategy's trading hours, in YOUR PC's local time (24h clock).
# 15:00-24:00 in UTC+8 = London open through the London/New York overlap.
SESSION_START_HOUR = 15
SESSION_END_HOUR = 24
TRADE_WEEKDAYS = {0, 1, 2, 3, 4}  # Mon-Fri

# ======================================================================
# News pause (live bot, both strategies)
# ======================================================================
# No new signals this many minutes before/after high-impact US releases (CPI, jobs, Fed...).
# Calendar comes from the free Forex Factory weekly feed. The backtest can't apply this
# (no historical calendar), so live results may differ slightly from the backtest.
NEWS_PAUSE = True
NEWS_PAUSE_MINUTES = 30

# Loss limits (loss_guard.py): pause new signals after a bad run. R = result / risk (-1R = a full loss).
LOSS_LIMITS = True
LOSS_STREAK_LIMIT = 5         # this many losses in a row...
LOSS_STREAK_PAUSE_DAYS = 7    # ...pauses new signals for a week
MONTHLY_LOSS_LIMIT_R = 6.0    # losing 6R in a calendar month pauses until next month

# After each session the bot posts a short recap (the trade's result, or why there was none) in chat
RECAP_TO_CHAT = True
RECAP_ROOM = "General"
RECAP_AUTHOR = "Gold Dojo"   # shown as the sender (24 characters at most)

# Once a day the bot posts a short health check (uptime, restarts, errors, price source) in chat
HEALTH_REPORT = True
HEALTH_REPORT_ROOM = "Bot status"   # created automatically if it doesn't exist
HEALTH_REPORT_HOUR = 9              # local hour in DISPLAY_TZ (9 AM PH time, after the New York session)

# Save a one-minute summary of live prices and spreads to Supabase (market_recorder.py,
# supabase/market-data.sql): fresh, unseen data for testing future strategy ideas.
RECORD_MARKET_DATA = True

# Safety checks (guards.py)
MAX_TOTAL_RISK_PCT = 3.0      # never more than this % of the account at risk in open trades together
DRIFT_MIN_TRADES = 20         # judge live vs backtest only after this many closed trades
DRIFT_PERCENTILE = 5          # live total below the 5th percentile of backtest stretches = alarm
DRIFT_AUTO_PAUSE = True       # the alarm also pauses new New York signals until results recover
SILENCE_PRICE_SECONDS = 600   # alarm: no real gold price for 10 min during market hours
SILENCE_CANDLE_SECONDS = 5400 # alarm: no new candle processed for 90 min during market hours

# Daily trend mode (trend_daily.py): two long-only daily rules, forward-tested on paper and shown to
# members. Announced in chat when a paper trade opens or closes.
DAILY_TREND = True

# Paper tracking of the daily swing candidate (swing_paper.py, docs/swing-research.md): recorded only,
# never shown as a signal. Re-test it against the backtest and buy-and-hold after 6-12 months.
SWING_PAPER = True
SWING_CHANNEL_DAYS = 100
SWING_STOP_ATR = 2.0
SWING_ATR_PERIOD = 20

# Timeframes the website chart can switch between, and how many candles each shows
CHART_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"]
CHART_BARS = 300
CHART_WRITE_SECONDS = 2

# Time zone the website shows times in
DISPLAY_TZ = "Asia/Manila"
DISPLAY_TZ_LABEL = "PH time"
DISPLAY_TZ_SHORT = "PH"     # added after times on the page, e.g. "15:00 PH"

# Backtests charge at least this spread per trade ($ per oz). Demo servers often show near-zero
# spreads; real broker accounts are typically $0.15-0.40 on gold. Set it to your broker's spread.
BACKTEST_MIN_SPREAD = 0.25

# How often the live bot checks prices (seconds)
POLL_SECONDS = 0.5
