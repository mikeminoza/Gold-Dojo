import type { MetadataRoute } from "next";

/** Lets phones install Gold Dojo to the home screen (needed for notifications on iPhone). Served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gold Dojo",
    short_name: "Gold Dojo",
    description: "Gold Dojo: XAUUSD trend signals (Daily trend and 4-hour trend), paper-tested",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1b2b", // the dark theme's --bg
    theme_color: "#0e1b2b",
    icons: [
      { src: "/icon-dark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
