"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import EmptyState from "./EmptyState";
import { toast } from "../lib/toast";
import type { ShownMessage, useChat } from "../lib/useChat";

type Chat = ReturnType<typeof useChat>;

function typingText(names: string[]) {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

// Chats the site needs (General, Bot status): never offered for removal (also refused by the server)
const KEEP_ROOMS = ["General", "Bot status"];

/** The chat drawer: chats along the top, the open chat's messages, and a box to send. */
export default function ChatPanel({
  chat,
  onClose,
  stamp,
  now,
  style,
}: {
  style?: React.CSSProperties; // placed next to the chat button wherever it was dragged
  chat: Chat;
  onClose: () => void;
  stamp: (utcSeconds: number, now: number) => string; // time label in the site's time zone
  now: number;
}) {
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string | null>(null); // chat (room id) asking "remove for everyone?"
  const [selected, setSelected] = useState<string | null>(null); // tapped message (phones: shows its delete button)
  const [confirming, setConfirming] = useState<string | null>(null); // message asking "delete for everyone?"

  /** Hide the message now; really delete it after 5 s unless Undo is pressed. */
  function deleteWithUndo(m: ShownMessage) {
    setConfirming(null);
    setSelected(null);
    chat.hide(m);
    const timer = setTimeout(() => void chat.remove(m), 5000);
    toast("Message deleted", "ok", {
      label: "Undo",
      run: () => {
        clearTimeout(timer);
        chat.restore(m);
      },
    }, 5000);
  }
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [roomName, setRoomName] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const room = chat.rooms.find((r) => r.id === chat.activeId);
  const messages = chat.messages;
  // The ✓ goes under your most recent message once it's saved
  const lastMine = messages ? [...messages].reverse().find((m) => m.author === chat.me) : undefined;

  // Keep the newest message (and the typing line) in view
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, chat.activeId, chat.typing.length]);

  useEffect(() => {
    box.current?.focus();
  }, [chat.activeId]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !room) return;
    // Shows up instantly; delivery happens in the background (with a retry if it fails)
    chat.send(body);
    setDraft("");
    box.current?.focus();
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
    <aside className="chat" aria-label="Chat" style={style}>
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
          <span key={r.id} className="chat-room">
            <button type="button" aria-pressed={r.id === chat.activeId} onClick={() => chat.openRoom(r.id)}>
              {r.name}
              {(chat.unread[r.id] ?? 0) > 0 && r.id !== chat.activeId && (
                <span className="chat-badge" aria-label={`${chat.unread[r.id]} unread`}>
                  {chat.unread[r.id]}
                </span>
              )}
            </button>
            {chat.isAdmin && !KEEP_ROOMS.includes(r.name) && (
              <button
                type="button"
                className="chat-room-remove"
                onClick={() => setRemoving(r.id)}
                aria-label={`Remove the ${r.name} chat`}
                title="Remove chat"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {chat.isAdmin && !adding && (
          <button type="button" className="chat-add" onClick={() => setAdding(true)}>
            + New chat
          </button>
        )}
      </nav>

      {removing && (
        <div className="chat-confirm chat-room-confirm" role="group" aria-label="Confirm removing the chat">
          <span>
            Remove &ldquo;{chat.rooms.find((r) => r.id === removing)?.name}&rdquo; and all its messages for everyone?
          </span>
          <button
            type="button"
            className="chat-confirm-yes"
            autoFocus
            onClick={async () => {
              const name = chat.rooms.find((r) => r.id === removing)?.name ?? "chat";
              try {
                await chat.removeRoom(removing);
                toast(`Removed the ${name} chat`);
              } catch (err) {
                toast((err as Error).message, "error");
              }
              setRemoving(null);
            }}
          >
            Remove
          </button>
          <button type="button" onClick={() => setRemoving(null)}>
            Cancel
          </button>
        </div>
      )}

      {chat.isAdmin && adding && (
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
          {messages === undefined && <li className="chat-empty">Loading messages…</li>}
          {messages?.length === 0 && (
            <li className="chat-empty">
              <EmptyState icon="chat" title={`Nothing in ${room?.name ?? "this chat"} yet`}>
                Say hello, ask about a signal, or share how a trade went.
              </EmptyState>
            </li>
          )}
          {messages?.map((m, i) => {
            const mine = m.author === chat.me;
            const prev = messages[i - 1];
            const grouped =
              prev && prev.author === m.author && Date.parse(m.created_at) - Date.parse(prev.created_at) < 120_000;
            return (
              <li
                key={m.key}
                data-mine={mine}
                data-grouped={grouped || undefined}
                data-fresh={m.fresh || undefined}
                data-status={m.status}
              >
                {!grouped && (
                  <div className="chat-meta">
                    <strong>{mine ? "You" : m.author}</strong>
                    <time>{stamp(Date.parse(m.created_at) / 1000, now)}</time>
                  </div>
                )}
                <p
                  className="chat-bubble"
                  onClick={() => chat.canDelete(m) && setSelected((k) => (k === m.key ? null : m.key))}
                >
                  {m.body}
                </p>
                {confirming === m.key && (
                  <div className="chat-confirm" role="group" aria-label="Confirm delete">
                    <span>Delete for everyone?</span>
                    <button type="button" className="chat-confirm-yes" onClick={() => deleteWithUndo(m)} autoFocus>
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                )}
                {chat.canDelete(m) && confirming !== m.key && (
                  <button
                    type="button"
                    className="chat-delete"
                    data-shown={selected === m.key || undefined}
                    onClick={() => setConfirming(m.key)}
                    aria-label={mine ? "Delete your message" : `Delete message from ${m.author}`}
                    title="Delete"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {m.status === "failed" ? (
                  <button type="button" className="chat-retry" onClick={() => chat.retry(m)} title={m.error}>
                    Not sent · Retry
                  </button>
                ) : m.status === "sending" ? (
                  <span className="chat-state">Sending</span>
                ) : (
                  mine &&
                  m.key === lastMine?.key && <span className="chat-state chat-sent">✓ Sent</span>
                )}
              </li>
            );
          })}
          {chat.typing.length > 0 && (
            <li className="chat-typing" aria-label={typingText(chat.typing)}>
              <span className="chat-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {typingText(chat.typing)}
            </li>
          )}
        </ol>
      )}

      <form className="chat-send" onSubmit={submit}>
        <textarea
          ref={box}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) chat.announceTyping();
          }}
          onKeyDown={onKey}
          placeholder={room ? `Message ${room.name}` : "Pick a chat"}
          maxLength={1000}
          rows={2}
          disabled={!room}
          aria-label="Message"
        />
        <button type="submit" disabled={!draft.trim() || !room}>
          Send
        </button>
      </form>
      {problem && <p className="chat-problem">{problem}</p>}
    </aside>
  );
}
