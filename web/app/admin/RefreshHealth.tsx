"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

const EVERY_MS = 30_000;

/** Re-reads the admin page (the bot health card) on click, and every 30 s while the page is open. */
export default function RefreshHealth() {
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <button type="button" className="health-refresh" onClick={() => start(() => router.refresh())} disabled={pending}>
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
