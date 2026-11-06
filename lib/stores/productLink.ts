// A LINK THAT OPENS A STORE'S WALK AT ONE PRODUCT (owner, 2026-11-06: the Instagram pathway). /vca/walk?v=<walk>&p=<n>
// lands facing that product's light with its card open, «Add to basket» ready. Used in a Story link sticker, the bio,
// a DM. Pure; imports nothing.

export const SITE = "https://vbazaar.app";

export function productLink(walkKey: string, n: number, origin = SITE): string {
  return `${origin}/vca/walk?v=${encodeURIComponent(walkKey)}&p=${n}`;
}

/** The store's walk from its door: the link for the bio and the Reel's caption. */
export function walkLink(walkKey: string, origin = SITE): string {
  return `${origin}/vca/walk?v=${encodeURIComponent(walkKey)}`;
}

/** `p` from a walk address: a product number 1–9999, or null. */
export function productParam(v: string | null): number | null {
  if (!v || !/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 ? n : null;
}
