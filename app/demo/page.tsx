import type { Metadata } from "next";
import DemoScreen from "./DemoScreen";
import { PAGES, indexable } from "@/lib/seo";

// `/demo` — one screen for pitching a store owner (founder, 2026-10-13:
// "headed to World on Yonge to pitch one or two owner, create ONE screen that I
// can show couple of things and put them all under simple key"). Not linked
// from anywhere. On vbazaar.app the same screen is the home page, so this one
// points its canonical there.
export const metadata: Metadata = {
  ...indexable(PAGES.home),
  alternates: { canonical: "/" },
};

export default function DemoPage() {
  return <DemoScreen />;
}
