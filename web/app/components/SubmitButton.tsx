"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A form's submit button that shows a spinner and `pending` text from the moment the form is sent
 * until the next page loads. Works on plain HTML forms (the page still navigates as usual); without
 * scripts (the sign-in page) it's an ordinary button.
 */
export default function SubmitButton({
  children,
  pending,
  className,
  name,
  value,
  ...rest
}: {
  children: ReactNode;
  pending: string; // e.g. "Signing in…"
  className?: string;
  name?: string;
  value?: string;
  "aria-label"?: string;
  "data-undo"?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      // Only the button that sent the form (forms can hold several)
      if (!e.submitter || e.submitter === ref.current) setBusy(true);
    };
    const reset = () => setBusy(false); // back from the browser's page cache
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", reset);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", reset);
    };
  }, []);

  return (
    <button
      ref={ref}
      type="submit"
      className={className}
      name={name}
      value={value}
      aria-disabled={busy || undefined}
      data-busy={busy || undefined}
      onClick={(e) => busy && e.preventDefault()} // no double sends
      {...rest}
    >
      {busy && <span className="btn-spinner" aria-hidden />}
      {busy ? pending : children}
    </button>
  );
}
