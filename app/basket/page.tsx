/** /basket — the Virtual Bazaar's own basket (`lib/basket.ts`), kept on the shopper's device. */
import type { Metadata } from "next";
import BasketView from "@/components/basket/BasketView";

export const metadata: Metadata = { title: "سبد خرید · Basket — بازار مجازی", robots: { index: false, follow: false } };

export default function BasketPage() {
  return <BasketView />;
}
