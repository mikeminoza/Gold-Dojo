/** Display names: shown next to chat messages, one per person (see supabase/members.sql). */
export const NAME_MAX = 24;

/** A display name: trimmed, single spaces, letters/numbers and a few symbols, 1-24 characters. */
export function cleanName(raw: string) {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > NAME_MAX) return null;
  return /^[\p{L}\p{N} ._\-']+$/u.test(name) ? name : null;
}

/** Shortest password allowed for email + password accounts. */
export const PASSWORD_MIN = 8;
