import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

const text = IBM_Plex_Sans({
  variable: "--font-text",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Gold Dojo",
  description: "Gold Dojo: live XAUUSD trend signals (Daily trend and 4-hour trend) and research",
};

// Runs before the page paints so it opens in the saved theme (or the system's) without a flash.
const THEME_SCRIPT = `try {
  var t = localStorage.getItem("gold-theme");
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) { document.documentElement.dataset.theme = "dark"; }
// The tab icon follows the theme too (now, and whenever the theme changes)
(function () {
  var root = document.documentElement;
  function icon() {
    var l = document.getElementById("theme-icon");
    if (l) l.href = "/icon-" + (root.dataset.theme === "light" ? "light" : "dark") + ".svg";
  }
  icon();
  new MutationObserver(icon).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the script before React loads, so the server markup differs on purpose
    <html lang="en" className={`${display.variable} ${text.variable}`} suppressHydrationWarning>
      <head>
        {/* the script below swaps this to the light icon when the theme is light */}
        <link id="theme-icon" rel="icon" type="image/svg+xml" href="/icon-dark.svg" suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
