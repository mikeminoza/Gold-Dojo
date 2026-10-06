"use client";

import { useSyncExternalStore } from "react";

/** Small "done" messages ("Copied levels", "Alert added"...) shown for a few seconds at the bottom. */
export type Toast = { id: number; text: string; tone?: "ok" | "error"; action?: { label: string; run: () => void } };

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: Toast["tone"] = "ok", action?: Toast["action"], ms = 2600) {
  const id = next++;
  toasts = [...toasts.slice(-2), { id, text, tone, action }];
  emit();
  setTimeout(() => dismissToast(id), ms);
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: Toast[] = [];
export function useToasts() {
  return useSyncExternalStore(
    (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
    () => toasts,
    () => EMPTY,
  );
}
