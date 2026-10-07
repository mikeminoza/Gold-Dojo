import type { NextRequest } from "next/server";
import { currentMember } from "../../lib/members";
import { supabaseServer } from "../../lib/supabaseServer";

export const runtime = "nodejs";

/** The signals you marked "I took this trade", for the signed-in person only. */
async function setup(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  return { member, db: supabaseServer() };
}
const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** GET /api/my-trades -> { trades: [{ trade_id, lots, broker_price }], fills: boolean } */
export async function GET(request: NextRequest) {
  const { member, db } = await setup(request);
  if (!member || !db) return fail("Sign in first.", 401);
  const read = (columns: string) => db.from("taken_trades").select(columns).eq("user_id", member.userId);
  let fills = true;
  let { data, error } = await read("trade_id, lots, broker_price");
  // Before supabase/push.sql is run there's no broker_price column: read without it
  if (error?.code === "42703") {
    fills = false;
    ({ data, error } = await read("trade_id, lots"));
  }
  if (error) return fail(error.code === "PGRST205" ? "not_set_up" : "Couldn't load your trades.", 503);
  return Response.json({ trades: data, fills }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * POST /api/my-trades { tradeId, lots, brokerPrice? } - mark a signal as taken (or change its size).
 * brokerPrice is what your broker filled you at (a number, or null to clear it); left out, it's kept as is.
 */
export async function POST(request: NextRequest) {
  const { member, db } = await setup(request);
  if (!member || !db) return fail("Sign in first.", 401);
  const body = await request.json().catch(() => ({}));
  const tradeId = typeof body.tradeId === "string" ? body.tradeId.slice(0, 100) : "";
  const lots = Number(body.lots);
  if (!tradeId || !(lots > 0 && lots <= 100)) return fail("Which trade, and what size?");
  const row: Record<string, unknown> = { user_id: member.userId, trade_id: tradeId, lots: Math.round(lots * 100) / 100 };
  const withFill = body.brokerPrice !== undefined;
  if (withFill) {
    const price = body.brokerPrice === null ? null : Number(body.brokerPrice);
    if (price !== null && !(Number.isFinite(price) && price > 0 && price < 100000)) return fail("Enter a price like 2650.40.");
    row.broker_price = price;
  }
  let { error } = await db.from("taken_trades").upsert(row);
  // Before supabase/push.sql is run there's no broker_price column: save the rest without it
  let fills = true;
  if (withFill && error?.code === "PGRST204") {
    fills = false;
    delete row.broker_price;
    ({ error } = await db.from("taken_trades").upsert(row));
  }
  return error ? fail("Couldn't save it.", 500) : Response.json({ ok: true, fills });
}

/** DELETE /api/my-trades?tradeId=... - unmark it. */
export async function DELETE(request: NextRequest) {
  const { member, db } = await setup(request);
  if (!member || !db) return fail("Sign in first.", 401);
  const tradeId = request.nextUrl.searchParams.get("tradeId") ?? "";
  const { error } = await db.from("taken_trades").delete().eq("user_id", member.userId).eq("trade_id", tradeId);
  return error ? fail("Couldn't save it.", 500) : Response.json({ ok: true });
}
