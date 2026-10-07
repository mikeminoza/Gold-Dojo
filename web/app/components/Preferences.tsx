"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { safeLink } from "../lib/links";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import BrokerForm from "./BrokerForm";
import PushSettings from "./PushSettings";
import Toaster from "./Toaster";

type Theme = "dark" | "light" | "system";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the setting lasts for this visit only
  }
}

/** The bot's public Telegram channel, if it has one (read once from its live state). */
function useTelegramUrl() {
  const client = supabase();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    client
      .from("bot_state")
      .select("telegram_url:data->>telegram_url")
      .eq("id", "live")
      .maybeSingle()
      .then(({ data }) => {
        if (!stopped) setUrl(safeLink((data as { telegram_url?: string | null } | null)?.telegram_url));
      });
    return () => {
      stopped = true;
    };
  }, [client]);
  return url;
}

/** This browser's settings, all in one place: theme, sound, broker, and resetting the layout and the tour. */
export default function Preferences() {
  const telegram = useTelegramUrl();
  const [theme, setTheme] = useState<Theme>(() => {
    const t = read("gold-theme");
    return t === "dark" || t === "light" ? t : "system";
  });
  const [sound, setSound] = useState(() => read("gold-sound-alerts") === "1");
  // The saved values only exist in the browser: show the controls once the page is running there
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const chooseTheme = (t: Theme) => {
    setTheme(t);
    write("gold-theme", t === "system" ? null : t);
    const applied = t === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : t;
    document.documentElement.setAttribute("data-theme", applied);
  };

  if (!mounted) return null;
  return (
    <section className="login-form profile-section">
      <h2>Settings on this device</h2>
      <div className="pref-row">
        <span id="pref-theme">Theme</span>
        <div className="theme-segments" role="radiogroup" aria-labelledby="pref-theme">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => chooseTheme(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={sound}
        className="switch-row pref-switch"
        onClick={() => {
          setSound(!sound);
          write("gold-sound-alerts", sound ? "0" : "1");
          toast(sound ? "Sound alerts off" : "Sound alerts on");
        }}
      >
        <span>
          Sound alerts
          <small>Chime and notification on new signals, while the site is open</small>
        </span>
        <i className="switch" aria-hidden />
      </button>
      <PushSettings />
      {telegram && (
        <a className="telegram-link pref-telegram" href={telegram} target="_blank" rel="noopener noreferrer">
          <TelegramIcon />
          Get alerts on Telegram
          <small>Same signals, even with the site closed</small>
        </a>
      )}
      <h3 className="pref-heading">Your broker</h3>
      <p className="pref-sub">Lot sizes are rounded down to what your broker accepts, with the real risk after rounding.</p>
      <BrokerForm />
      <div className="pref-actions">
        <button
          type="button"
          className="journal-csv"
          onClick={() => {
            write("gold-folded", null);
            write("gold-tab", null);
            toast("Sidebar reset: all sections open");
          }}
        >
          Reset sidebar layout
        </button>
        <button
          type="button"
          className="journal-csv"
          onClick={() => {
            write("gold-chat-fab", null);
            toast("Chat button back in its corner");
          }}
        >
          Reset chat button position
        </button>
        <Link className="journal-csv" href="/?tour=1">
          Take the tour again
        </Link>
      </div>
      <Toaster />
    </section>
  );
}

/** The paper-plane mark for the Telegram link. */
export function TelegramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l12-9" />
    </svg>
  );
}
