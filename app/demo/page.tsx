import type { Metadata } from "next";
import DemoScreen from "./DemoScreen";

// `/demo` — one screen for pitching a store owner (founder, 2026-10-13:
// "headed to World on Yonge to pitch one or two owner, create ONE screen that I
// can show couple of things and put them all under simple key"). Linked
// from the home page's menu. Not indexed: a pitch screen, not a page of its own
// (the home page and /vca/walk carry its search terms).
export const metadata: Metadata = {
  title: { absolute: "دمو | بازار مجازی — Virtual Bazaar demo" },
  alternates: { canonical: "/demo" },
  robots: { index: false, follow: true },
};

export default function DemoPage() {
  return <DemoScreen />;
}
