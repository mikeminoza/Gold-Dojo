import { SESSION_COOKIE, SESSION_DAYS, sameValue, sessionToken } from "../../lib/auth";

export const runtime = "nodejs";

/** POST /api/login (form field "password"): signs the browser in for 30 days. */
export async function POST(request: Request) {
  const password = process.env.SITE_PASSWORD ?? "";
  const form = await request.formData();
  const given = String(form.get("password") ?? "");
  const ok = password !== "" && sameValue(await sessionToken(given), await sessionToken(password));

  if (!ok) {
    await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
    return Response.redirect(new URL("/login?error=1", request.url), 303);
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Set-Cookie": `${SESSION_COOKIE}=${await sessionToken(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
        SESSION_DAYS * 86400
      }${secure}`,
    },
  });
}
