import type { Metadata } from "next";
import { Cormorant_Garamond } from "next/font/google";
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

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--cs-serif",
  fallback: ["Didot", "Bodoni 72", "Georgia", "serif"],
});

export default function ChinaStorePage() {
  return <ChinaStore serifClass={serif.variable} />;
}
