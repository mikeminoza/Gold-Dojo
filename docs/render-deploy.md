# Run the bot 24/7 on Render (free)

Render runs **the same bot as your PC** - real-time, prices checked twice a second - in Render's
Singapore data centre. The website on Vercel doesn't change: it keeps reading signals from Supabase,
so your PC can be off.

**How the free plan works, and how the bot deals with it**
| Render free plan | What the bot does |
|---|---|
| Only runs *web services* | The bot serves a small status page at `/health` |
| Sleeps after 15 minutes with no visits | A free pinger (cron-job.org) visits `/health` every 10 minutes |
| Wipes its disk on every restart | The bot keeps its memory (open trade, sessions already traded) in Supabase and restores it on start |
| 750 free hours a month | Enough for one service running all month |
| Restarts after each deploy / now and then | Memory is restored; if the price loop ever freezes, `/health` fails and Render restarts it |

---

## 1. Create the Render account
Go to **render.com** -> **Get Started** -> **Sign up with GitHub** (the account that has the
Golden-Skibidi repo). Allow Render to see the **Golden-Skibidi** repository.

## 2. Create the service from the Blueprint
1. In Render: **New -> Blueprint**.
2. Pick the **Golden-Skibidi** repository. Render reads `render.yaml` and shows one service,
   **golden-skibidi-bot** (Python, Singapore, Free).
3. It asks for the two values marked `sync: false` - copy them from your PC's `.env`
   (`C:\Users\Glophics\mike\personal\trading-bot\.env`):
   - `SUPABASE_URL` - `https://bdwgnhfzwmckcujacgqd.supabase.co`
   - `SUPABASE_SECRET_KEY` - the secret key (it stays inside Render, never in GitHub)
4. **Apply** / **Deploy**. The first build takes a few minutes.

(No Blueprint option? **New -> Web Service** -> the repo -> Region *Singapore*, Instance *Free*,
Build `pip install -r requirements.txt`, Start `python -u bot.py`, Health check path `/health`,
and add the environment variables above plus `PYTHON_VERSION = 3.12.10` and `TZ = Asia/Manila`.)

## 3. Check it's running
- In Render, open the service -> **Logs**. You should see
  `Watching XAUUSD M30 with Session breakout ... website (Supabase) on`.
- Open `https://golden-skibidi-bot.onrender.com/health` (your service's address is shown at the
  top of its page). You should see `{"ok": true, ...}`.

## 4. Keep it awake with a free pinger
1. Go to **cron-job.org** -> sign up (free, no card).
2. **Create cronjob**:
   - **URL:** `https://golden-skibidi-bot.onrender.com/health` (your service's address)
   - **Schedule:** every **10 minutes**
   - Save.
3. After 10-20 minutes, cron-job.org should show successful runs (status 200).

## 5. Turn the bot off on your PC (so only one bot runs)
On your PC, in `trading-bot\scripts`, double-click **`stop_bot.cmd`**, then **`remove_autostart.cmd`**.
Two bots at once would overwrite each other's signals.

Open the website: it should show **Live**, now fed by Render.

---

## Everyday use
| Do | How |
|---|---|
| See what the bot is doing | Render -> service -> **Logs** |
| Is it alive? | Open `/health`, or the website's **Live** status |
| Update the bot | Push to GitHub - Render redeploys and restarts it automatically |
| Change settings (`config.py`) | Edit, commit, push - Render picks it up |
| Pause the bot | Render -> service -> **Settings -> Suspend** (Resume to start again) |
| Go back to your PC | Suspend on Render, then on your PC run `scripts\install_autostart.cmd` and `start_bot_hidden.vbs` |

## If something goes wrong
- **Website says "Bot offline":** check Render's Logs; check cron-job.org is still pinging (a
  sleeping service wakes on the next ping, then restarts in about a minute).
- **Build failed:** the log shows the failing line - usually a missing environment variable or a
  typo in it.
- **"Another bot is already running":** only happens on one machine; on Render it means two
  deploys overlapped - it sorts itself out after the old one stops.
- **News calendar unavailable after restarts:** Forex Factory limits how often it can be fetched;
  the bot retries every 10 minutes and the news pause returns once it answers.
