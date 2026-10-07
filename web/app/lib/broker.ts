"use client";

import { useSyncExternalStore } from "react";

/**
 * The visitor's broker, saved in this browser only: standard or cent account, the smallest lot, the lot
 * step and the ounces in one lot. Lot sizes are rounded DOWN to what the broker accepts, so the real risk
 * is shown after rounding.
 */
export type Broker = { type: "standard" | "cent"; minLot: number; lotStep: number; ozPerLot: number };

export const DEFAULT_BROKER: Broker = { type: "standard", minLot: 0.01, lotStep: 0.01, ozPerLot: 100 };

const KEY = "gold-broker";
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: Broker = DEFAULT_BROKER;

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function parse(raw: string | null): Broker {
  if (!raw) return DEFAULT_BROKER;
  try {
    const v = JSON.parse(raw) as Partial<Broker>;
    return {
      type: v.type === "cent" ? "cent" : "standard",
      minLot: positive(v.minLot) ? v.minLot : DEFAULT_BROKER.minLot,
      lotStep: positive(v.lotStep) ? v.lotStep : DEFAULT_BROKER.lotStep,
      ozPerLot: positive(v.ozPerLot) ? v.ozPerLot : DEFAULT_BROKER.ozPerLot,
    };
  } catch {
    return DEFAULT_BROKER;
  }
}

function snapshot() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached; // storage blocked: whatever was saved this visit
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

/** Save the broker settings (null = back to the defaults). */
export function saveBroker(value: Broker | null) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: keep it until the page is closed
    cachedRaw = value ? JSON.stringify(value) : null;
    cached = value ?? DEFAULT_BROKER;
  }
  listeners.forEach((l) => l());
}

/** The broker settings saved in this browser, or the defaults. */
export function useBroker() {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_BROKER);
}

/** Ounces that 1 lot moves in account dollars: a cent account's lot moves like 1/100 of a standard lot. */
export const ozPerLotInDollars = (b: Broker) => (b.type === "cent" ? b.ozPerLot / 100 : b.ozPerLot);

/** Decimals to show a lot size with, from the lot step (0.01 → 2, 0.001 → 3). */
export const lotDecimals = (b: Broker) => Math.min(6, Math.max(2, (String(b.lotStep).split(".")[1] ?? "").length));

export type BrokerSize = {
  exact: number; // lots before rounding
  lots: number; // rounded down to the lot step; below minLot means the trade is too big to size
  risk: number; // dollars lost at the stop with `lots`
  riskPct: number;
  tooBig: boolean; // even the smallest lot risks more than wanted
  minRisk: number; // dollars lost at the stop with the smallest lot
  minRiskPct: number;
};

/**
 * Lots for a dollar risk and a stop distance (price), rounded down to the broker's step.
 * lots = risk ÷ stop distance ÷ ounces per lot (a cent account's lot counts as ozPerLot ÷ 100 ounces in dollars).
 */
export function brokerSize(riskUsd: number, balance: number, stopDist: number, b: Broker): BrokerSize {
  const perLot = Math.max(stopDist, 0.01) * ozPerLotInDollars(b); // dollars lost per lot at the stop
  const exact = riskUsd / perLot;
  const lots = Math.round(Math.floor(exact / b.lotStep + 1e-9) * b.lotStep * 1e8) / 1e8;
  const tooBig = lots < b.minLot - 1e-9;
  const risk = (tooBig ? 0 : lots) * perLot;
  const minRisk = b.minLot * perLot;
  return {
    exact,
    lots: tooBig ? 0 : lots,
    risk,
    riskPct: (100 * risk) / balance,
    tooBig,
    minRisk,
    minRiskPct: (100 * minRisk) / balance,
  };
}
