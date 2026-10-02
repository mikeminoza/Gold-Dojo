import type { NextRequest } from "next/server";
import { currentMember } from "../../lib/members";

export const runtime = "nodejs";

/** GET /api/me -> { userId, name, role, account, email, avatar } of the signed-in member */
export async function GET(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member?.name) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { userId, name, role, account, email, avatar } = member;
  return Response.json(
    { userId, name, role, account, email, avatar },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
