"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { LiveState } from "./types";

type BotState = {
  state: LiveState | null;
  connected: boolean; // live updates from Supabase are flowing
  missing: boolean; // the bot has never sent anything
  configured: boolean; // the site has its Supabase settings
  /**
   * When this browser last saw a NEW update from the bot (ms, this browser's clock). Timing it on
   * arrival - not by the bot's own clock - means a phone or PC whose clock is off never shows a
   * false "Bot offline".
   */
  seenAt: number | null;
};

const REFRESH_MS = 20_000; // backup re-read in case a live update was missed

/** The bot's latest signals and status, pushed from Supabase the moment the bot sends them. */
export function useBotState(): BotState {
  const client = supabase();
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const [missing, setMissing] = useState(false);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const lastUpdated = useRef<number | null>(null);

  useEffect(() => {
    if (!client) return;
    let stopped = false;

    const apply = (data: LiveState) => {
      setState(data);
      setMissing(false);
      if (data.updated === lastUpdated.current) return; // same update seen again: the bot hasn't sent a new one
      const first = lastUpdated.current === null;
      lastUpdated.current = data.updated;
      // First sight: estimate its age from the bot's clock (a page opened while the bot is down
      // shouldn't claim "Live"); after that, time each new update by when it arrives here.
      setSeenAt(first ? Date.now() - Math.max(0, Date.now() / 1000 - data.updated) * 1000 : Date.now());
    };

    const load = async () => {
      const { data, error } = await client.from("bot_state").select("data").eq("id", "live").maybeSingle();
      if (stopped || error) return;
      if (data) apply(data.data as LiveState);
      else setMissing(true);
    };

    const channel = client
      .channel("bot_state_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bot_state", filter: "id=eq.live" },
        (change) => {
          const row = change.new as { data?: LiveState };
          if (row?.data) apply(row.data);
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    // Phones and background tabs pause pages: catch up the moment the page is looked at again
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
      client.removeChannel(channel);
    };
  }, [client]);

  return { state, connected, missing, configured: client !== null, seenAt };
}
