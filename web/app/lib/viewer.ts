import "server-only";
import { cookies } from "next/headers";
import { currentMember } from "./members";

/**
 * Who is looking at an open page (the results page): the signed-in member, or null for a visitor.
 * Lets open pages show members and visitors different links. Reading cookies makes the page render per
 * request; the data it shows stays cached.
 */
export async function viewer() {
  const jar = await cookies();
  return currentMember({ getAll: () => jar.getAll() }).catch(() => null);
}
