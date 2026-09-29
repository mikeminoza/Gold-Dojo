"""Writes the bot's current view to live.json (and chart candles to chart.json) for the website."""
import json
import os
import time
from pathlib import Path

HERE = Path(__file__).parent
LIVE_FILE = Path(os.getenv("LIVE_FILE", HERE / "live.json"))
CHART_FILE = Path(os.getenv("CHART_FILE", HERE / "chart.json"))


def _plain(value):
    """Make numpy / pandas values JSON-serializable."""
    if hasattr(value, "item"):
        return value.item()
    if hasattr(value, "timestamp"):
        return int(value.timestamp())
    raise TypeError(f"Can't serialize {type(value)}")


def write(state, path=LIVE_FILE):
    # One temp file per process, so two bots running by mistake don't break each other's writes
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(state, default=_plain))
    # On Windows the replace can briefly fail while the website is reading the file
    for _ in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.02)
