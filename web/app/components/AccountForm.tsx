"use client";

import { useId, useState } from "react";
import { BALANCE_LIMITS, RISK_LIMITS, type useMyAccount } from "../lib/account";
import type { LiveState } from "../lib/types";

type My = ReturnType<typeof useMyAccount>;

const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Balance and risk per trade for this visitor; lot sizes and results everywhere follow it. */
export default function AccountForm({ my, rules, onDone }: { my: My; rules: LiveState["account"]; onDone: () => void }) {
  const id = useId();
  const [balance, setBalance] = useState(String(my.account.balance));
  const [risk, setRisk] = useState(String(my.account.risk_percent));
  const b = Number(balance);
  const r = Number(risk);
  const balanceOk = balance.trim() !== "" && b >= BALANCE_LIMITS[0] && b <= BALANCE_LIMITS[1];
  const riskOk = risk.trim() !== "" && r >= RISK_LIMITS[0] && r <= RISK_LIMITS[1];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!balanceOk || !riskOk) return;
    my.save({ balance: Math.round(b * 100) / 100, risk_percent: Math.round(r * 100) / 100 });
    onDone();
  }

  return (
    <form className="account-form" onSubmit={submit} noValidate>
      <div className="account-fields">
        <label htmlFor={`${id}-balance`}>
          Account balance ($)
          <input
            id={`${id}-balance`}
            type="number"
            inputMode="decimal"
            min={BALANCE_LIMITS[0]}
            step="any"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            aria-invalid={!balanceOk}
            aria-describedby={`${id}-balance-hint`}
          />
          <span id={`${id}-balance-hint`} className="account-hint" data-error={!balanceOk}>
            {balanceOk ? "What your trading account holds" : `Enter ${dollars(BALANCE_LIMITS[0])} or more`}
          </span>
        </label>
        <label htmlFor={`${id}-risk`}>
          Risk per trade (%)
          <input
            id={`${id}-risk`}
            type="number"
            inputMode="decimal"
            min={RISK_LIMITS[0]}
            max={RISK_LIMITS[1]}
            step="0.1"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            aria-invalid={!riskOk}
            aria-describedby={`${id}-risk-hint`}
          />
          <span id={`${id}-risk-hint`} className="account-hint" data-error={!riskOk}>
            {riskOk
              ? balanceOk
                ? `Loses about ${dollars(Math.round(b * r) / 100)} if the stop is hit`
                : "Most traders use 0.5–2%"
              : `Between ${RISK_LIMITS[0]}% and ${RISK_LIMITS[1]}%`}
          </span>
        </label>
      </div>
      <p className="account-note">
        Saved in this browser only. Suggested lot sizes and every money result on this page use it. The smallest
        size is {rules.min_lot} lot, so small accounts can end up risking more than they chose.
      </p>
      <div className="account-actions">
        <button type="submit" className="account-save" disabled={!balanceOk || !riskOk}>
          Save
        </button>
        <button type="button" className="journal-csv" onClick={onDone}>
          Cancel
        </button>
        {my.custom && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              my.reset();
              onDone();
            }}
          >
            Use the default ({dollars(rules.balance)}, {rules.risk_percent}%)
          </button>
        )}
      </div>
    </form>
  );
}
