/** Only plain https links from the bot's state are shown (never javascript: or other schemes). */
export function safeLink(url: string | null | undefined) {
  return typeof url === "string" && /^https:\/\/\S+$/i.test(url.trim()) ? url.trim() : null;
}
