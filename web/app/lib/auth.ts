/**
 * Site sign-in. A signed-in browser holds a cookie "<name>.<seal>": the name it signed in with, and a
 * hash of the site password plus that name. The server can check the seal, so the name can't be
 * edited in the browser, and the password itself is never stored.
 */
export const SESSION_COOKIE = "gs_session";
export const SESSION_DAYS = 30;
export const NAME_MAX = 24;

async function seal(password: string, name: string) {
  const bytes = new TextEncoder().encode(`golden-skibidi:${password}:${name}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const toB64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** A display name: trimmed, single spaces, letters/numbers and a few symbols, 1-24 characters. */
export function cleanName(raw: string) {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > NAME_MAX) return null;
  return /^[\p{L}\p{N} ._\-']+$/u.test(name) ? name : null;
}

/** Cookie value for a signed-in name. Changing SITE_PASSWORD signs everyone out. */
export async function sessionValue(password: string, name: string) {
  return `${toB64url(name)}.${await seal(password, name)}`;
}

/** The signed-in name from a cookie value, or null if it's missing or doesn't check out. */
export async function readSession(value: string | undefined, password: string) {
  if (!value || !value.includes(".")) return null;
  const [encoded, given] = value.split(".", 2);
  let name: string;
  try {
    name = fromB64url(encoded);
  } catch {
    return null;
  }
  return sameValue(given, await seal(password, name)) ? name : null;
}

/** Compares without leaking, through timing, how much of the value matched. */
export function sameValue(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The signed-in name for a request, for API routes. Without a SITE_PASSWORD (only allowed while
 * developing on this PC) everyone is "Guest".
 */
export async function signedInName(cookieValue: string | undefined) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return process.env.NODE_ENV === "production" ? null : "Guest";
  return readSession(cookieValue, password);
}
