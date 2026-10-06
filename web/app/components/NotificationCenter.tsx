"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** One thing that happened: a signal, a close, a price alert, a Daily trend paper trade, a bot status change. */
export type Notice = { id: string; time: number; kind: "signal" | "close" | "alert" | "trend" | "bot"; text: string; tone?: "profit" | "loss" };

const SEEN_KEY = "gold-notices-seen";
const listeners = new Set<() => void>();

function seenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function markSeen(time: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(time));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

const ICON: Record<Notice["kind"], string> = { signal: "◆", close: "●", alert: "◎", trend: "▲", bot: "■" };

/** The bell in the header: recent events, with a count of the ones you haven't seen. */
export default function NotificationCenter({ notices, stamp }: { notices: Notice[]; stamp: (t: number) => string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seen = useSyncExternalStore(
    (on) => {
      listeners.add(on);
      window.addEventListener("storage", on);
      return () => {
        listeners.delete(on);
        window.removeEventListener("storage", on);
      };
    },
    seenAt,
    () => Number.MAX_SAFE_INTEGER,
  );
  const list = [...notices].sort((a, b) => b.time - a.time).slice(0, 30);
  const unread = list.filter((n) => n.time > seen).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="notices" ref={box}>
      <button
        type="button"
        className="notices-bell"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        onClick={() => {
          setOpen((v) => !v);
          if (list[0]) markSeen(Math.max(seen === Number.MAX_SAFE_INTEGER ? 0 : seen, list[0].time));
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <i className="chat-badge">{unread > 9 ? "9+" : unread}</i>}
      </button>
      {open && (
        <div className="notices-panel" role="region" aria-label="Notifications">
          <h2>Notifications</h2>
          {list.length === 0 ? (
            <p className="notices-empty">Nothing yet. Signals, closes, price alerts and bot alerts show up here.</p>
          ) : (
            <ul>
              {list.map((n) => (
                <li key={n.id} data-new={n.time > seen || undefined} data-tone={n.tone}>
                  <span className="notice-icon" data-kind={n.kind} aria-hidden>
                    {ICON[n.kind]}
                  </span>
                  <span className="notice-text">{n.text}</span>
                  <time>{stamp(n.time)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
