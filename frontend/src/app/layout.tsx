import type { Metadata, Viewport } from "next";

import { Providers } from "./providers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "CoinCard — Spend, track, earn",
  description:
    "Credit-card transactions, spend analytics and reward coins. Built for the Digital Alpha take-home.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the app background so the mobile browser chrome blends in rather
  // than framing the page with a white bar in dark mode.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F7FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0E14" },
  ],
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this, the page renders in the default theme and then snaps to dark on
 * hydration — the classic flash of wrong theme. It has to be a blocking inline
 * script; anything async is already too late.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('coincard-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
