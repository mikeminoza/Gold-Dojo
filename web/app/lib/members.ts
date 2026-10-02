import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "./supabaseServer";

/**
 * Accounts through Supabase Auth: Google, or email + password. Anyone can register.
 *
 * The browser holds Supabase's session cookies (refreshed by proxy.ts). Everyone who signs in gets a
 * row in `members` (role, blocked); each person's display name is in `profiles`. Both are read here
 * with the secret key, and never by the browser.
 */
export type Member = {
  userId: string;
  email: string;
  role: "admin" | "member";
  name: string | null;
  account: { balance: number; risk_percent: number } | null; // saved on the profile page
};

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const authConfigured = Boolean(supabaseUrl && supabaseKey && /^https:\/\/[^/]+/.test(supabaseUrl));

type CookieJar = {
  getAll: () => { name: string; value: string }[];
  setAll?: (cookies: { name: string; value: string; options: object }[], headers: Record<string, string>) => void;
};

/** A Supabase client acting as the signed-in person, reading (and refreshing) their session cookies. */
export function sessionClient(jar: CookieJar) {
  return createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll ?? (() => {}) },
  });
}

// Members are looked up on every request; remember answers briefly so pages stay fast. Removing
// someone takes effect within this time.
const CACHE_MS = 30_000;
const cache = new Map<string, { member: Member | null; at: number }>();

export function forgetMember(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/** The member record for a signed-in Supabase user (created on first sign-in), or null if blocked. */
export async function memberFor(user: User): Promise<Member | null> {
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.member;
  const db = supabaseServer();
  const email = user.email?.toLowerCase();
  if (!db || !email) return null;
  if (!user.email_confirmed_at) return null; // email + password accounts must confirm their email first
  const [{ data: found, error }, { data: p }] = await Promise.all([
    db.from("members").select("role, blocked").eq("email", email).maybeSingle(),
    db.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) throw new Error(`members lookup failed: ${error.message}`); // don't cache a failure
  let m = found;
  if (!m) {
    // First sign-in: everyone may join
    const { error: e } = await db.from("members").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
    if (e) throw new Error(`couldn't add member: ${e.message}`);
    m = { role: "member", blocked: false };
  }
  const account = p?.balance && p?.risk_percent ? { balance: p.balance, risk_percent: p.risk_percent } : null;
  const member = m.blocked
    ? null
    : { userId: user.id, email, role: m.role as Member["role"], name: p?.name ?? null, account };
  cache.set(user.id, { member, at: Date.now() });
  return member;
}

/** The signed-in member for an API route or page, or null. */
export async function currentMember(jar: CookieJar) {
  if (!authConfigured) return null;
  const {
    data: { user },
  } = await sessionClient(jar).auth.getUser();
  return user ? memberFor(user) : null;
}
