import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Public values: the browser reads as the signed-in member (their session cookies), and the database
// only lets members read (see supabase/members.sql). The secret key never goes here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

/** The shared Supabase client, or null when the site's Supabase settings are missing or not valid. */
export function supabase() {
  // A key pasted into the URL field is an easy mistake; treat it as "not set" rather than crash
  if (!url || !key || !/^https:\/\/[^/]+/.test(url)) return null;
  client ??= createBrowserClient(url, key);
  return client;
}
