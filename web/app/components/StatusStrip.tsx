import type { LiveState } from "../lib/types";

/** "3h 12m", "12m", "45s" */
function countdown(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * One line under the header with the whole picture: the signal, the next session (or the open
 * trade's result), how close Daily trend is to a buy, open risk against the cap, and the bot status.
 */
export default function StatusStrip({
  state,
  now,
  status,
  riskPercent,
  riskCap,
}: {
  state: LiveState;
  now: number;
  status: { tone: string; text: string };
  riskPercent: number; // your risk per trade (each Daily trend paper trade counts at this)
  riskCap: number;
}) {
  const pos = state.position;
  const next = state.windows[0];
  const start = next ? (next.range_start ?? next.first_entry) : null;
  const trend = state.daily_trend;
  const trendOpen = trend?.rules.filter((r) => r.position) ?? [];
  const nearest = trend?.rules
    .filter((r) => !r.position && r.trigger != null)
    .map((r) => ({ name: r.name, pct: (100 * ((r.trigger as number) - state.bid)) / state.bid }))
    .sort((a, b) => a.pct - b.pct)[0];
  const openRisk = (pos?.size?.risk_percent ?? 0) + riskPercent * trendOpen.length;

  const items: { key: string; label: string; value: string; tone?: string }[] = [
    {
      key: "signal",
      label: "Signal",
      value: pos
        ? `${pos.side === "BUY" ? "Buy" : "Sell"} open · ${pos.pnl >= 0 ? "+" : "−"}${Math.abs(pos.pnl).toFixed(2)}/oz`
        : next?.state === "trading"
          ? "Session open, watching"
          : next?.state === "range"
            ? "Marking the range"
            : start
              ? `Wait · New York in ${countdown(start - now)}`
              : "Wait",
      tone: pos ? (pos.pnl >= 0 ? "profit" : "loss") : undefined,
    },
    {
      key: "trend",
      label: "Daily trend",
      value: trendOpen.length
        ? `${trendOpen.length} paper ${trendOpen.length === 1 ? "trade" : "trades"} open`
        : nearest
          ? nearest.pct > 0
            ? `${nearest.pct.toFixed(1)}% from a buy`
            : "at its trigger"
          : trend
            ? "waiting for an uptrend"
            : "starting",
      tone: trendOpen.length ? "profit" : undefined,
    },
    {
      key: "risk",
      label: "Open risk",
      value: `${openRisk.toFixed(1)}% of ${riskCap}%`,
      tone: openRisk > riskCap ? "loss" : undefined,
    },
    { key: "bot", label: "Bot", value: status.text, tone: status.tone === "live" ? "profit" : status.tone === "off" ? "loss" : undefined },
  ];

  return (
    <ul className="status-strip" aria-label="At a glance">
      {items.map((x) => (
        <li key={x.key} data-tone={x.tone}>
          <span>{x.label}</span>
          <strong>{x.value}</strong>
        </li>
      ))}
    </ul>
  );
}
