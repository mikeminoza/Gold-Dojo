import type { NextRequest } from "next/server";
import { cleanName } from "../../lib/auth";
import { currentMember, forgetMember } from "../../lib/members";
import { supabaseServer } from "../../lib/supabaseServer";

export const runtime = "nodejs";

const back = (request: Request, path: string) => Response.redirect(new URL(path, request.url), 303);

/** POST /api/profile (form field "name"): saves the signed-in member's display name. */
export async function POST(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member) return back(request, "/login");
  const db = supabaseServer();
  if (!db) return back(request, "/welcome?error=failed");

  const form = await request.formData();
  const page = form.get("from") === "profile" ? "/profile" : "/welcome";
  const name = cleanName(String(form.get("name") ?? ""));
  if (!name) return back(request, `${page}?error=name`);

  const { error } = await db
    .from("profiles")
    .upsert({ user_id: member.userId, email: member.email, name }, { onConflict: "user_id" });
  if (error) return back(request, `${page}?error=${error.code === "23505" ? "taken" : "failed"}`);
  forgetMember(member.userId);
  return back(request, page === "/profile" ? "/profile?saved=name" : "/");
}
