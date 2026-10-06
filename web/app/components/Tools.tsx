"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { lotSize, maxRisk, type MyAccount } from "../lib/account";
import { toast } from "../lib/toast";
import type { LiveState, Side } from "../lib/types";
import EmptyState from "./EmptyState";

// ---- price alerts: kept in this browser, checked against the live price while the site is open ----

export type PriceAlert = { id: string; price: number; dir: "above" | "below"; hit: number | null };

const ALERTS_KEY = "gold-price-alerts";
const listeners = new Set<() => void>();
let raw: string | null | undefined;
let alerts: PriceAlert[] = [];

function read(): PriceAlert[] {
  let next: string | null = null;
  try {
    next = localStorage.getItem(ALERTS_KEY);
  } catch {
    // storage blocked: alerts last until the page closes
    return alerts;
  }
  if (next !== raw) {
    raw = next;
    try {
      alerts = next ? (JSON.parse(next) as PriceAlert[]) : [];
    } catch {
      alerts = [];
    }
  }
  return alerts;
}

function write(next: PriceAlert[]) {
  alerts = next;
  try {
    raw = JSON.stringify(next);
    localStorage.setItem(ALERTS_KEY, raw);
  } catch {
    // keep them in memory only
  }
  listeners.forEach((l) => l());
}

const EMPTY: PriceAlert[] = [];
export function usePriceAlerts() {
  return useSyncExternalStore(
    (on) => {
      listeners.add(on);
      window.addEventListener("storage", on);
      return () => {
        listeners.delete(on);
        window.removeEventListener("storage", on);
      };
    },
    read,
    () => EMPTY,
  );
}

/** Fires `onHit` once for each alert the live price crosses. */
export function useAlertWatcher(bid: number | null, onHit: (a: PriceAlert) => void) {
  useEffect(() => {
    if (bid === null) return;
    const list = read();
    const hits = list.filter((a) => !a.hit && (a.dir === "above" ? bid >= a.price : bid <= a.price));
    if (hits.length === 0) return;
    write(list.map((a) => (hits.includes(a) ? { ...a, hit: Date.now() / 1000 } : a)));
    hits.forEach(onHit);
  }, [bid, onHit]);
}

const price = (n: number) => n.toFixed(2);

export function PriceAlerts({ bid }: { bid: number }) {
  const id = useId();
  const list = usePriceAlerts();
  const [value, setValue] = useState("");
  const target = Number(value);
  const valid = value.trim() !== "" && target > 0 && Math.abs(target - bid) >= 0.01;

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const alert: PriceAlert = {
      id: `${Date.now()}`,
      price: Math.round(target * 100) / 100,
      dir: target > bid ? "above" : "below",
      hit: null,
    };
    write([...read(), alert].slice(-20));
    setValue("");
    toast(`Alert set at ${price(alert.price)}`);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }

  return (
    <>
      <form className="tool-row" onSubmit={add}>
        <label htmlFor={`${id}-price`} className="sr-only">
          Alert price
        </label>
        <input
          id={`${id}-price`}
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder={`e.g. ${Math.round(bid + 10)}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={!valid}>
          Add alert
        </button>
      </form>
      {value && valid && (
        <p className="tool-hint">
          Alerts when gold {target > bid ? "rises to" : "falls to"} {price(target)} ({target > bid ? "+" : "−"}
          {Math.abs(target - bid).toFixed(2)} from now).
        </p>
      )}
      {list.length === 0 && (
        <EmptyState icon="bell" title="No alerts yet">
          Pick a price above or below gold and get a chime when it gets there.
        </EmptyState>
      )}
      {list.length > 0 && (
        <ul className="alert-list">
          {[...list].reverse().map((a) => (
            <li key={a.id} data-hit={Boolean(a.hit)}>
              <span>
                {a.dir === "above" ? "↑" : "↓"} {price(a.price)}
                {a.hit ? <em>reached</em> : <em>{(a.dir === "above" ? a.price - bid : bid - a.price).toFixed(2)} away</em>}
              </span>
              <button
                type="button"
                onClick={() => {
                  write(read().filter((x) => x.id !== a.id));
                  toast("Alert removed");
                }}
                aria-label={`Remove alert at ${price(a.price)}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="note">Sound and a notification while this site is open in a tab. Saved in this browser.</p>
    </>
  );
}

// ---- lot size calculator ----

export function LotCalculator({
  bid,
  ask,
  account,
  rules,
}: {
  bid: number;
  ask: number;
  account: MyAccount;
  rules: LiveState["account"];
}) {
  const id = useId();
  const [side, setSide] = useState<Side>("BUY");
  const [entryText, setEntryText] = useState("");
  const [stopText, setStopText] = useState("");
  const [targetText, setTargetText] = useState("");
  const market = side === "BUY" ? ask : bid;
  const entry = entryText.trim() ? Number(entryText) : market;
  const stop = Number(stopText);
  const wrongSide = stopText.trim() !== "" && (side === "BUY" ? stop >= entry : stop <= entry);
  const ok = stopText.trim() !== "" && stop > 0 && entry > 0 && !wrongSide;
  const riskDist = Math.abs(entry - stop);
  const target = targetText.trim() ? Number(targetText) : side === "BUY" ? entry + 2 * riskDist : entry - 2 * riskDist;
  const size = ok ? lotSize(entry, stop, target, account, rules) : null;
  const rr = ok && riskDist > 0 ? Math.abs(target - entry) / riskDist : null;
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <div className="journal-periods tool-sides" role="group" aria-label="Direction">
        {(["BUY", "SELL"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}>
            {s === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className="tool-grid">
        <label htmlFor={`${id}-entry`}>
          Entry
          <input
            id={`${id}-entry`}
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder={`${price(market)} (now)`}
            value={entryText}
            onChange={(e) => setEntryText(e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-stop`}>
          Stop loss
          <input
            id={`${id}-stop`}
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder={price(side === "BUY" ? market - 8 : market + 8)}
            value={stopText}
            onChange={(e) => setStopText(e.target.value)}
            aria-invalid={wrongSide}
          />
        </label>
        <label htmlFor={`${id}-target`}>
          Target
          <input
            id={`${id}-target`}
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="2× risk"
            aria-describedby={`${id}-target-hint`}
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
          />
        </label>
      </div>
      <p id={`${id}-target-hint`} className="sr-only">
        Optional. Leave empty for a target of twice the risk.
      </p>
      {wrongSide && (
        <p className="tool-hint" data-error="true">
          For a {side === "BUY" ? "buy" : "sell"}, the stop goes {side === "BUY" ? "below" : "above"} the entry.
        </p>
      )}
      {size && (
        <div className="size" data-verdict={size.verdict}>
          <p>
            Trade <strong>{size.lots.toFixed(2)} lot</strong>
          </p>
          <p>
            Risk {money(size.risk)} ({size.risk_percent.toFixed(1)}%), target {money(size.reward)}
            {rr !== null && ` (${rr.toFixed(1)} : 1)`}
          </p>
          {size.verdict !== "ok" && <p className="size-note">{size.note}</p>}
        </div>
      )}
      <p className="note">
        For your {money(account.balance).replace(".00", "")} account at {account.risk_percent}% risk (limit{" "}
        {Number(maxRisk(account, rules).toFixed(1))}%). Change it on your profile.
      </p>
    </>
  );
}
