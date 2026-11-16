// A SHELF'S KIT — the rules of the pastry redesign (owner, 2026-11-15: "moving from a full virtual walk with odd and
// confusing looking labels and green circles on items into a model that, while real shopping experience is there,
// we bring in solid e-commerce features that are in place for 30 years; the bridge between the two is our lower 23%
// of the screen, the tray"). Pure; tested (`kitRules.test.ts`). The job is `kit.ts`, the shopper's copy
// `/api/kit/<slug>`.
//
// For each shelf the operator bordered on the walk (4 corners, `Walk.zooms`), the operator uploads:
//   Type III  the shelf's quality photo, taken square-on (or straight down for a pallet): its corners ARE the border's;
//   Type IV   3–5 photos of its sections (levels), extremely good: shown as uploaded, never re-encoded;
//   products  each product of a section, its own photo (cut by the operator, not by code);
//   Type V    the store's website products (the Website Explorer): each product photo is matched to one, which
//             gives its name, price and a second photo. Not matched: one photo, no price yet.
//
// FILE NAMES (owner, 2026-11-15: "you come up with a sensible convention"): drop a whole store's photos at once and
// each finds its place.
//   shelf-03.jpg          the whole shelf 3 (Type III)
//   shelf-03-2.jpg        section 2 of shelf 3 (Type IV), sections numbered top to bottom, then left to right
//   shelf-03-2-p1.jpg     product 1 of that section
// The number is the one the operator gave the shelf when drawing its border. Any other name: chosen on the card.
import type { Unit } from "@/lib/splats/catalogue";

export const MAX_SECTIONS = 5;
export const MAX_KIT_PRODUCTS = 24;
/** Website products one section may list. */
export const MAX_SECTION_ITEMS = 60;
export const KIT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** A photo as uploaded (private, `key`) and its public copy, byte for byte (`url`), with a small one for lists. */
export type KitPhoto = { key: string; name: string; size: number; at: string; url?: string; thumb?: string; w?: number; h?: number };
/** Which website product (its `web` key in the catalogue) a product photo is; by the matcher or the operator. */
export type KitMatch = { web: string | null; confidence: number; why: string; by: "auto" | "operator"; at: string };
export type KitProduct = { id: string; i: number; photo: KitPhoto; match?: KitMatch };
/** Where the section is in the shelf's photo: four corners (TL TR BR BL) as fractions of it; `sig` what was matched. */
export type KitPlace = { quad: number[] | null; by: "auto" | "hand"; note: string; sig: string };
/** `items`: the store's website products the operator assigned to this section (their `web` keys, in the order chosen;
 *  owner, 2026-11-16): what the shopping panel lists when a shopper taps the section. */
export type KitSection = { id: string; i: number; photo: KitPhoto; place?: KitPlace; products: KitProduct[]; items?: string[] };
/** `id` is the shelf's id on the walk (its `WalkZoom`); `n` its number then. */
export type KitShelf = { id: string; n?: number; photo?: KitPhoto; sections: KitSection[] };
export type Kit = { store: string; shelves: KitShelf[]; updated: string };

export const emptyKit = (store: string): Kit => ({ store, shelves: [], updated: "" });

// ── What shoppers get (`/api/kit/<slug>`) ──
export type ShopProduct = {
  id: string; photo: string; thumb: string; more: string[];
  en: string; fa: string; priceCents: number | null; unit: Unit; note?: string;
};
export type ShopSection = { id: string; i: number; url: string; thumb: string; w: number; h: number; quad: number[] | null; products: ShopProduct[] };
export type ShopShelf = {
  id: string; n?: number; label: { en: string; fa: string };
  photo: { url: string; thumb: string; w: number; h: number } | null;
  sections: ShopSection[];
  /** The border on the walk, step by step (the walk's units). */
  outline: Array<{ t: number; c: number[] }>;
};
export type ShopKit = { store: string; walk: string | null; /** The walk's address for share links (short when the store has one). */ link: string | null; title: { en: string; fa: string } | null; merchant: string; shelves: ShopShelf[] };

