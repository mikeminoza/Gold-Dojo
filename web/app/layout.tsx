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
  description: "Gold Dojo: practise gold trading with live XAUUSD signals and research",
};

// Runs before the page paints so it opens in the saved theme (or the system's) without a flash.
const THEME_SCRIPT = `try {
  var t = localStorage.getItem("gold-theme");
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) { document.documentElement.dataset.theme = "dark"; }`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the script before React loads, so the server markup differs on purpose
    <html lang="en" className={`${display.variable} ${text.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
