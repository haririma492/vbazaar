/**
 * THE BAZAAR'S PUBLIC DIRECTORY (owner, 2026-11-01: "how do we arrange
 * vbazaar.app main page"): the places shoppers can walk into (each from its
 * first area with a walk) and the published stores, each with its place.
 * Read from the private bazaar and store records; only what shoppers may see
 * leaves here: no store until «Publish», no place without a walk.
 */
import { r2Config } from "@/lib/splats/r2";
import { placeOfStore, startOf } from "./bazaar";
import { readBazaar, readIndex, readStore } from "./bucket";
import { hasShortAddress } from "./store";

export type DirPlace = { id: string; name: { en: string; fa: string }; walk: string; stores: number };
export type DirStore = { slug: string; name: { en: string; fa: string }; category: string; doorImage?: string; walk: string; place?: string };
export type Directory = { places: DirPlace[]; stores: DirStore[] };

export async function readDirectory(): Promise<Directory> {
  if (!r2Config().configured) return { places: [], stores: [] };
  try {
    const b = await readBazaar();
    const records = await Promise.all((await readIndex()).map((e) => readStore(e.slug)));
    const stores: DirStore[] = records
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.live && s.out.walk))
      .map((s) => ({
        slug: s.slug, name: s.name, category: s.category, walk: s.out.walk!,
        ...(s.out.doorImage ? { doorImage: s.out.doorImage } : {}),
        ...(placeOfStore(b, s.slug) ? { place: placeOfStore(b, s.slug) } : {}),
      }));
    const places: DirPlace[] = b.places.flatMap((p) => {
      const start = startOf(b, p.id);
      return start?.walk ? [{ id: p.id, name: p.name, walk: start.walk, stores: stores.filter((s) => s.place === p.id).length }] : [];
    });
    return { places, stores };
  } catch {
    return { places: [], stores: [] };
  }
}

/**
 * THE TOURS PAGE'S STORES (owner, 2026-11-10): every store with a walk that is published OR switched onto the tours
 * page by the operator. These are the stores with a short address (/walk/<slug>). The bazaar's own directory above
 * stays published stores only.
 */
export async function readTourStores(): Promise<DirStore[]> {
  if (!r2Config().configured) return [];
  try {
    const records = await Promise.all((await readIndex()).map((e) => readStore(e.slug)));
    return records
      .filter((s): s is NonNullable<typeof s> => Boolean(s && hasShortAddress(s)))
      .map((s) => ({ slug: s.slug, name: s.name, category: s.category, walk: s.out.walk!, ...(s.out.doorImage ? { doorImage: s.out.doorImage } : {}) }));
  } catch {
    return [];
  }
}

export const walkHref = (walk: string) => `/vca/walk?v=${encodeURIComponent(walk)}`;
