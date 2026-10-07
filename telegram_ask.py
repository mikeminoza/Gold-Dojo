"""Ask Dojo on Telegram: people message the bot privately and an AI (Google Gemini, free tier) answers
questions about the strategies, the live signals and trading terms, using the bot's own live data.

Runs in a background thread next to the signal bot (long polling, no webhook). It never places trades
and never gives personal investment advice. Needs on the host:
    TELEGRAM_BOT_TOKEN   the same bot that posts to the channel
    GEMINI_API_KEY       from Google AI Studio (free tier)
    GEMINI_MODEL         optional, default gemini-flash-latest
Commands that don't need the AI: /start, /help, /status.

Only one copy of the bot may poll Telegram at a time: a second one gets "409 Conflict" and backs off.
"""
import os
import threading
import time
from collections import defaultdict, deque

import requests

import config

TG = "https://api.telegram.org/bot{token}/{method}"
GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_QUESTION = 600       # characters
HISTORY_TURNS = 6        # earlier messages sent along, per chat
REPLY_TOKENS = 700

GUIDE = """Gold Dojo shows paper-tested gold (XAUUSD) trading signals from a bot. The bot never places trades.
Two long-only strategies, both on a paper test (no real money):

1) Daily trend (main strategy), daily candles, two rules:
 - 100-day breakout: buy when a day closes above the highest price of the previous 100 days.
 - Trend pullback: in an uptrend (50-day average above the 200-day), buy when price dips to the 20-day
   average and closes back above it.
 Both buy at the next day's open, start with a stop 2 x ATR20 below entry and trail it 2 x ATR below the
 highest price since entry (never down). No take-profit. Risk 1% of the account per trade. About 10 trades
 a year, held days to weeks; roughly 4-5 in 10 win and a few big winners carry the result.
 23-year backtest (2003-2026, $0.50 spread, $0.20 slippage per fill, 0.02% a night financing): breakout
 79 trades, profit factor 2.14, +26.8R, worst drop -5.2R; pullback 178 trades, PF 1.53, +34.7R, worst drop
 -13.3R. Profitable both in 2003-2018 and in the unseen 2019-2026.

2) 4-hour trend, 4-hour candles, one rule:
 - 4-hour breakout: buy when a 4-hour candle closes above the highest high of the previous 100 four-hour
   candles; enter at the next 4-hour open; stop and trail 3 x ATR20; no take-profit.
 About 14 trades a year, held days. Backtest: 318 trades, PF 1.39, +40.8R, worst drop -8.9R. Roughly
 break-even 2003-2018 (PF 1.02), profitable 2019-2026 (PF 2.12): most profit came from gold's recent rise.

Terms: R = the amount risked on a trade (+2R made twice the risk, -1R lost it). ATR = average true range,
the typical candle size. Profit factor = total wins / total losses. Paper test = following signals live
with no real money. A cent account counts the balance in cents, so 0.01 lot moves 100x less in dollars.
1 standard lot = 100 oz, so a $1 move per oz = $100 per lot. Lot size = risk in $ / stop distance in $ / 100.
Tested and rejected (no edge after costs): New York opening-range breakout, London setups, news trading,
scalping, time-of-day drift, mean reversion, short selling, volatility-targeted sizing, a monthly 10-month
average filter. Simply holding gold since 2003 made +1042%, with a worst drop of -42%.
The website (Gold Dojo) has the live chart, both strategies, Performance (backtests, paper test vs
backtest), price alerts, a lot size calculator, broker settings, and public results at /results.
The Telegram channel gets every paper trade, "signal coming" warnings and a Sunday weekly summary."""

RULES = """You are Ask Dojo, the helper for Gold Dojo, answering on Telegram.
- Answer only about Gold Dojo, its two strategies, the live state below, gold trading terms and risk.
  Politely decline anything else.
- Use the facts and live state below; never invent prices, levels or results. If you don't know, say so.
- Never tell someone to buy, sell, or how much of their money to invest, and never promise profit. You may
  explain what the rules say and do sizing arithmetic when asked. Remind people briefly, when relevant,
  that this is a paper test and not financial advice.
- Plain text only (no Markdown, no asterisks). Short: at most about 120 words unless asked for more.
- Reply in the language the person writes in."""


