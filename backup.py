"""Back up Gold Dojo's Supabase data to this PC (full copy, including members and chat):

    .venv/Scripts/python backup.py              # writes backups/YYYY-MM-DD/<table>.json

backups/ is git-ignored: it holds members' emails and chat, so never commit or share it. The bot also
sends a weekly copy of the paper-test record (no personal data) to a private Telegram chat if
TELEGRAM_ADMIN_CHAT_ID is set (see bot.py, weekly_backup).

To run it every week automatically on Windows (Task Scheduler), run once in PowerShell:
    schtasks /Create /SC WEEKLY /D SUN /ST 20:00 /TN "Gold Dojo backup" /TR "<full path>\\.venv\\Scripts\\python.exe <full path>\\backup.py"
"""
import json
import os
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
TABLES = ["bot_state", "signals", "members", "profiles", "blocked", "chat_rooms", "chat_messages",
          "taken_trades", "push_subscriptions", "analysis", "market_minutes"]
PAGE = 1000


def dump(url, headers, table):
    rows = []
    while True:
        r = requests.get(f"{url}/rest/v1/{table}", params={"select": "*", "limit": PAGE, "offset": len(rows)},
                         headers=headers, timeout=60)
        if r.status_code == 404 or (r.status_code == 400 and "does not exist" in r.text):
            return None  # this table isn't set up in this project
        r.raise_for_status()
        batch = r.json()
        rows += batch
        if len(batch) < PAGE:
            return rows


def main():
    url, key = os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.")
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    out = ROOT / "backups" / date.today().isoformat()
    out.mkdir(parents=True, exist_ok=True)
    for table in TABLES:
        try:
            rows = dump(url, headers, table)
        except requests.RequestException as e:
            print(f"{table}: failed ({e})")
            continue
        if rows is None:
            print(f"{table}: not set up, skipped")
            continue
        (out / f"{table}.json").write_text(json.dumps(rows, indent=1, default=str), encoding="utf-8")
        print(f"{table}: {len(rows)} rows")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