/** The store's tours are the new ones once at least one shelf has its photo and a section (owner: "stays the same
 *  until operator go to store page and upload TYPE III, IV & Vs"). */
export const kitReady = (k: { shelves: Array<{ photo: unknown; sections: unknown[] }> } | null | undefined) =>
  Boolean(k?.shelves.some((s) => s.photo && s.sections.length));

/** What a file's name says it is (the convention above), or null. */
export function parseKitName(name: string): { n: number; section?: number; product?: number } | null {
  const m = /^shelf[-_ ]?0*(\d{1,3})(?:[-_ ]0*(\d{1,2})(?:[-_ ]?p0*(\d{1,3}))?)?\.(?:jpe?g|png|webp)$/i.exec(name.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  const out: { n: number; section?: number; product?: number } = { n };
  if (m[2] !== undefined) { out.section = Number(m[2]); if (!out.section || out.section > MAX_SECTIONS) return null; }
  if (m[3] !== undefined) { out.product = Number(m[3]); if (!out.product || out.product > MAX_KIT_PRODUCTS) return null; }
  return out;
}
export const kitFileName = (n: number, section?: number, product?: number) =>
  `shelf-${String(n).padStart(2, "0")}${section ? `-${section}` : ""}${section && product ? `-p${product}` : ""}.jpg`;

export function checkKitName(name: string): string | null {
  return /\.(jpe?g|png|webp)$/i.test(name) ? null : "A shelf's photo is .jpg, .png or .webp, at full size. · عکس باید jpg یا png یا webp باشد.";
}

/** Where an upload goes: the shelf (Type III), a section (Type IV) or a product of a section. */
export type KitSlot = { shelf: string; section?: number; product?: number };

/** The kit with `photo` in `slot` (one already there is replaced). Null with why, when the slot cannot take it. */
export function putPhoto(kit: Kit, slot: KitSlot, photo: KitPhoto, n?: number): { kit: Kit } | { error: string } {
  const shelves = [...kit.shelves];
  let k = shelves.findIndex((s) => s.id === slot.shelf);
  if (k < 0) { shelves.push({ id: slot.shelf, ...(n !== undefined ? { n } : {}), sections: [] }); k = shelves.length - 1; }
  const shelf: KitShelf = { ...shelves[k], ...(n !== undefined ? { n } : {}), sections: [...shelves[k].sections] };
  if (slot.section === undefined) {
    shelf.photo = photo;
    // A new shelf photo: every section is placed in it again.
    shelf.sections = shelf.sections.map((x) => ({ ...x, place: x.place?.by === "hand" ? x.place : undefined }));
  } else {
    const i = slot.section;
    if (!Number.isInteger(i) || i < 1 || i > MAX_SECTIONS) return { error: `A shelf has sections 1 to ${MAX_SECTIONS}.` };
    let s = shelf.sections.findIndex((x) => x.i === i);
    if (slot.product === undefined) {
      const sec: KitSection = s >= 0 ? { ...shelf.sections[s], photo, place: undefined } : { id: `${slot.shelf}-${i}`, i, photo, products: [] };
      if (s >= 0) shelf.sections[s] = sec; else shelf.sections.push(sec);
    } else {
      if (s < 0) return { error: `Upload section ${i}'s photo first, then its products. · اول عکس بخش ${i}` };
      const j = slot.product;
      if (!Number.isInteger(j) || j < 1 || j > MAX_KIT_PRODUCTS) return { error: `A section has products 1 to ${MAX_KIT_PRODUCTS}.` };
      const sec = { ...shelf.sections[s], products: [...shelf.sections[s].products] };
      const p = sec.products.findIndex((x) => x.i === j);
      // A new photo of the product is matched again.
      const prod: KitProduct = { id: `${sec.id}-p${j}`, i: j, photo, ...(p >= 0 && sec.products[p].match?.by === "operator" ? { match: sec.products[p].match } : {}) };
      if (p >= 0) sec.products[p] = prod; else sec.products.push(prod);
      sec.products.sort((a, b) => a.i - b.i);
      shelf.sections[s] = sec;
      s = -1;
    }
    shelf.sections.sort((a, b) => a.i - b.i);
  }
  shelves[k] = shelf;
  return { kit: { ...kit, shelves, updated: new Date().toISOString() } };
}

/** The next free number in a list (1, 2, …). */
export function nextFree(used: number[], max: number): number | null {
  for (let i = 1; i <= max; i++) if (!used.includes(i)) return i;
  return null;
}

/** The kit with one thing taken away: a shelf's whole kit, a section (with its products), or one product. */
export function removeFromKit(kit: Kit, slot: KitSlot): Kit {
  const shelves = kit.shelves.flatMap((s): KitShelf[] => {
    if (s.id !== slot.shelf) return [s];
    if (slot.section === undefined) return [];
    return [{
      ...s, sections: s.sections.flatMap((x): KitSection[] => {
        if (x.i !== slot.section) return [x];
        if (slot.product === undefined) return [];
        return [{ ...x, products: x.products.filter((p) => p.i !== slot.product) }];
      }),
    }];
  });
  return { ...kit, shelves, updated: new Date().toISOString() };
}

/** The operator's choice of website product for a product photo (null: "not on the website"). */
export function setMatch(kit: Kit, productId: string, web: string | null, now = new Date()): Kit {
  return {
    ...kit, updated: now.toISOString(),
    shelves: kit.shelves.map((s) => ({
      ...s, sections: s.sections.map((x) => ({
        ...x, products: x.products.map((p) => (p.id === productId ? { ...p, match: { web, confidence: 1, why: "chosen by the operator", by: "operator" as const, at: now.toISOString() } } : p)),
      })),
    })),
  };
}

/**
 * THE WEBSITE'S PRODUCTS ON A SECTION (owner, 2026-11-16: "after uploading type IV for a shelf, let the operator search
 * in all DB of items pulled from web site and assign one or few to that shelf level so as soon as user click on that
 * shelf level the e-commerce product list panel on the right will be populated with the right set of products ready to
 * be added to basket"). `webs`: the website products' keys, in order; repeats and empty ones dropped, at most
 * `MAX_SECTION_ITEMS`. `known`: the keys the store's list holds (an unknown one is left out).
 */
export function setItems(kit: Kit, sectionId: string, webs: string[], known: Set<string>): Kit {
  const clean = [...new Set(webs.map((w) => String(w).trim()).filter((w) => w && known.has(w)))].slice(0, MAX_SECTION_ITEMS);
  return {
    ...kit, updated: new Date().toISOString(),
    shelves: kit.shelves.map((s) => ({ ...s, sections: s.sections.map((x) => (x.id === sectionId ? { ...x, items: clean } : x)) })),
  };
}

/** A section's place drawn by the operator on the shelf's photo (4 corners as fractions), or null to look again. */
export function setPlace(kit: Kit, sectionId: string, quad: number[] | null): Kit {
  const q = quad && quad.length === 8 && quad.every((v) => Number.isFinite(v)) ? quad.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4) : null;
  return {
    ...kit, updated: new Date().toISOString(),
    shelves: kit.shelves.map((s) => ({ ...s, sections: s.sections.map((x) => (x.id === sectionId ? { ...x, place: q ? { quad: q, by: "hand" as const, note: "drawn by the operator", sig: x.photo.key } : undefined } : x)) })),
  };
}

