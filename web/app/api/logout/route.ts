import { SESSION_COOKIE } from "../../lib/auth";

export const runtime = "nodejs";

/** POST /api/logout: signs this browser out. */
export async function POST(request: Request) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/login", request.url).toString(),
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}
