import type { NextRequest } from "next/server";
import { PASSWORD_MIN } from "../../lib/auth";
import { authRoute } from "../../lib/authRoute";

export const runtime = "nodejs";

/**
 * POST /auth/password - the email + password forms on /login and /reset (plain HTML forms):
 * action=signin | register | forgot | update.
 */
export async function POST(request: NextRequest) {
  const { supabase, redirect } = authRoute(request);
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const callback = (next?: string) =>
    new URL(`/auth/callback${next ? `?next=${next}` : ""}`, request.url).toString();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

  if (action === "update") {
    if (password.length < PASSWORD_MIN) return redirect("/reset?error=short");
    if (password !== String(form.get("confirm") ?? "")) return redirect("/reset?error=match");
    const { error } = await supabase.auth.updateUser({ password });
    return redirect(error ? "/reset?error=failed" : "/?password=changed");
  }

  if (action === "forgot") {
    if (!validEmail) return redirect("/login?mode=forgot&error=email");
    // Same answer whether or not the account exists, so the form can't be used to look people up
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback("/reset") });
    return redirect("/login?note=reset_sent");
  }

  if (action === "register") {
    if (!validEmail) return redirect("/login?mode=register&error=email");
    if (password.length < PASSWORD_MIN) return redirect("/login?mode=register&error=short");
    if (password !== String(form.get("confirm") ?? "")) return redirect("/login?mode=register&error=match");
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callback() } });
    if (error) return redirect(`/login?mode=register&error=${error.status === 429 ? "busy" : "register"}`);
    // Signed in straight away when email confirmation is off. An email that already has an account
    // (e.g. through Google) comes back with no identities and gets no email.
    if (data.session) return redirect("/welcome");
    return redirect(data.user?.identities?.length === 0 ? "/login?note=exists" : "/login?note=confirm_sent");
  }

  if (!validEmail || !password) return redirect("/login?error=signin");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const unconfirmed = error.code === "email_not_confirmed";
    await new Promise((r) => setTimeout(r, 600)); // slow down password guessing
    return redirect(`/login?error=${unconfirmed ? "unconfirmed" : error.status === 429 ? "busy" : "signin"}`);
  }
  return redirect("/");
}
