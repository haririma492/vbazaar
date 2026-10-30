import type { Metadata } from "next";
import DemoScreen from "./demo/DemoScreen";
import { PAGES, homeJsonLd, indexable } from "@/lib/seo";

// The home page of vbazaar.app: the demo screen, indexed (`/demo` points its
// canonical here).
export const metadata: Metadata = indexable(PAGES.home);

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd()) }} />
      <DemoScreen />
    </>
  );
}
