import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VirtualBazaar from "@/components/virtual-bazaar/VirtualBazaar";
import { PAGES, indexable } from "@/lib/seo";
import PageSeo from "@/components/seo/PageSeo";
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
 * 3D is the same page as `/vca`.
 */
type Props = { params: { path?: string[] } };

function spotFrom(params: Props["params"]): Spot | null | undefined {
  try {
    return parseAddress((params.path ?? []).map((s) => decodeURIComponent(s)));
  } catch {
    return undefined;
  }
}

/** The square's, a street's or a shop's title, description, address and H1. */
function pageFor(spot: Spot | null) {
  let title = "میدان بازار مجازی: نشانی مجازی مغازه‌ها | Virtual Bazaar";
  let description: string = PAGES.address.description;
  let url = "/vb";
  if (spot?.kind === "shop") {
    title = `${spot.shop.name} — ${BAZAAR_NAME.fa}`;
    description = `${ADDRESS_LABEL.fa}: ${addressText(spot.shop)}`;
    url = addressPath(spot.shop);
  } else if (spot?.kind === "street") {
    title = `${spot.street.name} — ${BAZAAR_NAME.fa}`;
    url = streetAddressPath(spot.street) ?? url;
  }
  const h1 = spot ? title : PAGES.address.h1;
  return { title, description, url, h1 };
}

export function generateMetadata({ params }: Props): Metadata {
  const spot = spotFrom(params);
  if (spot === undefined) return {};
  const { title, description, url } = pageFor(spot);
  // The share picture is the site's (lib/seo.ts SHARE_IMAGE) until the
  // Virtual Bazaar logo arrives (owner, 2026-10-30: "will provide a logo").
  // Only the square is indexed: a street's or shop's address shows the same 3D
  // scene, so it is reachable (follow) but not a search page of its own.
  const meta = indexable({ path: url, title, description });
  return spot ? { ...meta, robots: { index: false, follow: true } } : meta;
}

export default function VirtualAddressPage({ params }: Props) {
  const spot = spotFrom(params);
  if (spot === undefined) notFound();
  const page = pageFor(spot);
  return (
    <>
      <PageSeo h1={page.h1} path={page.url} title={page.title} description={page.description} />
      <VirtualBazaar initialSpot={spot ? spotParam(spot) : undefined} />
    </>
  );
}
