import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, memberFor, sessionClient } from "./app/lib/members";

/**
 * Accounts-only site: every page, API route and script file needs a signed-in account that isn't
 * blocked. Only the sign-in screen, the public results page, the sign-in steps under /auth/, the styling, the app
 * manifest and the push service worker are open.
 * Also refreshes the Supabase session cookies on the way through.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const open =
    pathname === "/login" ||
    pathname === "/results" || // the public paper-test record: past results only, no live signal
    pathname.startsWith("/auth/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon-dark.svg" ||
    pathname === "/icon-light.svg" ||
    // installing to the home screen and push notifications: the app manifest and the (notifications-only) service worker
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    // styling for the sign-in screen: stylesheets and fonts hold no secrets (the scripts stay locked)
    (pathname.startsWith("/_next/static/") && pathname.endsWith(".css")) ||
    pathname.startsWith("/_next/static/media/");

  if (!authConfigured) {
    if (open || process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Sign-in isn't set up: add the Supabase environment variables.", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = sessionClient({
    getAll: () => request.cookies.getAll(),
    setAll(cookies, headers) {
      cookies.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (open) return response;

  const api = pathname.startsWith("/api/") || pathname.startsWith("/_next/");
  // Redirects and refusals keep any refreshed session cookies
  const send = (r: NextResponse) => {
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  const go = (path: string) => send(NextResponse.redirect(new URL(path, request.url)));
  const refuse = (status: number, error: string) => send(NextResponse.json({ error }, { status }));

  if (!user) return api ? refuse(401, "Sign in first.") : go("/login");
  const member = await memberFor(user).catch(() => undefined);
  if (member === undefined) return refuse(503, "Can't check the members list right now. Try again.");
  if (!member) return api ? refuse(403, "This account is blocked.") : go("/auth/signout?error=blocked");

  // First visit: choose a display name before anything else
  const naming = pathname === "/welcome" || pathname === "/api/profile" || pathname === "/reset";
  if (!member.name && !naming) return api ? refuse(403, "Choose a display name first.") : go("/welcome");

  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && member.role !== "admin") {
    return api ? refuse(403, "Admins only.") : go("/");
  }
  return response;
}

export const config = {
  matcher: "/((?!_next/image).*)",
};
