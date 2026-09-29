import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// The Python bot writes live.json next to bot.py, one folder up from this app.
const LIVE_FILE = process.env.LIVE_FILE ?? path.join(process.cwd(), "..", "live.json");
const CHECK_MS = 150;
const HEARTBEAT_MS = 15_000;

/** Server-Sent Events: pushes live.json to the browser every time the bot rewrites it. */
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      let lastMtime = 0;
      let lastSent = Date.now();
      let reportedMissing = false;

      const send = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
        lastSent = Date.now();
      };

      const check = async () => {
        if (closed) return;
        try {
          const info = await stat(LIVE_FILE);
          if (info.mtimeMs !== lastMtime) {
            const text = await readFile(LIVE_FILE, "utf8");
            JSON.parse(text); // skip half-written files; the next check picks up the full one
            lastMtime = info.mtimeMs;
            reportedMissing = false;
            send(`event: state\ndata: ${text}\n\n`);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT" && !reportedMissing) {
            reportedMissing = true;
            send(`event: missing\ndata: {}\n\n`);
          }
        }
        if (Date.now() - lastSent > HEARTBEAT_MS) send(": ping\n\n");
        timer = setTimeout(check, CHECK_MS);
      };

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      check();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
