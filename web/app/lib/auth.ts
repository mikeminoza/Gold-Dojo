/** Site password: a signed-in browser holds a cookie with a hash of the password (never the password). */
export const SESSION_COOKIE = "gs_session";
export const SESSION_DAYS = 30;

/** Changing SITE_PASSWORD changes this value, which signs everyone out. */
export async function sessionToken(password: string) {
  const bytes = new TextEncoder().encode(`golden-skibidi:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking, through timing, how much of the value matched. */
export function sameValue(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
