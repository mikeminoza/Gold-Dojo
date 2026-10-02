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

/** GET /api/my-trades -> { trades: [{ trade_id, lots }] } */
export async function GET(request: NextRequest) {
  const { member, db } = await setup(request);
  if (!member || !db) return fail("Sign in first.", 401);
  const { data, error } = await db.from("taken_trades").select("trade_id, lots").eq("user_id", member.userId);
  if (error) return fail(error.code === "PGRST205" ? "not_set_up" : "Couldn't load your trades.", 503);
  return Response.json({ trades: data }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST /api/my-trades { tradeId, lots } - mark a signal as taken (or change its size). */
export async function POST(request: NextRequest) {
  const { member, db } = await setup(request);
  if (!member || !db) return fail("Sign in first.", 401);
  const body = await request.json().catch(() => ({}));
  const tradeId = typeof body.tradeId === "string" ? body.tradeId.slice(0, 100) : "";
  const lots = Number(body.lots);
  if (!tradeId || !(lots > 0 && lots <= 100)) return fail("Which trade, and what size?");
  const { error } = await db
    .from("taken_trades")
    .upsert({ user_id: member.userId, trade_id: tradeId, lots: Math.round(lots * 100) / 100 });
  return error ? fail("Couldn't save it.", 500) : Response.json({ ok: true });
}

/** DELETE /api/my-trades?tradeId=... - unmark it. */
export async function DELETE(request: NextRequest) {
  const { member, db } = await setup(request);
  if (!member || !db) return fail("Sign in first.", 401);
  const tradeId = request.nextUrl.searchParams.get("tradeId") ?? "";
  const { error } = await db.from("taken_trades").delete().eq("user_id", member.userId).eq("trade_id", tradeId);
  return error ? fail("Couldn't save it.", 500) : Response.json({ ok: true });
}