/** The sections whose place is to be found (never looked, or the shelf's or the section's photo changed). */
export function toPlace(kit: Kit): Array<{ shelf: KitShelf; section: KitSection }> {
  return kit.shelves.flatMap((shelf) => (shelf.photo ? shelf.sections.filter((x) => !x.place || (x.place.by === "auto" && x.place.sig !== placeSig(shelf, x))).map((section) => ({ shelf, section })) : []));
}
export const placeSig = (shelf: KitShelf, x: KitSection) => `${shelf.photo?.key ?? ""}|${x.photo.key}`;

/** The product photos still to be matched to the website. */
export const toMatch = (kit: Kit) => kit.shelves.flatMap((s) => s.sections.flatMap((x) => x.products.filter((p) => !p.match)));

/**
 * THE SHELF THE TRAY SHOWS (owner: "as the top view pass that shelf reaching the next shelf (more than 50% of screen
 * is already showing the next shelf) then very smoothly the tray moves showing photo type IVs of the next shelf").
 * `covers`: how much of the screen each shelf in view covers (0–1). The tray keeps its shelf until another one holds
 * more than half of what is on screen of shelves; with no shelf in view it keeps the one it has (it loops on).
 */
export function trayShelf(current: string | null, covers: Array<{ id: string; cover: number }>): string | null {
  const seen = covers.filter((c) => c.cover > 0.002);
  const total = seen.reduce((s, c) => s + c.cover, 0);
  if (!total) return current;
  const best = seen.reduce((a, b) => (b.cover > a.cover ? b : a));
  if (best.id === current) return current;
  if (current === null) return best.id;
  return best.cover / total > 0.5 ? best.id : current;
}

