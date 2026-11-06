/** /stores/<slug>/website — what the Website Explorer read from the store's own site (`components/stores/WebsitePage.tsx`). */
import type { Metadata } from "next";
import WebsitePage from "@/components/stores/WebsitePage";
import BrandBadge from "@/components/brand/BrandBadge";

export const metadata: Metadata = { title: "وبسایت فروشگاه — بازار مجازی", robots: { index: false, follow: false } };

export default function StoreWebsitePage({ params }: { params: { slug: string } }) {
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex"><BrandBadge width={72} /></div>
      <WebsitePage slug={params.slug} />
    </main>
  );
}
