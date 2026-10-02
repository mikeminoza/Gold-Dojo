import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NAME_MAX } from "../lib/auth";
import { BALANCE_LIMITS, RISK_LIMITS } from "../lib/limits";
import { currentMember } from "../lib/members";

export const metadata: Metadata = { title: "Profile · Golden Skibidi" };

const NOTES: Record<string, string> = {
  name: "Display name saved.",
  account: "Account size saved. Lot sizes on every device now use it.",
};
const ERRORS: Record<string, string> = {
  name: `Use 1-${NAME_MAX} letters, numbers, spaces, dots, dashes or underscores.`,
  taken: "Someone already uses that name. Pick another.",
  account: `Use a balance of at least $${BALANCE_LIMITS[0]} and a risk between ${RISK_LIMITS[0]}% and ${RISK_LIMITS[1]}%.`,
  failed: "Couldn't save. Try again.",
};

/** Your display name and account size, saved to your sign-in so every device uses them. */
export default async function Profile({ searchParams }: PageProps<"/profile">) {
  const jar = await cookies();
  const me = await currentMember({ getAll: () => jar.getAll() });
  if (!me) redirect("/login");
  const { saved, error } = await searchParams;
  const ok = typeof saved === "string" ? NOTES[saved] : undefined;
  const bad = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <main className="login">
      <div className="login-card admin-card">
        <h1>Profile</h1>
        <p>
          Signed in as {me.email}
          {me.role === "admin" ? " (admin)" : ""}.
        </p>
        {ok && (
          <p className="admin-ok" role="status">
            {ok}
          </p>
        )}
        {bad && (
          <p className="login-error" role="alert">
            {bad}
          </p>
        )}

        <form className="login-form profile-section" method="post" action="/api/profile">
          <h2>Display name</h2>
          <input type="hidden" name="from" value="profile" />
          <label htmlFor="name">Shown next to your chat messages</label>
          <input id="name" name="name" type="text" autoComplete="nickname" maxLength={NAME_MAX} defaultValue={me.name ?? ""} required />
          <button type="submit">Save name</button>
        </form>

        <form className="login-form profile-section" method="post" action="/api/account">
          <h2>Your account</h2>
          <p className="login-hint">
            Suggested lot sizes and every money result use this.{" "}
            {me.account ? "" : "You're using the bot's default account right now."}
          </p>
          <div className="account-fields">
            <label htmlFor="balance">
              Balance ($)
              <input
                id="balance"
                name="balance"
                type="number"
                inputMode="decimal"
                min={BALANCE_LIMITS[0]}
                step="any"
                defaultValue={me.account?.balance ?? ""}
                required
              />
            </label>
            <label htmlFor="risk">
              Risk per trade (%)
              <input
                id="risk"
                name="risk_percent"
                type="number"
                inputMode="decimal"
                min={RISK_LIMITS[0]}
                max={RISK_LIMITS[1]}
                step="0.1"
                defaultValue={me.account?.risk_percent ?? 1}
                required
              />
            </label>
          </div>
          <button type="submit">Save account</button>
        </form>
        {me.account && (
          <form method="post" action="/api/account">
            <input type="hidden" name="action" value="reset" />
            <button type="submit" className="link-button">
              Use the bot&apos;s default account instead
            </button>
          </form>
        )}

        <p className="login-links">
          <Link href="/">Back to the signals</Link>
          <Link href="/how">How it works</Link>
        </p>
      </div>
    </main>
  );
}