class AskDojo:
    def __init__(self, context_fn, status_fn):
        """context_fn() -> live state text for the AI; status_fn() -> a short status for /status."""
        self.token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.key = os.getenv("GEMINI_API_KEY")
        self.model = os.getenv("GEMINI_MODEL") or "gemini-flash-latest"
        self.context_fn, self.status_fn = context_fn, status_fn
        self.offset = None
        self.history = defaultdict(lambda: deque(maxlen=2 * HISTORY_TURNS))
        self.asked = defaultdict(int)       # user id -> questions today
        self.day = time.strftime("%Y-%m-%d")
        self.recent = deque()               # times of recent AI calls, for the per-minute cap

    @property
    def enabled(self):
        return bool(config.TELEGRAM_ASK and self.token)

    def start(self):
        if not self.enabled:
            return
        threading.Thread(target=self._loop, name="telegram-ask", daemon=True).start()
        print(f"Ask Dojo on Telegram: on ({'Gemini ' + self.model if self.key else 'no GEMINI_API_KEY: commands only'})")

    # --- Telegram -----------------------------------------------------------
    def _tg(self, method, **params):
        r = requests.post(TG.format(token=self.token, method=method), json=params, timeout=60)
        return r

    def _loop(self):
        wait = 5
        while True:
            try:
                r = self._tg("getUpdates", timeout=50, offset=self.offset, allowed_updates=["message"])
                if r.status_code == 409:  # another copy of the bot is polling
                    print("Ask Dojo: another bot instance is reading Telegram (409); retrying in 5 min")
                    time.sleep(300)
                    continue
                r.raise_for_status()
                for u in r.json().get("result", []):
                    self.offset = u["update_id"] + 1
                    msg = u.get("message") or {}
                    if msg.get("chat", {}).get("type") == "private" and msg.get("text"):
                        self._handle(msg)
                wait = 5
            except Exception as e:  # network hiccups: keep going
                print(f"Ask Dojo: {e}; retrying in {wait}s")
                time.sleep(wait)
                wait = min(wait * 2, 120)

    def _send(self, chat_id, text):
        try:
            self._tg("sendMessage", chat_id=chat_id, text=text[:4000], disable_web_page_preview=True)
        except requests.RequestException as e:
            print(f"Ask Dojo: couldn't reply ({e})")

    # --- answering ----------------------------------------------------------
    def _handle(self, msg):
        chat_id, user = msg["chat"]["id"], msg.get("from", {}).get("id", msg["chat"]["id"])
        text = msg["text"].strip()
        cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else None
        if cmd in ("/start", "/help"):
            self._send(chat_id, (
                "Hi! I'm Ask Dojo. Ask me about Gold Dojo's two gold strategies (Daily trend and 4-hour trend), "
                "what they're waiting for right now, the paper-test results, or terms like R, ATR and lot size.\n\n"
                "/status - the signals right now\n\n"
                f"Up to {config.TELEGRAM_ASK_PER_DAY} questions a day. Answers come from an AI (Google Gemini, free "
                "tier: Google may use the questions to improve its products, so don't share personal details). "
                "It explains, it doesn't advise: this is a paper test, not financial advice."))
            return
        if cmd == "/status":
            self._send(chat_id, self.status_fn())
            return
        if not self.key:
            self._send(chat_id, "Questions are off right now (no AI key on the server). /status still works.")
            return
        if time.strftime("%Y-%m-%d") != self.day:
            self.day, self.asked = time.strftime("%Y-%m-%d"), defaultdict(int)
        if self.asked[user] >= config.TELEGRAM_ASK_PER_DAY:
            self._send(chat_id, f"That's today's {config.TELEGRAM_ASK_PER_DAY} questions. Back tomorrow! /status still works.")
            return
        now = time.time()
        while self.recent and now - self.recent[0] > 60:
            self.recent.popleft()
        if len(self.recent) >= config.TELEGRAM_ASK_PER_MINUTE:
            self._send(chat_id, "Lots of questions right now. Please try again in a minute.")
            return
        self.recent.append(now)
        self.asked[user] += 1
        self._tg("sendChatAction", chat_id=chat_id, action="typing")
        answer = self._ask(chat_id, text[:MAX_QUESTION])
        self._send(chat_id, answer)

    def _ask(self, chat_id, question):
        history = self.history[chat_id]
        contents = list(history) + [{"role": "user", "parts": [{"text": question}]}]
        body = {
            "system_instruction": {"parts": [{"text": f"{RULES}\n\n{GUIDE}\n\nLIVE STATE\n{self.context_fn()}"}]},
            "contents": contents,
            "generationConfig": {"maxOutputTokens": REPLY_TOKENS, "temperature": 0.3},
        }
        try:
            r = requests.post(GEMINI.format(model=self.model), json=body, timeout=60,
                              headers={"x-goog-api-key": self.key})
            if r.status_code == 429:
                return "The free AI quota is used up for now. Please try again later. /status still works."
            r.raise_for_status()
            parts = r.json()["candidates"][0]["content"]["parts"]
            answer = "".join(p.get("text", "") for p in parts).strip().replace("**", "")
        except Exception as e:
            print(f"Ask Dojo: Gemini error ({e})")
            return "Sorry, I couldn't answer that right now. Please try again in a bit."
        if not answer:
            return "Sorry, I don't have an answer for that."
        history.append({"role": "user", "parts": [{"text": question}]})
        history.append({"role": "model", "parts": [{"text": answer}]})
        return answer
