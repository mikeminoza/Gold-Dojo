"use client";

import { useEffect, useRef, useState } from "react";
import SubmitButton from "./SubmitButton";

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

/** Your avatar in the header; opens a menu with your profile, settings and sign out. */
export default function ProfileMenu({
  me,
  theme,
  onToggleTheme,
  alerts,
  onToggleAlerts,
}: {
  me: Me | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  alerts: boolean;
  onToggleAlerts: () => void;
}) {
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar me={shown} />
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id="profile-menu-panel" className="profile-panel">
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
            <a href="/profile">Profile and account size</a>
            {me?.role === "admin" && <a href="/admin">Members</a>}
            <a href="/how">How it works</a>
          </nav>
          <div className="profile-settings">
            <button type="button" role="switch" aria-checked={alerts} onClick={onToggleAlerts}>
              Sound alerts <span>{alerts ? "On" : "Off"}</span>
            </button>
            <button type="button" role="switch" aria-checked={theme === "light"} onClick={onToggleTheme}>
              Light theme <span>{theme === "light" ? "On" : "Off"}</span>
            </button>
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
