"use client";

import { useToasts } from "../lib/toast";

/** Where toast messages appear: bottom centre, above the phone bottom bar. */
export default function Toaster() {
  const list = useToasts();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <p key={t.id} className="toast" data-tone={t.tone}>
          <span aria-hidden>{t.tone === "error" ? "!" : "✓"}</span>
          {t.text}
        </p>
      ))}
    </div>
  );
}
