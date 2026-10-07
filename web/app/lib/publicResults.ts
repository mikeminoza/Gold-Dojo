import "server-only";
import { safeLink } from "./links";
import type { DailyTrendState, LiveState, TrendBacktest } from "./types";

/**
 * The public results page's data: read on the server with the secret key (the database only lets
 * members read), then cut down to past results only. Nothing here is a signal: no open trades, no
 * entries, stops or triggers, just closed trades' dates and R, the backtest's totals and the public
 * Telegram channel's link.
 */
export type PublicRule = {
  id: string;
  name: string;
  count: number;
  winRate: number | null;
  totalR: number;
  profitFactor: number | null;
  rs: number[]; // every closed paper trade's R, oldest first
  recent: { closed: number; r: number }[]; // the latest closed trades, newest first
};

export type PublicBacktestRule = {
  id: string;
  name: string;
  count: number;
  winRate: number | null;
  profitFactor: number | null;
  totalR: number | null;
  worstDropR: number | null;
  avgNights: number | null;
};

export type PublicStrategy = {
  name: string;
  started: number | null;
  rules: PublicRule[];
  backtest: {
    from: number;
    to: number;
    source: string;
    rules: PublicBacktestRule[];
    hold: { returnPct: number; worstDropPct: number } | null;
  } | null;
};

export type PublicResults = {
  updated: number | null;
  tz: string;
  telegram: string | null; // the bot's public Telegram channel (plain https links only)
  strategies: PublicStrategy[];
};

export const REVALIDATE_S = 300;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function paper(trend: DailyTrendState | null | undefined): Pick<PublicStrategy, "started" | "rules"> {
  if (!trend) return { started: null, rules: [] };
  return {
    started: num(trend.started),
    rules: trend.rules.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      count: num(x.count) ?? 0,
      winRate: num(x.win_rate),
      totalR: num(x.total_r) ?? 0,
      profitFactor: num(x.profit_factor),
      rs: (x.rs ?? []).map(num).filter((v): v is number => v !== null),
      recent: (x.trades ?? [])
        .map((t) => ({ closed: num(t.closed), r: num(t.r) }))
        .filter((t): t is { closed: number; r: number } => t.closed !== null && t.r !== null)
        .sort((a, b) => b.closed - a.closed),
    })),
  };
}

function backtest(b: TrendBacktest | null | undefined): PublicStrategy["backtest"] {
  if (!b?.rules) return null;
  return {
    from: num(b.from) ?? 0,
    to: num(b.to) ?? 0,
    source: String(b.source ?? ""),
    rules: Object.entries(b.rules).map(([id, x]) => ({
      id,
      name: String(x.name),
      count: num(x.stats?.count) ?? 0,
      winRate: num(x.stats?.win_rate),
      profitFactor: num(x.stats?.profit_factor),
      totalR: num(x.stats?.total_r),
      worstDropR: num(x.stats?.worst_drop_r),
      avgNights: num(x.stats?.avg_nights),
    })),
    hold: b.hold ? { returnPct: num(b.hold.return_pct) ?? 0, worstDropPct: num(b.hold.worst_drop_pct) ?? 0 } : null,
  };
}

/** Reads the three rows (cached for REVALIDATE_S) and keeps only the allowed fields; null if it can't. */
export async function loadPublicResults(): Promise<PublicResults | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[^/]+/.test(url)) return null;
  const headers: Record<string, string> = { apikey: key };
  // Old-style keys are JWTs and also go in Authorization; new sb_secret_ keys must not
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${url}/rest/v1/bot_state?id=in.(live,daily_trend_backtest,h4_trend_backtest)&select=id,data`, {
      headers,
      next: { revalidate: REVALIDATE_S },
    });
    if (!res.ok) return null;
    const rows: { id: string; data: unknown }[] = await res.json();
    const row = (id: string) => rows.find((r) => r.id === id)?.data ?? null;
    const live = row("live") as LiveState | null;
    return {
      updated: num(live?.updated),
      tz: typeof live?.display?.tz === "string" ? live.display.tz : "UTC",
      telegram: safeLink(live?.telegram_url),
      strategies: [
        { name: "Daily trend", ...paper(live?.daily_trend), backtest: backtest(row("daily_trend_backtest") as TrendBacktest | null) },
        { name: "4-hour trend", ...paper(live?.h4_trend), backtest: backtest(row("h4_trend_backtest") as TrendBacktest | null) },
      ],
    };
  } catch {
    return null;
  }
}
