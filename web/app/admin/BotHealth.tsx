import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyTrendState, LiveState } from "../lib/types";
import RefreshHealth from "./RefreshHealth";

// Same as the dashboard: a bot that missed one update is late, after a restart's worth of time it's offline
const LATE_AFTER_S = 60;
const OFFLINE_AFTER_S = 180;

type Health = { state: LiveState; age: number; status: "live" | "late" | "off" };

/** The bot's live row and how old it is (read with the server's key, for the admin page only). */
export async function loadHealth(db: SupabaseClient | null): Promise<Health | null> {
  if (!db) return null;
  const { data } = await db.from("bot_state").select("data").eq("id", "live").maybeSingle();
  const state = (data?.data ?? null) as LiveState | null;
  if (!state) return null;
  const age = Math.max(0, Date.now() / 1000 - state.updated);
  return { state, age, status: age > OFFLINE_AFTER_S ? "off" : age > LATE_AFTER_S ? "late" : "live" };
}

function ago(seconds: number) {
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

const openTrades = (t: DailyTrendState | null | undefined) =>
  t ? `${t.rules.filter((x) => x.position).length} of ${t.rules.length} rules` : "not running";

const STATUS = { live: "Live", late: "Late", off: "Offline" } as const;

/** Admins only: is the bot running, and is anything going wrong? */
export default function BotHealth({ health }: { health: Health | null }) {
  if (!health) {
    return (
      <div className="login-card admin-card health-card">
        <div className="health-head">
          <h2>Bot health</h2>
          <RefreshHealth />
        </div>
        <p>The bot hasn&apos;t sent anything yet, or its row can&apos;t be read.</p>
      </div>
    );
  }
  const { state, age, status } = health;
  const h = state.bot_health;
  const tz = state.display?.tz ?? "UTC";
  const when = (t: number) =>
    new Date(t * 1000).toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const drift = Object.entries(state.drift ?? {});

  return (
    <div className="login-card admin-card health-card">
      <div className="health-head">
        <h2>Bot health</h2>
        <span className="health-status" data-status={status}>
          <i aria-hidden /> {STATUS[status]}
        </span>
        <RefreshHealth />
      </div>
      <dl className="health-list">
        <div>
          <dt>Last update</dt>
          <dd>
            {when(state.updated)} ({ago(age)})
          </dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{h?.version ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Up since</dt>
          <dd>
            {h?.started ? when(h.started) : "unknown"}
            {h && ` · ${h.restarts_24h} ${h.restarts_24h === 1 ? "restart" : "restarts"} in 24 h`}
          </dd>
        </div>
        <div>
          <dt>Loop errors</dt>
          <dd data-tone={h?.errors ? "loss" : undefined}>
            {h ? `${h.errors} since the last daily report` : "unknown"}
            {h?.last_error && <span className="health-error">{h.last_error}</span>}
          </dd>
        </div>
        <div>
          <dt>Price source</dt>
          <dd>
            {h?.source ?? "unknown"}
            {state.real_candles != null && ` · ${Math.round(state.real_candles)}% real XAUUSD prices`}
          </dd>
        </div>
        <div>
          <dt>Telegram</dt>
          <dd>{h ? (h.telegram ? "On" : "Off") : "unknown"}</dd>
        </div>
        <div>
          <dt>Open paper trades</dt>
          <dd>
            Daily trend: {openTrades(state.daily_trend)} · 4-hour trend: {openTrades(state.h4_trend)}
          </dd>
        </div>
        <div>
          <dt>Drift alarms</dt>
          <dd>
            {drift.length === 0
              ? `None yet (needs ${state.drift_min_trades ?? 20} trades per rule)`
              : drift.map(([id, d]) => (
                  <span key={id} className="health-drift" data-tone={d.alarm ? "loss" : "profit"}>
                    {id}: {d.alarm ? "ALARM" : "ok"} (percentile {Math.round(d.percentile)})
                  </span>
                ))}
          </dd>
        </div>
        <div>
          <dt>Last weekly summary</dt>
          <dd>{h?.weekly_sent ?? "none yet"}</dd>
        </div>
      </dl>
    </div>
  );
}
