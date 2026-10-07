"use client";

import { useId, useState } from "react";
import { DEFAULT_BROKER, saveBroker, useBroker, type Broker } from "../lib/broker";
import { toast } from "../lib/toast";

/** The visitor's broker (standard or cent account, smallest lot, lot step, ounces per lot), saved on this device. */
export default function BrokerForm({ onDone }: { onDone?: () => void }) {
  const saved = useBroker();
  // Re-start the form whenever the saved settings change (e.g. saved from another place on the page)
  return <Fields key={JSON.stringify(saved)} saved={saved} onDone={onDone} />;
}

function Fields({ saved, onDone }: { saved: Broker; onDone?: () => void }) {
  const id = useId();
  const [type, setType] = useState<Broker["type"]>(saved.type);
  const [minLot, setMinLot] = useState(String(saved.minLot));
  const [lotStep, setLotStep] = useState(String(saved.lotStep));
  const [ozPerLot, setOzPerLot] = useState(String(saved.ozPerLot));
  const ok = (s: string) => s.trim() !== "" && Number(s) > 0 && Number.isFinite(Number(s));
  const valid = ok(minLot) && ok(lotStep) && ok(ozPerLot);
  const custom =
    saved.type !== DEFAULT_BROKER.type ||
    saved.minLot !== DEFAULT_BROKER.minLot ||
    saved.lotStep !== DEFAULT_BROKER.lotStep ||
    saved.ozPerLot !== DEFAULT_BROKER.ozPerLot;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    saveBroker({ type, minLot: Number(minLot), lotStep: Number(lotStep), ozPerLot: Number(ozPerLot) });
    toast("Broker saved: lot sizes updated");
    onDone?.();
  }

  const field = (key: string, label: string, value: string, set: (v: string) => void, hint: string) => (
    <label htmlFor={`${id}-${key}`}>
      {label}
      <input
        id={`${id}-${key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-invalid={!ok(value)}
        aria-describedby={`${id}-${key}-hint`}
      />
      <span id={`${id}-${key}-hint`} className="account-hint" data-error={!ok(value)}>
        {ok(value) ? hint : "Enter a number above 0"}
      </span>
    </label>
  );

  return (
    <form className="account-form broker-form" onSubmit={submit} noValidate>
      <div className="pref-row">
        <span id={`${id}-type`}>Account type</span>
        <div className="theme-segments" role="radiogroup" aria-labelledby={`${id}-type`}>
          {(["standard", "cent"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}>
              {t === "standard" ? "Standard" : "Cent"}
            </button>
          ))}
        </div>
      </div>
      <div className="account-fields broker-fields">
        {field("min", "Smallest lot", minLot, setMinLot, "Often 0.01")}
        {field("step", "Lot step", lotStep, setLotStep, "Sizes go up by this")}
        {field("oz", "Ounces per lot", ozPerLot, setOzPerLot, "100 for most gold accounts")}
      </div>
      <p className="account-note">
        Saved on this device only. {type === "cent"
          ? "On a cent account your balance is counted in cents, so 1 lot there moves like 0.01 standard lot."
          : "Sizes are rounded down to your lot step, so the risk never goes above what you chose."}
      </p>
      <div className="account-actions">
        <button type="submit" className="account-save" disabled={!valid}>
          Save
        </button>
        {onDone && (
          <button type="button" className="journal-csv" onClick={onDone}>
            Cancel
          </button>
        )}
        {custom && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              saveBroker(null);
              toast("Broker back to standard, 0.01 lot");
              onDone?.();
            }}
          >
            Use the defaults
          </button>
        )}
      </div>
    </form>
  );
}
