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
export const storeWalkPath = (slug: string) => `/${slug}/vtour1.mp4`;

/**
 * ⚠️ THE STORE'S TOUR ADDRESS IS NOW /<store>/vtour1.mp4 (owner, 2026-11-17: "make this link URL to be sensible
 * https://vbazaar.app/vca/walk?v=scenes%2Fstore-nuttime%2Fwalk-20261116-053157.mp4 e.g.
 * https://vbazaar.app/nuttime/vtour1.mp4"): `app/[store]/[tour]/page.tsx`, for every store with a walk; `vtour1` is its
 * Free Tour, `.mp4` may be left off. The older /walk/<store> is sent on to it.
 */
export const TOUR_PATH_RE = /^\/([a-z0-9][a-z0-9-]{0,62})\/vtour1(?:\.mp4)?$/i;
/** Is this page address a store's short tour address (the new one, or the older /walk/<store>)? */
export const isShortWalkPath = (path: string) => TOUR_PATH_RE.test(path) || /^\/walk\/[^/]+$/.test(path);

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
