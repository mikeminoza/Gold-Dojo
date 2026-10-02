"use client";

import { useSyncExternalStore } from "react";
import type { LiveState, Position, SignalEvent, Sizing } from "./types";

/**
 * Each person's own account size and risk. Saved on their profile (so it follows them to every
 * device) with a copy in this browser for instant loading. Lot sizes, money results and the
 * Performance page all use it; the bot's own numbers (config.py) are the default.
 */
export type MyAccount = { balance: number; risk_percent: number };
type Rules = LiveState["account"];

import { BALANCE_LIMITS, RISK_LIMITS } from "./limits";

export { BALANCE_LIMITS, RISK_LIMITS };

const KEY = "gold-my-account";
const LOT_STEP = 0.01;

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: MyAccount | null = null;

function parse(raw: string | null): MyAccount | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MyAccount>;
    const ok = (n: unknown, [lo, hi]: readonly [number, number]) => typeof n === "number" && n >= lo && n <= hi;
    return ok(v.balance, BALANCE_LIMITS) && ok(v.risk_percent, RISK_LIMITS)
      ? { balance: v.balance!, risk_percent: v.risk_percent! }
      : null;
  } catch {
    return null;
  }
}

function snapshot() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // storage blocked: use the default account
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Save to the profile; the browser copy already shows it. */
function upload(value: MyAccount | null) {
  fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value ?? { balance: null, risk_percent: null }),
  }).catch(() => {});
}

/**
 * The account saved on the profile (from /api/me), applied in this browser. A browser that set one
 * before profiles kept it hands it up to the profile instead.
 */
export function adoptProfileAccount(saved: MyAccount | null) {
  const local = snapshot();
  if (saved) {
    if (!local || local.balance !== saved.balance || local.risk_percent !== saved.risk_percent) store(saved, false);
  } else if (local) {
    upload(local);
  }
}

function store(value: MyAccount | null, save = true) {
  if (save) upload(value);
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the change lasts until the page is closed
    cachedRaw = value ? JSON.stringify(value) : null;
    cached = value;
  }
  listeners.forEach((l) => l());
}

/** The visitor's account (or the bot's default), whether it's their own, and ways to change it. */
export function useMyAccount(rules: Rules) {
  const mine = useSyncExternalStore(subscribe, snapshot, () => null);
  const account: MyAccount = mine ?? { balance: rules.balance, risk_percent: rules.risk_percent };
  return { account, custom: mine !== null, save: (a: MyAccount) => store(a), reset: () => store(null) };
}

/** The risk limit scales with the chosen risk, the way config.py's MAX_RISK_PERCENT sits above RISK_PERCENT. */
export function maxRisk(account: MyAccount, rules: Rules) {
  return (rules.max_risk_percent / rules.risk_percent) * account.risk_percent;
}

/** Same rule as the bot's sizing.lot_size: lots so a stop-out costs about risk_percent of the balance. */
export function lotSize(entry: number, sl: number, tp: number, account: MyAccount, rules: Rules): Sizing {
  const riskPerLot = Math.abs(entry - sl) * rules.oz_per_lot;
  const wanted = (account.balance * account.risk_percent) / 100;
  const steps = riskPerLot > 0 ? Math.floor(wanted / riskPerLot / LOT_STEP + 1e-9) : 0;
  let lots = Math.round(steps * LOT_STEP * 100) / 100;
  const belowMin = lots < rules.min_lot;
  if (belowMin) lots = rules.min_lot;

  const risk = lots * riskPerLot;
  const reward = lots * Math.abs(tp - entry) * rules.oz_per_lot;
  const actual = (100 * risk) / account.balance;
  const limit = maxRisk(account, rules);
  const pct = (n: number) => `${Number(n.toFixed(1))}%`;
  let verdict: Sizing["verdict"] = "ok";
  let note = `Risks ${pct(actual)} of the account.`;
  if (actual > limit) {
    verdict = "skip";
    note = `Even ${lots.toFixed(2)} lot risks ${pct(actual)} of the account, above your ${pct(limit)} limit. Consider skipping this one.`;
  } else if (belowMin && actual > account.risk_percent + 0.05) {
    verdict = "high";
    note = `The smallest lot risks ${pct(actual)}, a bit above your ${pct(account.risk_percent)} target.`;
  }
  return {
    lots,
    risk: Math.round(risk * 100) / 100,
    reward: Math.round(reward * 100) / 100,
    risk_percent: Math.round(actual * 100) / 100,
    verdict,
    note,
  };
}

/** The open trade sized for this visitor's account, with its money result at that size. */
export function sizePosition(pos: Position, account: MyAccount, rules: Rules): Position {
  const size = lotSize(pos.entry, pos.sl, pos.tp, account, rules);
  return { ...pos, size, pnl_usd: pos.pnl * size.lots * rules.oz_per_lot };
}

/**
 * Signals sized for this visitor's account: opens get their lot size, closes get the money result
 * at the size their open would have had. A close whose open isn't known is scaled by risk instead.
 */
export function sizeEvents(events: SignalEvent[], account: MyAccount, rules: Rules): SignalEvent[] {
  const opens = new Map<string, SignalEvent>();
  for (const e of events) if (e.type === "open") opens.set(e.trade_id ?? e.id, e);
  const scale = (account.balance * account.risk_percent) / (rules.balance * rules.risk_percent);
  return events.map((e) => {
    if (e.type === "open") {
      return e.sl != null && e.tp != null ? { ...e, size: lotSize(e.price, e.sl, e.tp, account, rules) } : e;
    }
    const open = e.trade_id ? opens.get(e.trade_id) : undefined;
    if (open?.sl != null && open.tp != null) {
      const lots = lotSize(open.price, open.sl, open.tp, account, rules).lots;
      return { ...e, lots, pnl_usd: (e.pnl ?? 0) * lots * rules.oz_per_lot };
    }
    return e.pnl_usd != null ? { ...e, pnl_usd: e.pnl_usd * scale, lots: null } : e;
  });
}
