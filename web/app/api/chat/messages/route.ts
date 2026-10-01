import type { NextRequest } from "next/server";
import { currentMember } from "../../../lib/members";
import { supabaseServer } from "../../../lib/supabaseServer";

export const runtime = "nodejs";

const BODY_MAX = 1000;

/** POST /api/chat/messages { roomId, body } - sends a message as the signed-in name. */
export async function POST(request: NextRequest) {
  const author = (await currentMember({ getAll: () => request.cookies.getAll() }))?.name;
  if (!author) return Response.json({ error: "Sign in first." }, { status: 401 });
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

  const { data, error } = await db
    .from("chat_messages")
    .insert({ room_id: roomId, author, body })
    .select("id, room_id, author, body, created_at")
    .single();
  if (error) {
    const missingRoom = error.code === "23503";
    return Response.json(
      { error: missingRoom ? "That chat no longer exists." : "Couldn't send the message. Try again." },
      { status: missingRoom ? 404 : 500 },
    );
  }
  return Response.json({ message: data });
}
