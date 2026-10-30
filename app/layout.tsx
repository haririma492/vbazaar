import type { Metadata } from "next";
import "./globals.css";

// The Virtual Bazaar (VCA) on its own site, vbazaar.app (copied out of
// olgoo-com/vca-app on 2026-10-29; before that olgoo.com, and Sarekooche until
// 2026-10-15). Same paths as there (/vca, /vca/walk, /vb/…, /vr, /chinastore,
// /demo, /operator/splats), so a redirect from either site lands on the same
// page. The basket stays Sarekooche's (`lib/sarekooche.ts`).
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://vbazaar.app").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "بازار مجازی — Virtual Bazaar",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
