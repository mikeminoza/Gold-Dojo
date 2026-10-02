import AuthShell from "../components/AuthShell";
import SubmitButton from "../components/SubmitButton";
import type { Metadata } from "next";
import { PASSWORD_MIN } from "../lib/auth";

export const metadata: Metadata = { title: "New password · Golden Skibidi" };

const ERRORS: Record<string, string> = {
  short: `Use at least ${PASSWORD_MIN} characters.`,
  match: "The two passwords don't match.",
  failed: "Couldn't change the password. Ask for a new reset link and try again.",
};

/** Reached from a "reset password" email link (signed in by the link) to choose a new password. */
export default async function Reset({ searchParams }: PageProps<"/reset">) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  return (
    <AuthShell>
      <form className="login-card login-form" method="post" action="/auth/password">
        <h1>New password</h1>
        <p>Choose a new password for your account.</p>
        <input type="hidden" name="action" value="update" />
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required autoFocus />
        <span className="login-hint">At least {PASSWORD_MIN} characters.</span>
        <label htmlFor="confirm">Confirm new password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        {message && (
          <p className="login-error" role="alert">
            {message}
          </p>
        )}
        <SubmitButton pending="Saving…">Save password</SubmitButton>
      </form>
    </AuthShell>
  );
}
