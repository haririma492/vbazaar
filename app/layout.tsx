import type { Metadata } from "next";
import "./globals.css";

// The Virtual Bazaar (VCA) on olgoo.com, moved out of Sarekooche on 2026-10-15.
// Mounted by the root server.js at the paths it had there (/vca, /vca/walk,
// /vb/…, /vr, /chinastore, /demo, /operator/splats), so a redirect from
// sarekooche.com lands on the same page. The basket stays Sarekooche's
// (`lib/sarekooche.ts`).
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://olgoo.com").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "VCA — Olgoo",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
