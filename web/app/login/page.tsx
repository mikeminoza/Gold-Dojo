import type { Metadata } from "next";
import { NAME_MAX } from "../lib/auth";

export const metadata: Metadata = { title: "Sign in · Golden Skibidi" };

const ERRORS: Record<string, string> = {
  password: "That password isn't right. Try again.",
  name: `Use 1-${NAME_MAX} letters, numbers, spaces, dots, dashes or underscores for your name.`,
};

// A plain HTML form, so it works before any of the (protected) page scripts load
export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error, name } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  return (
    <main className="login">
      <form className="login-card" method="post" action="/api/login">
        <h1>Golden Skibidi</h1>
        <p>Sign in to see the live XAUUSD signals and chat.</p>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="nickname"
          maxLength={NAME_MAX}
          defaultValue={typeof name === "string" ? name : ""}
          required
          autoFocus={error !== "password"}
        />
        <span className="login-hint">Shown next to your chat messages.</span>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={error === "password"}
        />
        {message && <p className="login-error">{message}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
