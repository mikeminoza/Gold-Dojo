"use client";

import { useEffect, useRef, useState } from "react";
import SubmitButton from "./SubmitButton";
import { TOUR_EVENT } from "./Tour";

export type Me = { name: string; role: "admin" | "member"; email?: string; avatar?: string | null };

/** A steady colour per name, for the initials avatar. */
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({ me, size = 32 }: { me: Me; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials =
    me.name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  if (me.avatar && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small remote avatar; no optimisation needed
      <img
        className="avatar"
        src={me.avatar}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, ["--avatar-hue" as string]: hue(me.name) }} aria-hidden>
      {initials}
    </span>
  );
}

const THEMES: ["dark" | "light" | "system", string, React.ReactNode][] = [
  ["dark", "Dark", <path key="d" d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z" />],
  [
    "light",
    "Light",
    <g key="l">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" />
    </g>,
  ],
  [
    "system",
    "System",
    <g key="s">
      <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
      <path d="M6 14h4M8 11.5V14" />
    </g>,
  ],
];

/** Your avatar in the header; opens a menu with your profile, settings and sign out. */
export default function ProfileMenu({
  me,
  themeChoice,
  onTheme,
  alerts,
  onToggleAlerts,
}: {
  me: Me | null;
  themeChoice: "dark" | "light" | "system";
  onTheme: (choice: "dark" | "light" | "system") => void;
  alerts: boolean;
  onToggleAlerts: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Open toward whichever side has room: on phones the avatar sits on the left of the screen
  const [align, setAlign] = useState<"left" | "right">("right");
  const [top, setTop] = useState(64); // phones: the menu sits full-width just under the avatar
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on a click outside or Escape (and give focus back to the avatar)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown: Me = me ?? { name: "?", role: "member" };
  return (
    <div className="profile-menu" ref={box}>
      <button
        ref={button}
        type="button"
        className="profile-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="profile-menu-panel"
        aria-label={me ? `Account menu for ${me.name}` : "Account menu"}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const width = Math.min(280, window.innerWidth - 32);
          setAlign(r.right - width < 8 ? "left" : "right");
          setTop(Math.round(r.bottom + 8));
          setOpen((v) => !v);
        }}
      >
        <Avatar me={shown} />
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          id="profile-menu-panel"
          className="profile-panel"
          data-align={align}
          style={{ ["--menu-top" as string]: `${top}px` }}
        >
          {me && (
            <div className="profile-who">
              <Avatar me={me} size={40} />
              <div>
                <strong>{me.name}</strong>
                {me.email && <span>{me.email}</span>}
                {me.role === "admin" && <em>Admin</em>}
              </div>
            </div>
          )}
          <nav aria-label="Account">
            <a href="/profile">Profile and settings</a>
            {me?.role === "admin" && <a href="/admin">Members</a>}
            <a href="/how">How it works</a>
            <button type="button" className="profile-tour" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}>
              Take the tour
            </button>
          </nav>
          <div className="profile-settings">
            <button type="button" role="switch" aria-checked={alerts} onClick={onToggleAlerts} className="switch-row">
              <span>
                Sound alerts
                <small>Chime and notification on new signals</small>
              </span>
              <i className="switch" aria-hidden />
            </button>
            <div className="theme-row">
              <span id="theme-label">Theme</span>
              <div className="theme-segments" role="radiogroup" aria-labelledby="theme-label">
                {THEMES.map(([value, label, icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={themeChoice === value}
                    onClick={() => onTheme(value)}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      {icon}
                    </svg>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <form method="post" action="/auth/signout">
            <SubmitButton className="profile-signout" pending="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
