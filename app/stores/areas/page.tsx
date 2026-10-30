/** /stores/areas — outside, lobby, hallway: the bazaar's own walks and the hallway's door spots (`components/stores/Areas.tsx`). */
import type { Metadata } from "next";
import OperatorGate from "@/components/operator/OperatorGate";
import Areas from "@/components/stores/Areas";

export const metadata: Metadata = { title: "بیرون، لابی، راهرو — بازار مجازی", robots: { index: false, follow: false } };

export default function AreasPage() {
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <OperatorGate><Areas /></OperatorGate>
    </main>
  );
}
