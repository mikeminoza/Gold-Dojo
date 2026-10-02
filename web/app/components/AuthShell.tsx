import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around the sign-in and account pages: the same header and look as the main terminal,
 * rendered on the server so it works before any page scripts load.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <header className="auth-top">
        <Link href="/" className="instrument">
          <strong>Golden Skibidi</strong>
          <span>XAUUSD live signals</span>
        </Link>
      </header>
      <main className="login">{children}</main>
      <footer className="auth-foot">Signals only. Nothing here places trades.</footer>
    </div>
  );
}
