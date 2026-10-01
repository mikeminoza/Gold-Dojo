import type { NextRequest } from "next/server";
import { currentMember } from "../../lib/members";

export const runtime = "nodejs";

/** GET /api/me -> { name, role } of the signed-in member */
export async function GET(request: NextRequest) {
  const member = await currentMember({ getAll: () => request.cookies.getAll() });
  if (!member?.name) return Response.json({ error: "Sign in first." }, { status: 401 });
  return Response.json({ name: member.name, role: member.role }, { headers: { "Cache-Control": "private, no-store" } });
}
