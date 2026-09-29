import type { NextRequest } from "next/server";
import { SESSION_COOKIE, signedInName } from "../../lib/auth";

export const runtime = "nodejs";

/** GET /api/me -> { name } of the signed-in person (the session cookie itself isn't readable by scripts) */
export async function GET(request: NextRequest) {
  const name = await signedInName(request.cookies.get(SESSION_COOKIE)?.value);
  if (!name) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ name }, { headers: { "Cache-Control": "private, no-store" } });
}
