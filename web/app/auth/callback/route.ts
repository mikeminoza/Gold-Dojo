import type { NextRequest } from "next/server";
import { authRoute } from "../../lib/authRoute";
import { forgetMember, memberFor } from "../../lib/members";

/**
 * GET /auth/callback - where Google sign-in, "confirm your email" links and "reset password" links
 * come back to. `next=/reset` (reset links) goes on to choosing a new password.
 */
export async function GET(request: NextRequest) {
  const { supabase, redirect } = authRoute(request);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirect("/login?error=google");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return redirect("/login?error=link");

  forgetMember(data.user.id); // fresh answer, e.g. just added by the admin
  const member = await memberFor(data.user).catch(() => undefined);
  if (member === undefined) return redirect("/login?error=unavailable");
  if (!member) {
    await supabase.auth.signOut();
    return redirect("/login?error=blocked");
  }
  if (request.nextUrl.searchParams.get("next") === "/reset") return redirect("/reset");
  return redirect(member.name ? "/" : "/welcome");
}
