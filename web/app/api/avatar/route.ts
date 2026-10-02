import type { NextRequest } from "next/server";
import { currentMember, forgetMember } from "../../lib/members";
import { supabaseServer } from "../../lib/supabaseServer";

export const runtime = "nodejs";

const BUCKET = "avatars";
const MAX_BYTES = 512 * 1024; // the page sends a 256 px square, usually 10-40 KB
const TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** POST /api/avatar (body: the image) - sets your profile picture. */
export async function POST(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  const db = supabaseServer();
  if (!member || !db) return fail("Sign in first.", 401);
  const type = request.headers.get("content-type") ?? "";
  const ext = TYPES[type];
  if (!ext) return fail("Use a JPG, PNG or WebP picture.");
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return fail("That picture is too big.");

  const path = `${member.userId}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, body, { contentType: type, upsert: true });
  if (error) {
    const missing = /bucket not found/i.test(error.message);
    return fail(missing ? "Profile pictures aren't set up yet (run supabase/avatars.sql)." : "Couldn't upload it. Try again.", 500);
  }
  // A new address each time, so browsers don't keep showing the old picture
  const url = `${db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  const { error: e } = await db.from("profiles").update({ avatar_url: url }).eq("user_id", member.userId);
  if (e) return fail("Couldn't save it. Try again.", 500);
  forgetMember(member.userId);
  return Response.json({ url });
}

/** DELETE /api/avatar - back to your Google photo (or initials). */
export async function DELETE(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  const db = supabaseServer();
  if (!member || !db) return fail("Sign in first.", 401);
  await db.storage.from(BUCKET).remove(Object.values(TYPES).map((ext) => `${member.userId}.${ext}`));
  const { error } = await db.from("profiles").update({ avatar_url: null }).eq("user_id", member.userId);
  if (error) return fail("Couldn't remove it. Try again.", 500);
  forgetMember(member.userId);
  return Response.json({ ok: true });
}
