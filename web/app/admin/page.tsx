import AuthShell from "../components/AuthShell";
import SubmitButton from "../components/SubmitButton";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentMember } from "../lib/members";
import { supabaseServer } from "../lib/supabaseServer";

export const metadata: Metadata = { title: "Members · Gold Dojo" };

const NOTES: Record<string, string> = {
  blocked: "Blocked. They're signed out within 30 seconds and can't sign back in.",
  unblocked: "Unblocked. They can sign in again.",
  email: "That doesn't look like an email address.",
  self: "You can't block yourself.",
  failed: "That didn't work. Try again.",
};

/** Everyone who has signed up; admins can block and unblock people. */
export default async function Admin({ searchParams }: PageProps<"/admin">) {
  const jar = await cookies();
  const me = await currentMember({ getAll: () => jar.getAll() });
  if (me?.role !== "admin") redirect("/");
  const db = supabaseServer();
  const [{ data: members }, { data: profiles }] = db
    ? await Promise.all([
        db.from("members").select("email, role, blocked, added_at").order("added_at", { ascending: false }),
        db.from("profiles").select("email, name"),
      ])
    : [{ data: [] }, { data: [] }];
  const names = new Map((profiles ?? []).map((p) => [p.email.toLowerCase(), p.name as string]));
  const { note } = await searchParams;
  const message = typeof note === "string" ? NOTES[note] : undefined;

  return (
    <AuthShell>
      <div className="login-card admin-card">
        <h1>Members</h1>
        <p>
          Everyone who has signed up ({(members ?? []).length}), newest first. Block anyone who misuses the site or
          chat.
        </p>
        {message && (
          <p className={note === "blocked" || note === "unblocked" ? "admin-ok" : "login-error"} role="status">
            {message}
          </p>
        )}
        <ul className="admin-list">
          {(members ?? []).map((m) => (
            <li key={m.email}>
              <span>
                <strong>{names.get(m.email) ?? "No name yet"}</strong>
                <span>
                  {m.email}
                  {m.role === "admin" ? " · admin" : ""}
                  {m.blocked ? " · blocked" : ""}
                </span>
              </span>
              {m.email !== me.email && (
                <form method="post" action="/api/admin/members">
                  <input type="hidden" name="action" value={m.blocked ? "unblock" : "block"} />
                  <input type="hidden" name="email" value={m.email} />
                  <SubmitButton
                    className="admin-remove"
                    data-undo={m.blocked}
                    aria-label={`${m.blocked ? "Unblock" : "Block"} ${m.email}`}
                    pending={m.blocked ? "Unblocking…" : "Blocking…"}
                  >
                    {m.blocked ? "Unblock" : "Block"}
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
        <Link className="login-hint" href="/">
          Back to the signals
        </Link>
      </div>
    </AuthShell>
  );
}
