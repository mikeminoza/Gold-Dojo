/**
 * Market data straight from the browser, so the chart works even when the bot's PC is off.
 *
 * Candles come from Binance's public data for PAXG/USDT (PAX Gold, backed 1:1 by physical gold),
 * shifted by the measured PAXG-vs-spot gap so they line up with XAUUSD. Candles from when real gold
 * is closed (weekends and the daily 5-6 PM New York break) are dropped, same as the bot does.
 */
import type { Candle } from "./types";

export const BINANCE = "https://data-api.binance.vision";
export const PAXG = "PAXGUSDT";

const INTERVALS: Record<string, string> = {
  M1: "1m", M5: "5m", M15: "15m", M30: "30m", H1: "1h", H4: "4h", D1: "1d",
};
export const TF_SECONDS: Record<string, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400,
};

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

/** Is real gold trading at this moment? (Sun 6 PM - Fri 5 PM New York, minus the daily 5-6 PM break) */
export function goldMarketOpen(utcSeconds: number) {
  const parts = nyParts.formatToParts(new Date(utcSeconds * 1000));
  const day = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (day === "Sat") return false;
  if (day === "Sun") return hour >= 18;
  if (day === "Fri" && hour >= 17) return false;
  return hour !== 17;
}

function keep(candle: Candle, tf: string) {
  if (tf === "D1") {
    const day = new Date(candle.t * 1000).getUTCDay();
    return day >= 1 && day <= 5;
  }
  return TF_SECONDS[tf] > 3600 || goldMarketOpen(candle.t);
}

/**
 * Newest `count` candles for a timeframe (or the `count` before the `before` time, UTC seconds),
 * closed-market candles removed, shifted down by `gap`. Returns [] when there's no older history.
 */
export async function fetchCandles(tf: string, count: number, gap: number, before?: number): Promise<Candle[]> {
  const interval = INTERVALS[tf];
  if (!interval) throw new Error(`Unknown timeframe ${tf}`);
  let out: Candle[] = [];
  let endTime: number | undefined = before ? before * 1000 - 1 : undefined;
  // A whole weekend can fall inside the window, so page further back until there are enough
  for (let page = 0; page < 4 && out.length < count; page++) {
    const params = new URLSearchParams({ symbol: PAXG, interval, limit: "1000" });
    if (endTime) params.set("endTime", String(endTime));
    const res = await fetch(`${BINANCE}/api/v3/klines?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Binance answered ${res.status}`);
    const rows: (string | number)[][] = await res.json();
    if (rows.length === 0) break;
    const batch = rows
      .map((k) => ({
        t: Number(k[0]) / 1000,
        o: Number(k[1]) - gap,
        h: Number(k[2]) - gap,
        l: Number(k[3]) - gap,
        c: Number(k[4]) - gap,
        v: Number(k[8]), // number of trades, the closest thing to MetaTrader's tick volume
      }))
      .filter((c) => keep(c, tf));
    out = [...batch, ...out];
    endTime = Number(rows[0][0]) - 1;
    if (rows.length < 1000) break;
  }
  return out.slice(-count).map((c) => ({
    ...c,
    o: round2(c.o),
    h: round2(c.h),
    l: round2(c.l),
    c: round2(c.c),
  }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
