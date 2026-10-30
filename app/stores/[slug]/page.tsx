/** /stores/<slug> — one store's own page, for its owner (the store's password) and the operator (`components/stores/StorePage.tsx`). */
import type { Metadata } from "next";
import StorePage from "@/components/stores/StorePage";

export const metadata: Metadata = { title: "فروشگاه — بازار مجازی", robots: { index: false, follow: false } };

export default function OneStorePage({ params }: { params: { slug: string } }) {
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <StorePage slug={params.slug} />
    </main>
  );
}
