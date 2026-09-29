import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// The Python bot writes chart.json (candles for every timeframe) next to bot.py.
const CHART_FILE = process.env.CHART_FILE ?? path.join(process.cwd(), "..", "chart.json");

/** Candles for one timeframe: GET /api/chart?tf=H1 */
export async function GET(request: Request) {
  const tf = new URL(request.url).searchParams.get("tf") ?? "M15";
  try {
    const data = JSON.parse(await readFile(CHART_FILE, "utf8"));
    const candles = data.timeframes?.[tf];
    if (!candles) {
      return Response.json({ error: `No ${tf} candles. The bot sends: ${Object.keys(data.timeframes ?? {})}` },
        { status: 404 });
    }
    return Response.json({ tf, updated: data.updated, candles }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    // A half-written file can't parse; the next request will get the complete one
    return Response.json({ error: missing ? "The bot hasn't written chart data yet." : "Chart data is updating." },
      { status: 503 });
  }
}
