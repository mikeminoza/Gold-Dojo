"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export type ChatRoom = { id: string; name: string; created_by: string; created_at: string };
export type ChatMessage = { id: number; room_id: string; author: string; body: string; created_at: string };

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
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
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
        setMessages((all) => {
          const list = all[m.room_id];
          if (!list || list.some((x) => x.id === m.id)) return all; // not loaded yet, or already shown
          return { ...all, [m.room_id]: [...list, m].slice(-HISTORY * 3) };
        });
        const { activeId: open, panelOpen: visible, me: self, rooms: known, onIncoming: notify } = view.current;
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
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      client.removeChannel(channel);
    };
  }, [client]);

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
        const older = ((data ?? []) as ChatMessage[]).reverse();
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

  const send = useCallback(
    async (body: string) => {
      if (!activeId) throw new Error("Pick a chat first.");
      const { message } = await post<{ message: ChatMessage }>("/api/chat/messages", { roomId: activeId, body });
      setMessages((all) => {
        const list = all[message.room_id] ?? [];
        return list.some((x) => x.id === message.id) ? all : { ...all, [message.room_id]: [...list, message] };
      });
    },
    [activeId],
  );

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
    addRoom,
    configured: client !== null,
  };
}
