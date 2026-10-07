import AuthShell from "../components/AuthShell";
import SubmitButton from "../components/SubmitButton";
import type { Metadata } from "next";
import Link from "next/link";
import { PASSWORD_MIN } from "../lib/auth";

export const metadata: Metadata = { title: "Sign in · Gold Dojo" };

const ERRORS: Record<string, string> = {
  blocked: "This account has been blocked by the admin.",
  google: "Google sign-in didn't finish. Try again.",
  link: "That link has expired or was opened in a different browser. Sign in, or ask for a new link.",
  unavailable: "Couldn't reach the account service just now. Try again in a minute.",
  signin: "That email and password don't match. Try again, or reset your password.",
  unconfirmed: "Confirm your email first: open the link we sent you.",
  email: "Enter a valid email address.",
  short: `Use at least ${PASSWORD_MIN} characters for your password.`,
  match: "The two passwords don't match.",
  register: "Couldn't create the account. Try again, or sign in if you already have one.",
  busy: "Too many tries just now. Wait a few minutes, then try again.",
};
const NOTES: Record<string, string> = {
  confirm_sent: "Almost done: open the confirmation link we emailed you (check spam too), then sign in.",
  reset_sent: "If that email has an account, a reset link is on its way. Open it in this browser.",
  exists:
    "That email may already have an account. Sign in with Google if you used it there, or use Forgot password to set a password.",
};

type Mode = "signin" | "register" | "forgot";

function GoogleButton() {
  return (
    <a className="google-button" href="/auth/google">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
      </svg>
      Continue with Google
    </a>
  );
}

// Plain links and forms, so it works before any of the (signed-in only) page scripts load
export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error, note, mode: m } = await searchParams;
  const mode: Mode = m === "register" || m === "forgot" ? m : "signin";
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  const info = typeof note === "string" ? NOTES[note] : undefined;
  const title = mode === "register" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in";

  return (
    <AuthShell>
      <div className="login-card">
        <h1>{title}</h1>
        <p>{mode === "register" ? "Join to see the live XAUUSD signals and chat." : mode === "forgot" ? "We'll email you a link to choose a new password." : "Welcome back. Sign in to see the live signals and chat."}</p>
        {message && (
          <p className="login-error" role="alert">
            {message}
          </p>
        )}
        {info && (
          <p className="admin-ok" role="status">
            {info}
          </p>
        )}

        {mode !== "forgot" && (
          <>
            <GoogleButton />
            <p className="login-or">
              <span>or with email</span>
            </p>
          </>
        )}

        <form className="login-form" method="post" action="/auth/password">
          <input type="hidden" name="action" value={mode} />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          {mode !== "forgot" && (
            <>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                minLength={mode === "register" ? PASSWORD_MIN : undefined}
                required
              />
            </>
          )}
          {mode === "register" && (
            <>
              <span className="login-hint">At least {PASSWORD_MIN} characters.</span>
              <label htmlFor="confirm">Confirm password</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </>
          )}
          <SubmitButton
            pending={mode === "register" ? "Creating account…" : mode === "forgot" ? "Sending…" : "Signing in…"}
          >
            {mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
          </SubmitButton>
        </form>

        <p className="login-links">
          {mode === "signin" && (
            <>
              <Link href="/login?mode=register">Create an account</Link>
              <Link href="/login?mode=forgot">Forgot password?</Link>
            </>
          )}
          {mode !== "signin" && <Link href="/login">Back to sign in</Link>}
        </p>
        <p className="login-results">
          <Link href="/results">See the paper-test results</Link>
        </p>
      </div>
    </AuthShell>
  );
}
