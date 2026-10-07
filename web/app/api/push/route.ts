import type { NextRequest } from "next/server";
import { currentMember } from "../../lib/members";
import { supabaseServer } from "../../lib/supabaseServer";

export const runtime = "nodejs";

/** Phone / desktop notifications: each browser's push subscription, saved for the bot to send alerts to. */
const STRATEGIES = ["trend", "h4"] as const;
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const notSetUp = (code?: string) => code === "PGRST205" || code === "42P01";

function httpsUrl(v: unknown) {
  if (typeof v !== "string" || !v || v.length > 1000) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}
const key = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null);

/** POST /api/push { endpoint, keys: { p256dh, auth }, strategies } - save (or update) this browser's subscription. */
export async function POST(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member) return fail("Sign in first.", 401);
  const db = supabaseServer();
  if (!db) return fail("Push isn't set up yet.", 503);

  const body = await request.json().catch(() => ({}));
  const endpoint = httpsUrl(body?.endpoint);
  const p256dh = key(body?.keys?.p256dh);
  const auth = key(body?.keys?.auth);
  const strategies: unknown = body?.strategies;
  if (!endpoint || !p256dh || !auth) return fail("That subscription doesn't look right.");
  if (
    !Array.isArray(strategies) ||
    strategies.length > STRATEGIES.length ||
    !strategies.every((s) => (STRATEGIES as readonly unknown[]).includes(s))
  ) {
    return fail("Pick Daily trend, 4-hour trend or both.");
  }

  const { error } = await db
    .from("push_subscriptions")
    .upsert(
      { user_id: member.userId, endpoint, p256dh, auth, strategies: [...new Set(strategies as string[])] },
      { onConflict: "endpoint" },
    );
  if (error) return notSetUp(error.code) ? fail("Push isn't set up yet.", 503) : fail("Couldn't save it. Try again.", 500);
  return Response.json({ ok: true });
}

/** DELETE /api/push?endpoint=... - stop sending to this browser (only your own subscriptions). */
export async function DELETE(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member) return fail("Sign in first.", 401);
  const db = supabaseServer();
  if (!db) return fail("Push isn't set up yet.", 503);
  const endpoint = httpsUrl(request.nextUrl.searchParams.get("endpoint"));
  if (!endpoint) return fail("Which subscription?");
  const { error } = await db.from("push_subscriptions").delete().eq("user_id", member.userId).eq("endpoint", endpoint);
  if (error && !notSetUp(error.code)) return fail("Couldn't turn it off. Try again.", 500);
  return Response.json({ ok: true });
}
