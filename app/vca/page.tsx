import type { Metadata } from "next";
import { PAGES, indexable } from "@/lib/seo";
import PageSeo from "@/components/seo/PageSeo";
import VirtualBazaar from "@/components/virtual-bazaar/VirtualBazaar";

// `/vca` — the Virtual Bazaar: a Three.js square with six «راسته»s, the food
// street and its Sarekooche shops. Standalone on purpose — nothing links here
// yet, and the home page is untouched. Earlier addresses, `/virtual-bazaar`
// and then `/vbazaar` (both 2026-09-27), redirect here. A shop's own address
// is `/vb/…` (`app/vb`).
export const metadata: Metadata = indexable(PAGES.bazaar3d);

export default function VirtualBazaarPage() {
  return (
    <>
      <PageSeo {...PAGES.bazaar3d} />
      <VirtualBazaar />
    </>
  );
}
