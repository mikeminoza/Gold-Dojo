import type { NextRequest } from "next/server";
import { currentMember } from "../../../lib/members";
import { supabaseServer } from "../../../lib/supabaseServer";

export const runtime = "nodejs";

const NAME_MAX = 40;

/** POST /api/chat/rooms { name } - adds a new chat. */
export async function POST(request: NextRequest) {
  const createdBy = (await currentMember({ getAll: () => request.cookies.getAll() }))?.name;
  if (!createdBy) return Response.json({ error: "Sign in first." }, { status: 401 });
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
