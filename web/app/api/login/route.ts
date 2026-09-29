import { NAME_MAX, SESSION_COOKIE, SESSION_DAYS, cleanName, sameValue, sessionValue } from "../../lib/auth";

export const runtime = "nodejs";

async function hash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function back(request: Request, error: string, name: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  if (name) url.searchParams.set("name", name.slice(0, NAME_MAX));
  return Response.redirect(url, 303);
}

/** POST /api/login (form fields "name" and "password"): signs the browser in for 30 days. */
export async function POST(request: Request) {
  const password = process.env.SITE_PASSWORD ?? "";
  const form = await request.formData();
  const rawName = String(form.get("name") ?? "");
  const given = String(form.get("password") ?? "");

  const name = cleanName(rawName);
  if (!name) return back(request, "name", rawName.trim());

  if (password === "" || !sameValue(await hash(given), await hash(password))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
    return back(request, "password", name);
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Set-Cookie": `${SESSION_COOKIE}=${await sessionValue(password, name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
        SESSION_DAYS * 86400
      }${secure}`,
    },
  });
}
