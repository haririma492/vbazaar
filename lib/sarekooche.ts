/**
 * Sarekooche, seen from VCA. VCA left the Sarekooche repo on 2026-10-15 for
 * olgoo.com; the shopping basket did not. A walk's product goes into the
 * Sarekooche basket by a link — `/basket?add=<line>` on sarekooche.com — where
 * the basket's own rules (meat first, members-only grocery) still decide.
 */

export const SAREKOOCHE_URL = (process.env.NEXT_PUBLIC_SAREKOOCHE_URL || "https://sarekooche.com").replace(/\/+$/, "");

/** A Sarekooche page by its path: `sarekoocheHref("/?open=meat-order")`. */
export function sarekoocheHref(path: string): string {
  return `${SAREKOOCHE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** A basket line as Sarekooche's `/api/shopping-list` takes it (its `ShoppingItemInput`, offer fields only). */
export type BasketLine = {
  id: string;
  kind: "offer";
  label: string;
  sub?: string;
  merchant?: string;
  price?: string;
  imageUrl?: string;
  href?: string;
};

/** `offer:<id>` — Sarekooche's `offerItemId`. A walk's lines are `offer:walk-…` (its `WALK_STORE_ID_PREFIX`). */
export function offerItemId(offerId: string): string {
  const clean = offerId.replace(/\s+/g, " ").trim().slice(0, 200);
  return clean ? `offer:${clean}` : "";
}

/** base64url of UTF-8 text, the same in the browser and on the server. */
export function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The link that puts this line in the Sarekooche basket. The line's own `href`
 * (back to the walk) is made absolute against `origin`, since the basket is on
 * another site.
 */
export function basketAddHref(line: BasketLine, origin: string): string {
  const href = line.href?.startsWith("/") ? `${origin.replace(/\/+$/, "")}${line.href}` : line.href;
  return sarekoocheHref(`/basket?add=${base64Url(JSON.stringify({ ...line, href }))}`);
}
