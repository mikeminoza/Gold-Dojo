import type { NextRequest } from "next/server";
import { currentMember } from "../../../lib/members";
import { supabaseServer } from "../../../lib/supabaseServer";

export const runtime = "nodejs";

const BODY_MAX = 1000;

/** POST /api/chat/messages { roomId, body } - sends a message as the signed-in name. */
export async function POST(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  const author = member?.name;
  if (!member || !author) return Response.json({ error: "Sign in first." }, { status: 401 });
  const db = supabaseServer();
  if (!db) return Response.json({ error: "Chat isn't set up: SUPABASE_SECRET_KEY is missing." }, { status: 503 });

  const input = await request.json().catch(() => ({}));
  const roomId = typeof input.roomId === "string" ? input.roomId : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!roomId) return Response.json({ error: "Pick a chat first." }, { status: 400 });
  if (!body) return Response.json({ error: "Type a message first." }, { status: 400 });
  if (body.length > BODY_MAX) {
    return Response.json({ error: `Messages can be up to ${BODY_MAX} characters.` }, { status: 400 });
  }

  const insert = (row: Record<string, unknown>) =>
    db.from("chat_messages").insert(row).select("*").single();
  let { data, error } = await insert({ room_id: roomId, author, body, user_id: member.userId });
  // Before supabase/profile-chat.sql is run there's no user_id column: send without it
  if (error?.code === "PGRST204") ({ data, error } = await insert({ room_id: roomId, author, body }));
  if (error) {
    const missingRoom = error.code === "23503";
    return Response.json(
      { error: missingRoom ? "That chat no longer exists." : "Couldn't send the message. Try again." },
      { status: missingRoom ? 404 : 500 },
    );
  }
  return Response.json({ message: data });
}

/** DELETE /api/chat/messages?id=123 - your own message, or any message if you're an admin. */
export async function DELETE(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member?.name) return Response.json({ error: "Sign in first." }, { status: 401 });
  const db = supabaseServer();
  if (!db) return Response.json({ error: "Chat isn't set up: SUPABASE_SECRET_KEY is missing." }, { status: 503 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Which message?" }, { status: 400 });
  const { data: row } = await db.from("chat_messages").select("user_id").eq("id", id).maybeSingle();
  if (!row) return Response.json({ ok: true }); // already gone
  if (member.role !== "admin" && row.user_id !== member.userId) {
    return Response.json({ error: "You can only delete your own messages." }, { status: 403 });
  }
  const { error } = await db.from("chat_messages").delete().eq("id", id);
  if (error) return Response.json({ error: "Couldn't delete it. Try again." }, { status: 500 });
  return Response.json({ ok: true });
}