/** How much of a w×h screen the polygon `pts` (screen pixels) covers, 0–1 (clipped to the screen). */
export function coverOf(pts: Array<[number, number]>, w: number, h: number): number {
  if (pts.length < 3 || w <= 0 || h <= 0) return 0;
  let poly = pts;
  const clip = (inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    poly = out;
  };
  const atX = (x: number) => (a: [number, number], b: [number, number]): [number, number] => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const atY = (y: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  clip((p) => p[0] >= 0, atX(0)); if (poly.length < 3) return 0;
  clip((p) => p[0] <= w, atX(w)); if (poly.length < 3) return 0;
  clip((p) => p[1] >= 0, atY(0)); if (poly.length < 3) return 0;
  clip((p) => p[1] <= h, atY(h)); if (poly.length < 3) return 0;
  const a = Math.abs(poly.reduce((s, p, i) => { const o = poly[(i + 1) % poly.length]; return s + p[0] * o[1] - o[0] * p[1]; }, 0)) / 2;
  return Math.min(1, a / (w * h));
}

/** The middle moment a shelf is in view (where «go back to it» walks to), or null. */
export function shelfMoment(outline: Array<{ t: number }>): number | null {
  if (!outline.length) return null;
  return (outline[0].t + outline[outline.length - 1].t) / 2;
}

/** A section's place is believable: four corners inside the photo, turning one way, not a sliver. */
export function saneQuad(q: number[] | null | undefined): q is number[] {
  if (!q || q.length !== 8 || !q.every((v) => Number.isFinite(v) && v >= -0.05 && v <= 1.05)) return false;
  const p = [0, 1, 2, 3].map((k) => [q[k * 2], q[k * 2 + 1]]);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!z) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  const area = Math.abs(p.reduce((s, a, i) => { const o = p[(i + 1) % 4]; return s + a[0] * o[1] - o[0] * a[1]; }, 0)) / 2;
  return area > 0.003;
}

// ── SHARE LINKS (owner, 2026-11-15: "while no download should be allowed, share key should be almost everywhere, on
// shelf (e-commerce shelf - not walk your shelf), on shelf level (Type IV) and on products (type V) and receivers
// should end up exactly on the same spot on walking tour and the same photo should be made open") ──
// The link is the store's walk (`ShopKit.link`: its short address when it has one) with `shelf`, `section` (its
// number) and `product` (its id). The Free Tour opening such a link walks to the shelf, stops facing it, and opens
// the shelf's photo, the section's photo and panel, or the section's panel with that product shown.
export type KitShare = { shelf: string; section?: number; product?: string };

/** The address a share key hands out. */
export function kitShareLink(base: string, to: KitShare): string {
  const u = new URL(base, "https://vbazaar.app");
  u.searchParams.set("shelf", to.shelf);
  if (to.section !== undefined) u.searchParams.set("section", String(to.section));
  if (to.product) u.searchParams.set("product", to.product);
  return /^https?:/.test(base) ? u.toString() : `${u.pathname}${u.search}`;
}

