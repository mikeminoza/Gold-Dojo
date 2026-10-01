import type { NextRequest } from "next/server";
import { authRoute } from "../../lib/authRoute";

/** GET /auth/google - starts "Continue with Google" and comes back to /auth/callback. */
export async function GET(request: NextRequest) {
  const { supabase, redirect } = authRoute(request);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/auth/callback", request.url).toString(),
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" }, // let people pick which Google account
    },
  });
  if (error || !data.url) return redirect("/login?error=google");
  const go = redirect("/login"); // carries the sign-in cookies; point it at Google instead
  go.headers.set("Location", data.url);
  return go;
}
