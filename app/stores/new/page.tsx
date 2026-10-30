/** /stores/new — a new store, one question at a time, then its uploads (`components/stores/Intake.tsx`). */
import type { Metadata } from "next";
import OperatorGate from "@/components/operator/OperatorGate";
import Intake from "@/components/stores/Intake";

export const metadata: Metadata = { title: "فروشگاه تازه — بازار مجازی", robots: { index: false, follow: false } };

export default function NewStorePage() {
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-xl px-4 py-6 sm:px-6">
      <a href="/stores" className="text-[13px] text-amber-200/80 underline">← فروشگاه‌ها · Stores</a>
      <h1 className="sk-font mb-4 mt-2 text-2xl font-bold text-amber-200">فروشگاه تازه <span dir="ltr" className="text-[14px] font-normal text-white/50">· New store</span></h1>
      <OperatorGate><Intake /></OperatorGate>
    </main>
  );
}
