// A LINK THAT OPENS A STORE'S WALK AT ONE PRODUCT (owner, 2026-11-06: the Instagram pathway). /vca/walk?v=<walk>&p=<n>
// lands facing that product's light with its card open, «Add to basket» ready. Used in a Story link sticker, the bio,
// a DM. Pure; imports nothing.

export const SITE = "https://vbazaar.app";

/**
 * A PUBLISHED STORE'S SHORT ADDRESS (owner, 2026-11-10: "change these URLs to one that is sensible … e.g.
 * vbazaar.app/walk/saraye-bamdad"): /walk/<slug> opens the store's walk as it is today, so the link also outlives a
 * new video. Only a published store has it (an unpublished one's slug must not open its walk); the long address
 * with the video's key keeps working for every walk.
 */
export const storeWalkPath = (slug: string) => `/walk/${slug}`;

/** With `slug` (a published store): the short address. */
export function productLink(walkKey: string, n: number, origin = SITE, slug?: string): string {
  return slug ? `${origin}${storeWalkPath(slug)}?p=${n}` : `${origin}/vca/walk?v=${encodeURIComponent(walkKey)}&p=${n}`;
}

/** The store's walk from its door: the link for the bio and the Reel's caption. With `slug` (a published store): the short address. */
export function walkLink(walkKey: string, origin = SITE, slug?: string): string {
  return slug ? `${origin}${storeWalkPath(slug)}` : `${origin}/vca/walk?v=${encodeURIComponent(walkKey)}`;
}

/** `p` from a walk address: a product number 1–9999, or null. */
export function productParam(v: string | null): number | null {
  if (!v || !/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 ? n : null;
}
