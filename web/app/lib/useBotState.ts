"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { LiveState } from "./types";

type BotState = {
  state: LiveState | null;
  connected: boolean; // live updates from Supabase are flowing
  missing: boolean; // the bot has never sent anything
  configured: boolean; // the site has its Supabase settings
};

const REFRESH_MS = 60_000; // safety re-read in case a live update was missed

/** The bot's latest signals and status, pushed from Supabase the moment the bot sends them. */
export function useBotState(): BotState {
  const client = supabase();
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!client) return;
    let stopped = false;

    const load = async () => {
      const { data, error } = await client.from("bot_state").select("data").eq("id", "live").maybeSingle();
      if (stopped || error) return;
      if (data) setState(data.data as LiveState);
      setMissing(!data);
    };

    const channel = client
      .channel("bot_state_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bot_state", filter: "id=eq.live" },
        (change) => {
          const row = change.new as { data?: LiveState };
          if (row?.data) {
            setState(row.data);
            setMissing(false);
          }
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      client.removeChannel(channel);
    };
  }, [client]);

  return { state, connected, missing, configured: client !== null };
}
