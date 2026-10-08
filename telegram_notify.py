"""Send Telegram messages. Run this file directly to find your chat ID and send a test message."""
import os

import requests
from dotenv import load_dotenv

load_dotenv()
API = "https://api.telegram.org/bot{token}/{method}"


def send(text):
    token, chat_id = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[telegram not configured]\n" + text)
        return
    try:
        r = requests.post(
            API.format(token=token, method="sendMessage"),
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        if not r.ok:
            print(f"Telegram error {r.status_code}: {r.text}")
    except requests.RequestException as e:
        print(f"Telegram send failed: {e}")


def send_to(chat_id, text):
    """Send plain text to one chat (e.g. the admin's private chat). Returns True when it went through."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        return False
    try:
        r = requests.post(API.format(token=token, method="sendMessage"),
                          json={"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True}, timeout=10)
        return r.ok
    except requests.RequestException:
        return False


def send_document(chat_id, filename, data, caption=""):
    """Send a file (bytes) to one chat, e.g. the weekly backup to a private admin chat."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        return False
    try:
        r = requests.post(API.format(token=token, method="sendDocument"),
                          data={"chat_id": chat_id, "caption": caption[:1000]},
                          files={"document": (filename, data, "application/json")}, timeout=60)
        if not r.ok:
            print(f"Telegram error {r.status_code}: {r.text[:200]}")
        return r.ok
    except requests.RequestException as e:
        print(f"Telegram send failed: {e}")
        return False


if __name__ == "__main__":
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in .env first.")
    updates = requests.get(API.format(token=token, method="getUpdates"), timeout=10).json()
    chats = {u["message"]["chat"]["id"]: u["message"]["chat"].get("first_name") or u["message"]["chat"].get("title")
             for u in updates.get("result", []) if "message" in u}
    if chats:
        print("Chats that messaged your bot (put one in TELEGRAM_CHAT_ID):")
        for cid, name in chats.items():
            print(f"  {cid}  ({name})")
    else:
        print("No messages yet. Open your bot in Telegram, press Start / send 'hi', then run this again.")
    if os.getenv("TELEGRAM_CHAT_ID"):
        send("✅ Gold signal bot test message — Telegram is working.")
        print("Test message sent.")
