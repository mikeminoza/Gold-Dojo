import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in · Golden Skibidi" };

// A plain HTML form, so it works before any of the (protected) page scripts load
export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <form className="login-card" method="post" action="/api/login">
        <h1>Golden Skibidi</h1>
        <p>Enter the site password to see the live XAUUSD signals.</p>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
        {error && <p className="login-error">That password isn&apos;t right. Try again.</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
