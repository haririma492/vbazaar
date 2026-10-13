import type { Metadata } from "next";
import DemoScreen from "./DemoScreen";

// `/demo` — one screen for pitching a store owner (founder, 2026-10-13:
// "headed to World on Yonge to pitch one or two owner, create ONE screen that I
// can show couple of things and put them all under simple key"). Not linked
// from anywhere and not indexed.
export const metadata: Metadata = {
  title: "سرکوچه — Demo",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoScreen />;
}
