"use client";

import type { ReactNode } from "react";

export type SideTab = "signal" | "trades" | "tools";

const ICONS: Record<string, ReactNode> = {
  chart: <path d="M4 20h16M6 16l4-5 3 3 5-7" />,
  signal: <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />,
  trades: <path d="M4 6h16M4 12h16M4 18h10" />,
  tools: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20 12z" />,
};

/** Phones: an app-style bar at the bottom to jump between the chart, the sidebar tabs and chat. */
export default function BottomBar({
  tab,
  chatOpen,
  onTab,
  onChart,
  onChat,
  unread,
}: {
  tab: SideTab | null; // null while the chat is open
  chatOpen: boolean;
  onTab: (t: SideTab) => void;
  onChart: () => void;
  onChat: () => void;
  unread: number;
}) {
  const item = (key: string, label: string, onClick: () => void, current = false, badge?: number) => (
    <button key={key} type="button" onClick={onClick} aria-current={current ? "page" : undefined}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONS[key]}
      </svg>
      <span>{label}</span>
      {badge ? <i className="chat-badge">{badge > 99 ? "99+" : badge}</i> : null}
    </button>
  );
  return (
    <nav className="bottom-bar" aria-label="Sections">
      {item("chart", "Chart", onChart)}
      {item("signal", "Signal", () => onTab("signal"), tab === "signal")}
      {item("trades", "Trades", () => onTab("trades"), tab === "trades")}
      {item("tools", "Tools", () => onTab("tools"), tab === "tools")}
      {item("chat", "Chat", onChat, chatOpen, chatOpen ? 0 : unread)}
    </nav>
  );
}
