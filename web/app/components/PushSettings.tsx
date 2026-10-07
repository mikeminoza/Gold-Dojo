"use client";

import { useEffect, useState } from "react";
import { toast } from "../lib/toast";

type Strategy = "trend" | "h4";
const STRATEGIES: [Strategy, string][] = [
  ["trend", "Daily trend"],
  ["h4", "4-hour trend"],
];
const isStrategy = (s: unknown): s is Strategy => s === "trend" || s === "h4";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const MESSAGES = {
  unsupported: "This browser can't show notifications from websites. Try Chrome, Edge, Firefox or Safari.",
  ios: "On iPhone, first Add to Home Screen, then open Gold Dojo from there.",
  denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
  nokey: "Push isn't set up yet.",
  failed: "Couldn't turn on notifications. Try again.",
} as const;

/** The VAPID public key (base64url) as the bytes pushManager.subscribe wants. */
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Can this browser get push notifications, and if not, why not. */
function support(): keyof typeof MESSAGES | "ok" {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed =
    matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !installed) return "ios";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (!VAPID_KEY) return "nokey";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function savedStrategies(): Strategy[] {
  for (const key of ["gold-push-strategies", "gold-alert-strategies"]) {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(v)) return v.filter(isStrategy);
    } catch {
      // unreadable: try the next one
    }
  }
  return ["trend", "h4"];
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Tell the server where to send this browser's notifications, and for which strategies. */
async function saveSubscription(sub: PushSubscription, strategies: Strategy[]) {
  const json = sub.toJSON();
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth }, strategies }),
  }).catch(() => null);
  if (res?.ok) return null;
  const d = await res?.json().catch(() => null);
  return typeof d?.error === "string" ? d.error : MESSAGES.failed;
}

/**
 * Phone notifications (web push): signals reach this phone or computer even with the site closed.
 * Each browser subscribes on its own; the bot sends to every saved subscription.
 */
export default function PushSettings() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>(savedStrategies);
  const why = support();

  // Arriving from the dashboard's link (/profile#notifications): this section shows only once the page runs
  // in the browser, after the browser's own jump to the #notifications anchor, so scroll here now
  useEffect(() => {
    if (location.hash === "#notifications") document.getElementById("notifications")?.scrollIntoView({ block: "center" });
  }, []);

  // Already subscribed on this browser? (e.g. turned on during an earlier visit)
  useEffect(() => {
    if (why !== "ok" && why !== "nokey") return;
    let stopped = false;
    currentSubscription()
      .then((sub) => {
        if (!stopped) setOn(Boolean(sub) && Notification.permission === "granted");
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [why]);

  async function enable() {
    if (why !== "ok") {
      setMessage(MESSAGES[why]);
      return;
    }
    if (!strategies.length) {
      setMessage("Pick at least one strategy first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(permission === "denied" ? MESSAGES.denied : "Allow notifications when your browser asks, to turn them on.");
        return;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) }));
      const error = await saveSubscription(sub, strategies);
      if (error) {
        setMessage(error);
        return;
      }
      setOn(true);
      toast("Phone notifications on");
    } catch {
      setMessage(MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch(`/api/push?endpoint=${encodeURIComponent(endpoint)}`, { method: "DELETE" }).catch(() => null);
      }
      setOn(false);
      toast("Phone notifications off");
    } catch {
      setMessage("Couldn't turn them off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStrategy(s: Strategy) {
    const next = strategies.includes(s) ? strategies.filter((x) => x !== s) : [...strategies, s];
    if (!next.length) {
      setMessage("Keep at least one strategy, or turn phone notifications off.");
      return;
    }
    setMessage(null);
    setStrategies(next);
    try {
      localStorage.setItem("gold-push-strategies", JSON.stringify(next));
    } catch {
      // not remembered
    }
    if (!on) return;
    const sub = await currentSubscription().catch(() => null);
    const error = sub ? await saveSubscription(sub, next) : MESSAGES.failed;
    if (error) setMessage(error);
    else toast("Notification strategies saved");
  }

  return (
    <div className="push-settings" id="notifications">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={message ? "push-message" : undefined}
        className="switch-row pref-switch"
        disabled={busy}
        onClick={() => void (on ? disable() : enable())}
      >
        <span>
          Phone notifications
          <small>New paper trades and &lsquo;signal coming&rsquo; warnings on this device, even with the site closed</small>
        </span>
        <i className="switch" aria-hidden />
      </button>
      <fieldset className="push-strategies">
        <legend>Send notifications for</legend>
        {STRATEGIES.map(([s, label]) => (
          <label key={s}>
            <input type="checkbox" checked={strategies.includes(s)} disabled={busy} onChange={() => void toggleStrategy(s)} />
            {label}
          </label>
        ))}
      </fieldset>
      {message && (
        <p id="push-message" className="push-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