/** What a walk address asks to open, or null (a part that is not well formed is left out; no shelf: nothing). */
export function readKitShare(q: { get(name: string): string | null }): KitShare | null {
  const shelf = q.get("shelf");
  if (!shelf || !KIT_ID_RE.test(shelf)) return null;
  const sec = Number(q.get("section"));
  const product = q.get("product");
  return {
    shelf,
    ...(Number.isInteger(sec) && sec >= 1 && sec <= MAX_SECTIONS ? { section: sec } : {}),
    ...(product && KIT_ID_RE.test(product) ? { product } : {}),
  };
}

/** The section a share asks for (its own number, or the section holding the product), or null for the whole shelf. */
export function sharedSection<S extends { i: number; products: Array<{ id: string }> }>(sections: S[], to: KitShare): S | null {
  if (to.product) { const s = sections.find((x) => x.products.some((p) => p.id === to.product)); if (s) return s; }
  return to.section !== undefined ? sections.find((x) => x.i === to.section) ?? null : null;
}

/** A whole shelf as one panel (a shared shelf link): its own photo, every section's products, section number 0. */
export function wholeShelf(sh: ShopShelf): ShopSection | null {
  if (!sh.photo) return null;
  return { id: `${sh.id}-all`, i: 0, url: sh.photo.url, thumb: sh.photo.thumb, w: sh.photo.w, h: sh.photo.h, quad: null, products: sh.sections.flatMap((x) => x.products) };
}

/**
 * THE TRAY CHANGES SHELF WHEN THE WALK'S MIDDLE PASSES THE NEXT SHELF'S MIDDLE (owner, 2026-11-16: "when center of
 * moving tour is past the center of the next shelf then the bottom tray will change to the next set of sections …
 * smooth … in the direction of move of the tour and the old set of sections will move away from the other side").
 * `prev`: each shelf's middle on the screen last frame (x, pixels); `now`: this frame's; `mid`: the screen's middle.
 * A shelf other than the tray's whose middle crossed the screen's middle since last frame becomes the tray's; so does
 * one sitting at the middle (within `near` px) while the tray's shelf is not on screen at all (a jump, a turn).
 * `dir` is which way the picture moved: -1 leftward (the new set comes in from the right, the old leaves left),
 * +1 rightward. Null: the tray keeps its shelf.
 */
export function trayCross(cur: string | null, prev: Map<string, number>, now: Array<{ id: string; x: number }>, mid: number, near = 40): { id: string; dir: 1 | -1 } | null {
  for (const s of now) {
    if (s.id === cur) continue;
    const p = prev.get(s.id);
    if (p !== undefined && (p - mid) * (s.x - mid) <= 0 && p !== s.x) return { id: s.id, dir: s.x < p ? -1 : 1 };
  }
  if (cur === null || !now.some((s) => s.id === cur)) {
    const c = now.filter((s) => s.id !== cur && Math.abs(s.x - mid) <= near).sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid))[0];
    if (c) { const p = prev.get(c.id); return { id: c.id, dir: p !== undefined && c.x > p ? 1 : -1 }; }
  }
  return null;
}

/** How many products a section will list in the panel: the website products picked for it, and the photos from the
 *  operator's computer that are not one of those. */
export function sectionProductCount(x: { items?: string[]; products: Array<{ match?: { web: string | null } }> }): number {
  const items = x.items ?? [];
  return items.length + x.products.filter((p) => !(p.match?.web && items.includes(p.match.web))).length;
}
/** The sections of a shelf with no products yet (their numbers): shoppers tapping one would see an empty list
 *  (owner, 2026-11-16: "ensure all sections do have products loaded or identified from web"). */
export const emptySections = (sections: Array<{ i: number; items?: string[]; products: Array<{ match?: { web: string | null } }> }>) =>
  sections.filter((x) => sectionProductCount(x) === 0).map((x) => x.i);
