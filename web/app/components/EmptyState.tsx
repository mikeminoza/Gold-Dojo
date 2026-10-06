import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  signals: <path d="M3 17l5-6 4 3 7-9M15 5h4v4" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />,
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20 12z" />,
  chart: <path d="M4 20h16M6 16l4-5 3 3 5-7" />,
  wait: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />,
};

/** A friendly "nothing here yet" with an icon, a line of explanation and an optional next step. */
export default function EmptyState({
  icon = "signals",
  title,
  children,
  action,
}: {
  icon?: keyof typeof ICONS;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONS[icon]}
      </svg>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Grey shimmering placeholder blocks while something loads. */
export function Skeleton({ lines = 3, height = 54 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton-list" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}
