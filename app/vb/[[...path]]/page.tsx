import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VirtualBazaar from "@/components/virtual-bazaar/VirtualBazaar";
import {
  ADDRESS_LABEL, BAZAAR_NAME, addressPath, addressText, parseAddress, spotParam, streetAddressPath, type Spot,
} from "@/lib/virtualBazaar/layout";

/**
 * `/vb/…` — THE VIRTUAL ADDRESS («نشانی مجازی»). `/vb` is the bazaar's square,
 * `/vb/khoraki` the food street's entrance, `/vb/khoraki/5-sarekooche` in
 * front of unit 5 with its panel up — in front of the shop, never inside it.
 * The rules are `lib/virtualBazaar/layout.ts` («The virtual address»).
 *
 * The address stays in the bar (it is what a visitor copies and shares); the
 * 3D is the same page as `/vbazaar`.
 */
type Props = { params: { path?: string[] } };

function spotFrom(params: Props["params"]): Spot | null | undefined {
  try {
    return parseAddress((params.path ?? []).map((s) => decodeURIComponent(s)));
  } catch {
    return undefined;
  }
}

export function generateMetadata({ params }: Props): Metadata {
  const spot = spotFrom(params);
  if (spot === undefined) return {};
  let title = BAZAAR_NAME.fa;
  let description = "بازار مجازی سرکوچه — در بازار قدم بزنید و از مغازه‌ها خرید کنید.";
  let url = "/vb";
  if (spot?.kind === "shop") {
    title = `${spot.shop.name} — ${BAZAAR_NAME.fa}`;
    description = `${ADDRESS_LABEL.fa}: ${addressText(spot.shop)}`;
    url = addressPath(spot.shop);
  } else if (spot?.kind === "street") {
    title = `${spot.street.name} — ${BAZAAR_NAME.fa}`;
    url = streetAddressPath(spot.street) ?? url;
  }
  // ⚠️ THE PREVIEW ON X, FACEBOOK AND WHATSAPP. Until each shop has a photo of
  // its front, the preview is Sarekooche's logo with the address under it.
  const image = { url: "/sarekooche-logo-5.png", width: 600, height: 600, alt: title };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title, description, siteName: "سرکوچه", locale: "fa_IR", images: [image] },
    twitter: { card: "summary", title, description, images: [image.url] },
    robots: { index: false },
  };
}

export default function VirtualAddressPage({ params }: Props) {
  const spot = spotFrom(params);
  if (spot === undefined) notFound();
  return <VirtualBazaar initialSpot={spot ? spotParam(spot) : undefined} />;
}
