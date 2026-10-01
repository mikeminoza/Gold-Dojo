import type { NextRequest } from "next/server";
import { authRoute } from "../../lib/authRoute";

/** Signs this browser out. GET is used by the site itself (e.g. blocked), POST by the button. */
async function signOut(request: NextRequest) {
  const { supabase, redirect } = authRoute(request);
  await supabase.auth.signOut();
  const error = request.nextUrl.searchParams.get("error");
  return redirect(error === "blocked" ? "/login?error=blocked" : "/login");
}

export const GET = signOut;
export const POST = signOut;
