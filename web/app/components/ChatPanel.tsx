"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { useChat } from "../lib/useChat";

type Chat = ReturnType<typeof useChat>;

/** The chat drawer: chats along the top, the open chat's messages, and a box to send. */
export default function ChatPanel({
  chat,
  onClose,
  stamp,
  now,
}: {
  chat: Chat;
  onClose: () => void;
  stamp: (utcSeconds: number, now: number) => string; // time label in the site's time zone
  now: number;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [roomName, setRoomName] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const room = chat.rooms.find((r) => r.id === chat.activeId);

  // Keep the newest message in view
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.activeId]);

  useEffect(() => {
    box.current?.focus();
  }, [chat.activeId]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setProblem(null);
    try {
      await chat.send(body);
      setDraft("");
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setSending(false);
      box.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  async function createRoom(e: FormEvent) {
    e.preventDefault();
    const name = roomName.trim();
    if (!name) return;
    setProblem(null);
    try {
      await chat.addRoom(name);
      setRoomName("");
      setAdding(false);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  return (
    <aside className="chat" aria-label="Chat">
      <header className="chat-head">
        <div>
          <h2>Chat</h2>
          <p>
            {chat.me ? (
              <>
                You&apos;re <strong>{chat.me}</strong>
              </>
            ) : (
              "Connecting…"
            )}
            <span className="chat-live" data-live={chat.live}>
              {chat.live ? "Live" : "Reconnecting…"}
            </span>
          </p>
        </div>
        <button type="button" className="chat-close" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </header>

      <nav className="chat-rooms" aria-label="Chats">
        {chat.rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={r.id === chat.activeId}
            onClick={() => chat.openRoom(r.id)}
          >
            {r.name}
            {(chat.unread[r.id] ?? 0) > 0 && r.id !== chat.activeId && (
              <span className="chat-badge" aria-label={`${chat.unread[r.id]} unread`}>
                {chat.unread[r.id]}
              </span>
            )}
          </button>
        ))}
        {!adding && (
          <button type="button" className="chat-add" onClick={() => setAdding(true)}>
            + New chat
          </button>
        )}
      </nav>

      {adding && (
        <form className="chat-new" onSubmit={createRoom}>
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Name the chat, e.g. London session"
            maxLength={40}
            aria-label="New chat name"
            autoFocus
          />
          <button type="submit">Add</button>
          <button type="button" className="chat-cancel" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      )}

      {chat.error ? (
        <p className="chat-empty">{chat.error}</p>
      ) : (
        <ol className="chat-messages" ref={list} aria-live="polite">
          {chat.messages === undefined && <li className="chat-empty">Loading messages…</li>}
          {chat.messages?.length === 0 && (
            <li className="chat-empty">No messages in {room?.name ?? "this chat"} yet. Say hello.</li>
          )}
          {chat.messages?.map((m, i) => {
            const mine = m.author === chat.me;
            const prev = chat.messages?.[i - 1];
            const grouped = prev && prev.author === m.author && Date.parse(m.created_at) - Date.parse(prev.created_at) < 120_000;
            return (
              <li key={m.id} data-mine={mine} data-grouped={grouped || undefined}>
                {!grouped && (
                  <div className="chat-meta">
                    <strong>{mine ? "You" : m.author}</strong>
                    <time>{stamp(Date.parse(m.created_at) / 1000, now)}</time>
                  </div>
                )}
                <p className="chat-bubble">{m.body}</p>
              </li>
            );
          })}
        </ol>
      )}

      <form className="chat-send" onSubmit={submit}>
        <textarea
          ref={box}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={room ? `Message ${room.name}` : "Pick a chat"}
          maxLength={1000}
          rows={2}
          disabled={!room}
          aria-label="Message"
        />
        <button type="submit" disabled={!draft.trim() || sending || !room}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {problem && <p className="chat-problem">{problem}</p>}
    </aside>
  );
}
