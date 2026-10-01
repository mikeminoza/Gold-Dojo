import type { NextRequest } from "next/server";
import { currentMember, forgetMember } from "../../../lib/members";
import { supabaseServer } from "../../../lib/supabaseServer";

export const runtime = "nodejs";

const back = (request: Request, note: string) => Response.redirect(new URL(`/admin?note=${note}`, request.url), 303);

/** POST /api/admin/members (form: action=block|unblock, email) - admins only. */
export async function POST(request: NextRequest) {
  const me = await currentMember({ getAll: () => request.cookies.getAll() });
  if (me?.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });
  const db = supabaseServer();
  if (!db) return back(request, "failed");

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return back(request, "email");

  const block = form.get("action") === "block";
  if (block && email === me.email) return back(request, "self");
  const { error } = await db.from("members").update({ blocked: block }).eq("email", email);
  forgetMember(); // everyone is re-checked on their next request
  return back(request, error ? "failed" : block ? "blocked" : "unblocked");
}
