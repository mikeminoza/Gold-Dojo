import config
import telegram_ask


def _dojo(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test")
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    d = telegram_ask.AskDojo(lambda: "live", lambda: "STATUS")
    sent, asked = [], []
    d._send = lambda chat, text: sent.append(text)
    d._tg = lambda *a, **k: None
    d._ask = lambda chat, q: asked.append(q) or "answer"
    return d, sent, asked


def _msg(text, user=1):
    return {"chat": {"id": user, "type": "private"}, "from": {"id": user}, "text": text}


def test_commands_need_no_ai(monkeypatch):
    d, sent, asked = _dojo(monkeypatch)
    d._handle(_msg("/status"))
    d._handle(_msg("/start"))
    assert sent[0] == "STATUS" and "Ask Dojo" in sent[1] and not asked


def test_daily_and_per_minute_limits(monkeypatch):
    monkeypatch.setattr(config, "TELEGRAM_ASK_PER_DAY", 2)
    monkeypatch.setattr(config, "TELEGRAM_ASK_PER_MINUTE", 3)
    d, sent, asked = _dojo(monkeypatch)
    for _ in range(3):
        d._handle(_msg("what is R?"))
    assert len(asked) == 2 and "today's 2 questions" in sent[-1]
    d._handle(_msg("hi", user=2))  # another person: the 3rd AI call this minute
    d._handle(_msg("hi", user=3))  # 4th: over the shared per-minute cap
    assert len(asked) == 3 and "try again in a minute" in sent[-1]
