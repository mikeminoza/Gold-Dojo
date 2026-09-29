import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sameValue, sessionToken } from "./app/lib/auth";

/**
 * Password-protects the whole site: pages, API routes and the page's script files (which contain the
 * public Supabase settings). Only the login screen and the styling it needs are open.
 */
export async function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    // Never go public without a password
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("This site needs a SITE_PASSWORD environment variable before it can be used.", {
        status: 503,
      });
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const open =
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/favicon.ico" ||
    // styling for the login screen: stylesheets and fonts hold no secrets (the scripts stay locked)
    (pathname.startsWith("/_next/static/") && pathname.endsWith(".css")) ||
    pathname.startsWith("/_next/static/media/");
  if (open) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (sameValue(cookie, await sessionToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  return NextResponse.redirect(login);
}
