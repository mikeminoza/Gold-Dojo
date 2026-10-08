import type { NextRequest } from "next/server";
import { currentMember } from "../../../lib/members";
import { supabaseServer } from "../../../lib/supabaseServer";

export const runtime = "nodejs";

const NAME_MAX = 40;
// Chats the site relies on: General for everyone, Bot status for the bot's reports and alarms
const KEEP = ["General", "Bot status"];

/** POST /api/chat/rooms { name } - adds a new chat (admins only). */
export async function POST(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  const createdBy = member?.name;
  if (!member || !createdBy) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (member.role !== "admin") return Response.json({ error: "Only admins can add chats." }, { status: 403 });
  const db = supabaseServer();
  if (!db) return Response.json({ error: "Chat isn't set up: SUPABASE_SECRET_KEY is missing." }, { status: 503 });

  const input = await request.json().catch(() => ({}));
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return Response.json({ error: "Give the chat a name." }, { status: 400 });
  if (name.length > NAME_MAX) {
    return Response.json({ error: `Chat names can be up to ${NAME_MAX} characters.` }, { status: 400 });
  }

  const { data, error } = await db
    .from("chat_rooms")
    .insert({ name, created_by: createdBy })
    .select("id, name, created_by, created_at")
    .single();
  if (error) {
    const taken = error.code === "23505";
    return Response.json(
      { error: taken ? `There's already a chat called "${name}".` : "Couldn't add the chat. Try again." },
      { status: taken ? 409 : 500 },
    );
  }
  return Response.json({ room: data });
}

/** DELETE /api/chat/rooms?id=... - removes a chat and all its messages (admins only). */
export async function DELETE(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member?.name) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (member.role !== "admin") return Response.json({ error: "Only admins can remove chats." }, { status: 403 });
  const db = supabaseServer();
  if (!db) return Response.json({ error: "Chat isn't set up: SUPABASE_SECRET_KEY is missing." }, { status: 503 });

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Which chat?" }, { status: 400 });
  const { data: room } = await db.from("chat_rooms").select("name").eq("id", id).maybeSingle();
  if (!room) return Response.json({ ok: true }); // already gone
  if (KEEP.includes(room.name)) {
    return Response.json({ error: `"${room.name}" can't be removed: the site needs it.` }, { status: 400 });
  }
  // its messages go with it (chat_messages.room_id ... on delete cascade)
  const { error } = await db.from("chat_rooms").delete().eq("id", id);
  if (error) return Response.json({ error: "Couldn't remove the chat. Try again." }, { status: 500 });
  return Response.json({ ok: true });
}
