import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { sessionClient } from "./members";

/**
 * For the /auth/* route handlers: a Supabase session client whose cookie changes land on the
 * redirect it returns.
 */
export function authRoute(request: NextRequest) {
  const pending: { name: string; value: string; options: object }[] = [];
  const supabase = sessionClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookies) => pending.push(...cookies),
  });
  const redirect = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url), 303);
    pending.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
  return { supabase, redirect };
}
