import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NAME_MAX } from "../lib/auth";
import { currentMember } from "../lib/members";

export const metadata: Metadata = { title: "Your name · Golden Skibidi" };

const ERRORS: Record<string, string> = {
  name: `Use 1-${NAME_MAX} letters, numbers, spaces, dots, dashes or underscores.`,
  taken: "Someone already uses that name. Pick another.",
  failed: "Couldn't save your name. Try again.",
};

/** Choose (or change) the name shown next to your chat messages. */
export default async function Welcome({ searchParams }: PageProps<"/welcome">) {
  const jar = await cookies();
  const member = await currentMember({ getAll: () => jar.getAll() });
  if (!member) redirect("/login");
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  const first = !member.name;
  return (
    <main className="login">
      <form className="login-card" method="post" action="/api/profile">
        <h1>{first ? "Welcome" : "Your name"}</h1>
        <p>
          {first ? "Choose the name others see next to your chat messages." : "Change the name shown in chat."} Signed in
          as {member.email}.
        </p>
        <label htmlFor="name">Display name</label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="nickname"
          maxLength={NAME_MAX}
          defaultValue={member.name ?? ""}
          required
          autoFocus
          aria-invalid={Boolean(message)}
          aria-describedby="name-hint"
        />
        <span id="name-hint" className="login-hint">
          Unique on this site. You can change it later.
        </span>
        {message && (
          <p className="login-error" role="alert">
            {message}
          </p>
        )}
        <button type="submit">{first ? "Continue" : "Save"}</button>
        {!first && (
          <Link className="login-hint" href="/">
            Back to the signals
          </Link>
        )}
      </form>
    </main>
  );
}
