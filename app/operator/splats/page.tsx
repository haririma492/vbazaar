/**
 * /operator/splats — «صحنه‌های سه‌بعدی» on the operator's menu: upload the
 * Virtual Bazaar's Gaussian-splat files (Splatica masters and their web
 * copies) straight to Cloudflare R2. See `lib/splats/`.
 */
import type { Metadata } from "next";
import OperatorGate from "@/components/operator/OperatorGate";
import SplatUploads from "@/components/operator/SplatUploads";

export const metadata: Metadata = {
  title: "صحنه‌های سه‌بعدی — اپراتور بازار مجازی",
  robots: { index: false, follow: false },
};

export default function OperatorSplatsPage() {
  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-3xl px-4 py-6 sm:px-6">
      <OperatorGate>
        <SplatUploads />
      </OperatorGate>
    </main>
  );
}
