import type { NextRequest } from "next/server";
import { BALANCE_LIMITS, RISK_LIMITS } from "../../lib/limits";
import { currentMember, forgetMember } from "../../lib/members";
import { supabaseServer } from "../../lib/supabaseServer";

export const runtime = "nodejs";

/**
 * POST /api/account - saves the account size used for lot sizes, on your profile so it follows you
 * to every device. JSON { balance, risk_percent } (from the page) or a form (from /profile);
 * `reset` (or nulls) goes back to the default account.
 */
export async function POST(request: NextRequest) {
  const fromForm = !request.headers.get("content-type")?.includes("application/json");
  const done = (ok: boolean) =>
    fromForm
      ? Response.redirect(new URL(`/profile?${ok ? "saved=account" : "error=account"}`, request.url), 303)
      : Response.json(ok ? { ok } : { error: "Couldn't save it." }, { status: ok ? 200 : 400 });

  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  const db = supabaseServer();
  if (!member || !db) return done(false);

  let balance: number | null = null;
  let risk: number | null = null;
  if (fromForm) {
    const form = await request.formData();
    if (form.get("action") !== "reset") {
      balance = Number(form.get("balance"));
      risk = Number(form.get("risk_percent"));
    }
  } else {
    const body = await request.json().catch(() => ({}));
    balance = body.balance ?? null;
    risk = body.risk_percent ?? null;
  }
  const within = (n: number | null, [lo, hi]: readonly [number, number]) => n === null || (Number.isFinite(n) && n >= lo && n <= hi);
  if ((balance === null) !== (risk === null) || !within(balance, BALANCE_LIMITS) || !within(risk, RISK_LIMITS)) {
    return done(false);
  }
  const { error } = await db
    .from("profiles")
    .update({ balance: balance === null ? null : Math.round(balance * 100) / 100, risk_percent: risk })
    .eq("user_id", member.userId);
  forgetMember(member.userId);
  return done(!error);
}
