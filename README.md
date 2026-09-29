# Golden Skibidi: XAUUSD gold signal bot

Watches XAUUSD and shows live BUY / SELL / CLOSE signals on a website (Telegram optional).
**Signals only — it never places trades.**

## Prices (free, no account or API key)
- **Live XAUUSD bid/ask:** real spot quotes from Swissquote's public price feed.
- **Candles / history:** PAXG/USDT from Binance public data (PAX Gold, a token backed 1:1 by physical
  gold), shifted by the measured PAXG-vs-spot gap (usually $5–10) so they line up with XAUUSD.
  Candles from when real gold is closed (weekends, the daily 17:00–18:00 New York break) are dropped.

Set `PRICE_FEED` in `config.py` to `"binance"` for raw PAXG, or `"mt5"` to use a MetaTrader 5
terminal instead (MT5 is planned for reading your account balance later).

## Run it (Windows)
1. `.venv\Scripts\python bot.py` (or `bot.py --demo` for fake fast prices)
2. In another terminal: `pnpm --dir web dev`, then open the URL it prints (usually http://localhost:3000)
3. Backtest on real history: `.venv\Scripts\python backtest.py --compare`

Optional Telegram: message **@BotFather** → `/newbot`, `copy .env.example .env`, paste the token into
`TELEGRAM_BOT_TOKEN`, press **Start** on your bot, run `.venv\Scripts\python telegram_notify.py` for your
chat ID, put it in `TELEGRAM_CHAT_ID`. It only sends when both are set.

## Live signal website
The bot writes its live view to `live.json` (about twice a second) and candles for every timeframe to
`chart.json` (every 2 seconds); the Next.js site in `web/` streams them to the browser.

- **Turn on sound alerts** for a chime and a desktop notification on every signal. The sun/moon button
  switches between dark and light themes.
- The chart toolbar works like MetaTrader: timeframes M1–D1, bars / candles / line, an Indicators menu
  (EMAs, Bollinger Bands, RSI panel, tick volume, opening range, entry/SL/TP lines, signal markers, grid),
  horizontal and trend-line drawing tools (Esc cancels, the bin deletes them), and zoom / fit /
  jump-to-latest. Scroll to zoom, drag to pan. Chart settings and drawings are remembered in your browser.

## Position sizing (edit in `config.py`)
Every signal suggests a lot size so the trade risks about `RISK_PERCENT` of `ACCOUNT_BALANCE`
(default: 1% of $500 = $5). Gold's smallest trade is 0.01 lot = 1 oz, so a $5 stop already risks $5;
when even 0.01 lot risks more than `MAX_RISK_PERCENT` (2%), the signal says to consider skipping it.
Update `ACCOUNT_BALANCE` as the account changes. For a cent account set `OZ_PER_LOT = 1`.
Backtests charge at least `BACKTEST_MIN_SPREAD` per trade — set it to your broker's typical spread.

## Strategies (`STRATEGY` in `config.py`)
- **`orb` — session breakout (default):** mark the first 30 minutes of the London and New York sessions,
  buy a 15-minute close above that range when the daily trend is up (sell mirrored), stop on the other
  side of the range, target 2× the risk, one trade per session, close at session end. No new signals
  30 minutes either side of major US news.
- **`ema` — EMA crossover:** EMA 9 crosses EMA 21, price on the right side of EMA 200, RSI filter,
  1.5×ATR stop, 3×ATR target, 15:00–24:00 PH time, Mon–Fri.
