import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase with the SECRET key, for the website's server only (API routes) - it can write, so it must
 * never reach a browser. "server-only" makes the build fail if a browser component ever imports this.
 * On Vercel it's SUPABASE_SECRET_KEY without a NEXT_PUBLIC_ prefix, so Vercel keeps it on the server.
 */
let client: SupabaseClient | null = null;

export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
