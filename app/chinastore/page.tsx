import type { Metadata } from "next";
import localFont from "next/font/local";
import ChinaStore from "@/components/chinastore/ChinaStore";
import "./chinastore.css";

// `/chinastore` — the VCA investor preview of walk-through commerce: a
// simulated china boutique whose products carry their own labels, price and
// «Add to basket». The environment is a stand-in for the Gaussian-splat
// capture of a real store; the commerce layer on top of it is the part that
// stays (components/chinastore/commerce, lib/chinastore). English, for the
// investors it is shown to. Not linked from the site.
export const metadata: Metadata = {
  title: "VCA — The Virtual Mall",
  description: "Walk into a china boutique, pick up the teapot, carry the basket next door to the jeweller, and pay once for the whole trip.",
  robots: { index: false },
};

// Rendered per request, not prerendered: a prerendered page goes out with a
// year-long s-maxage, and the CDN in front of the site then keeps showing the
// previous walk after every deploy.
export const dynamic = "force-dynamic";

// Cormorant Garamond (SIL OFL), Google Fonts' latin variable files kept in
// the repo: a build that fetched them from Google failed on Railway when
// Google's answer was not the one next/font expected (app/fonts/README.md).
const serif = localFont({
  src: [
    { path: "../fonts/cormorant-garamond-latin.woff2", weight: "300 700", style: "normal" },
    { path: "../fonts/cormorant-garamond-italic-latin.woff2", weight: "300 700", style: "italic" },
  ],
  display: "swap",
  variable: "--cs-serif",
  fallback: ["Didot", "Bodoni 72", "Georgia", "serif"],
});

export default function ChinaStorePage() {
  return <ChinaStore serifClass={serif.variable} />;
}
