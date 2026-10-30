/** /stores — the operator's list of the bazaar's stores (the Store Builder crew, `lib/stores/`). */
import type { Metadata } from "next";
import OperatorGate from "@/components/operator/OperatorGate";
import StoresList from "@/components/stores/StoresList";

export const metadata: Metadata = { title: "فروشگاه‌ها — بازار مجازی", robots: { index: false, follow: false } };

export default function StoresPage() {
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <OperatorGate><StoresList /></OperatorGate>
    </main>
  );
}
