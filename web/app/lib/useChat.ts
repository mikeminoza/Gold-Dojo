"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type ChatRoom = { id: string; name: string; created_by: string; created_at: string };
export type ChatMessage = { id: number; room_id: string; author: string; body: string; created_at: string };

/**
 * A message as shown: `key` stays the same from "sending" to "sent" so it doesn't flicker,
 * `status` is set only while your own message is on its way (or failed), and `fresh` marks messages
 * that arrived while the chat was open (they slide in; loaded history doesn't).
 */
export type ShownMessage = ChatMessage & { key: string; status?: "sending" | "failed"; error?: string; fresh?: boolean };

const TYPING_SHOW_MS = 3500; // how long "X is typing" stays after their last keystroke
const TYPING_SEND_MS = 2000; // send "I'm typing" at most this often

const HISTORY = 100; // messages loaded when a chat is opened
const ROOM_KEY = "gold-chat-room";

function savedRoom() {
  try {
    return localStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data as T;
}

/**
 * Live chat: the chats, the open chat's messages, and unread counts for the rest. New messages and new
 * chats arrive instantly through Supabase Realtime; sending goes through the site's server, which
 * attaches the name you signed in with.
 */
export function useChat(panelOpen: boolean, onIncoming?: (message: ChatMessage, roomName: string) => void) {
  const client = supabase();
  const [me, setMe] = useState<string | null>(null);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ShownMessage[]>>({});
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({}); // room -> name -> until
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the realtime handler needs to know right now, without re-subscribing on every change
  const view = useRef({
    activeId: null as string | null,
    panelOpen,
    me: null as string | null,
    rooms: [] as ChatRoom[],
    onIncoming,
  });
  useEffect(() => {
    view.current = { activeId, panelOpen, me, rooms, onIncoming };
  }, [activeId, panelOpen, me, rooms, onIncoming]);

  // Who am I, and which chats exist
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !stopped && d?.name && setMe(d.name))
      .catch(() => {});
    client
      .from("chat_rooms")
      .select("id, name, created_by, created_at")
      .order("created_at", { ascending: true })
      .then(({ data, error: e }) => {
        if (stopped) return;
        if (e) {
          setError(e.code === "PGRST205" ? "Chat isn't set up yet: run supabase/chat.sql in Supabase." : e.message);
          return;
        }
        const list = (data ?? []) as ChatRoom[];
        setRooms(list);
        const saved = savedRoom();
        setActiveId((cur) => cur ?? (list.find((r) => r.id === saved) ?? list[0])?.id ?? null);
      });
    return () => {
      stopped = true;
    };
  }, [client]);

  // Live updates for every chat
  useEffect(() => {
    if (!client) return;
    const channel = client
      .channel("chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (change) => {
        const raw = change.new as ChatMessage;
        const m = { ...raw, id: Number(raw.id) }; // one ID format, so duplicates are always caught
        const { activeId: open, panelOpen: visible, me: self, rooms: known, onIncoming: notify } = view.current;
        setMessages((all) => {
          const list = all[m.room_id];
          if (!list || list.some((x) => x.id === m.id)) return all; // not loaded yet, or already shown
          // Your own message usually arrives here while its "sending" copy is on screen: swap it in place
          const mine = m.author === self ? list.findIndex((x) => x.status === "sending" && x.body === m.body) : -1;
          if (mine >= 0) {
            const next = [...list];
            next[mine] = { ...m, key: list[mine].key, fresh: true };
            return { ...all, [m.room_id]: next };
          }
          return { ...all, [m.room_id]: [...list, { ...m, key: String(m.id), fresh: true }].slice(-HISTORY * 3) };
        });
        // Whoever sent it has stopped typing
        setTyping((t) => {
          const room = t[m.room_id];
          if (!room?.[m.author]) return t;
          const rest = { ...room };
          delete rest[m.author];
          return { ...t, [m.room_id]: rest };
        });
        if (m.author === self) return; // your own message (maybe from another tab): nothing to notify
        const onScreen = visible && open === m.room_id && !document.hidden;
        if (!(visible && open === m.room_id)) {
          setUnread((u) => ({ ...u, [m.room_id]: (u[m.room_id] ?? 0) + 1 }));
        }
        if (!onScreen) notify?.(m, known.find((r) => r.id === m.room_id)?.name ?? "a chat");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_rooms" }, (change) => {
        const r = change.new as ChatRoom;
        setRooms((list) => (list.some((x) => x.id === r.id) ? list : [...list, r]));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { room, name } = (payload ?? {}) as { room?: string; name?: string };
        if (!room || !name || name === view.current.me) return;
        setTyping((t) => ({ ...t, [room]: { ...(t[room] ?? {}), [name]: Date.now() + TYPING_SHOW_MS } }));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      client.removeChannel(channel);
    };
  }, [client]);

  // Forget "is typing" once people go quiet
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTyping((t) => {
        let changed = false;
        const next: typeof t = {};
        for (const [room, names] of Object.entries(t)) {
          const kept = Object.fromEntries(Object.entries(names).filter(([, until]) => until > now));
          if (Object.keys(kept).length !== Object.keys(names).length) changed = true;
          next[room] = kept;
        }
        return changed ? next : t;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Load the open chat's recent messages the first time it's opened
  const loaded = activeId ? messages[activeId] !== undefined : true;
  useEffect(() => {
    if (!client || !activeId || loaded) return;
    let stopped = false;
    client
      .from("chat_messages")
      .select("id, room_id, author, body, created_at")
      .eq("room_id", activeId)
      .order("created_at", { ascending: false })
      .limit(HISTORY)
      .then(({ data }) => {
        if (stopped) return;
        const older: ShownMessage[] = ((data ?? []) as ChatMessage[])
          .reverse()
          .map((m) => ({ ...m, id: Number(m.id), key: String(m.id) }));
        setMessages((all) => {
          // keep anything that arrived live while this was loading
          const live = (all[activeId] ?? []).filter((m) => !older.some((o) => o.id === m.id));
          return { ...all, [activeId]: [...older, ...live] };
        });
      });
    return () => {
      stopped = true;
    };
  }, [client, activeId, loaded]);

  const clearUnread = (id: string | null) => {
    if (id) setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u));
  };

  /** Call when the chat panel opens: the chat on screen counts as read. */
  const markRead = useCallback(() => clearUnread(view.current.activeId), []);

  const openRoom = useCallback((id: string) => {
    setActiveId(id);
    clearUnread(id);
    try {
      localStorage.setItem(ROOM_KEY, id);
    } catch {
      // not remembered next time; that's fine
    }
  }, []);

  /** Sends one message in the background, then turns its "sending" copy into the saved one. */
  const deliver = useCallback(async (roomId: string, key: string, body: string) => {
    try {
      const { message } = await post<{ message: ChatMessage }>("/api/chat/messages", { roomId, body });
      const id = Number(message.id);
      setMessages((all) => {
        const list = all[roomId] ?? [];
        if (!list.some((x) => x.key === key)) return all; // the live feed already swapped it in
        const next = list
          .filter((x) => x.key === key || x.id !== id) // drop a live copy if both arrived
          .map((x) => (x.key === key ? { ...message, id, key, fresh: true } : x));
        return { ...all, [roomId]: next };
      });
    } catch (err) {
      setMessages((all) => ({
        ...all,
        [roomId]: (all[roomId] ?? []).map((x) =>
          x.key === key ? { ...x, status: "failed" as const, error: (err as Error).message } : x,
        ),
      }));
    }
  }, []);

  /** Shows your message instantly, then sends it in the background. */
  const send = useCallback(
    (body: string) => {
      if (!activeId) return;
      const key = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const shown: ShownMessage = {
        id: -Date.now(),
        room_id: activeId,
        author: view.current.me ?? "You",
        body,
        created_at: new Date().toISOString(),
        key,
        status: "sending",
        fresh: true,
      };
      setMessages((all) => ({ ...all, [activeId]: [...(all[activeId] ?? []), shown] }));
      lastTypingSent.current = 0; // the next keystroke announces typing again
      void deliver(activeId, key, body);
    },
    [activeId, deliver],
  );

  /** Tries a failed message again. */
  const retry = useCallback(
    (message: ShownMessage) => {
      setMessages((all) => ({
        ...all,
        [message.room_id]: (all[message.room_id] ?? []).map((x) =>
          x.key === message.key ? { ...x, status: "sending" as const, error: undefined } : x,
        ),
      }));
      void deliver(message.room_id, message.key, message.body);
    },
    [deliver],
  );

  /** Call as you type: others in the chat see "<your name> is typing...". */
  const announceTyping = useCallback(() => {
    const { activeId: room, me: name } = view.current;
    const now = Date.now();
    if (!room || !name || now - lastTypingSent.current < TYPING_SEND_MS) return;
    lastTypingSent.current = now;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { room, name } });
  }, []);

  const addRoom = useCallback(
    async (name: string) => {
      const { room } = await post<{ room: ChatRoom }>("/api/chat/rooms", { name });
      setRooms((list) => (list.some((x) => x.id === room.id) ? list : [...list, room]));
      openRoom(room.id);
    },
    [openRoom],
  );

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  return {
    me,
    rooms,
    activeId,
    messages: activeId ? messages[activeId] : undefined,
    unread,
    totalUnread,
    live,
    error,
    openRoom,
    markRead,
    send,
    retry,
    announceTyping,
    typing: activeId ? Object.keys(typing[activeId] ?? {}) : [],
    addRoom,
    configured: client !== null,
  };
}
