/**
 * THE VIRTUAL BAZAAR'S OWN BASKET (owner, 2026-11-03: "when adding to basket,
 * create a vbazaar.app basket, now it goes to sarekooche"). A walk's product
 * used to open sarekooche.com/basket in a new tab; now «Add to basket» keeps
 * it here, on this device, and `/basket` lists it by store.
 *
 * Kept on the device (localStorage), like any shop's basket before sign-in.
 * No payment yet (the basket is the end of the cycle, CLAUDE.md). This module
 * is pure (tested in `basket.test.ts`); `components/basket/useBasket.ts` is
 * the browser half.
 */

/** One line: the same fields the walk already builds (`itemLine`), plus how many. */
export type BasketLine = {
  /** Unique per product (and weight): adding it again adds to `qty`. */
  id: string;
  label: string;
  sub?: string;
  /** The store's name: the basket lists lines under it. */
  merchant?: string;
  /** As shown, e.g. "$12.99" (per line, for one). */
  price?: string;
  imageUrl?: string;
  /** Back to where it was picked up (a walk). */
  href?: string;
  qty: number;
  /** When it was first added (ISO). */
  at: string;
};

export const BASKET_KEY = "vbazaar-basket";
/** The offline demo kept its basket under this key before; it is folded in once. */
export const OLD_OFFLINE_KEY = "offline-basket";
export const MAX_QTY = 99;
export const MAX_LINES = 200;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** A link a shopper may follow: our own path or http(s), never `javascript:` and the like. */
const safeHref = (v: unknown) => {
  const s = str(v, 600);
  return s.startsWith("/") && !s.startsWith("//") ? s : /^https?:\/\//i.test(s) ? s : "";
};

/** A stored or incoming line made safe; null when it is not a line at all. */
export function cleanLine(v: unknown, now = new Date()): BasketLine | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 220), label = str(r.label, 200);
  if (!id || !label) return null;
  const q = typeof r.qty === "number" && Number.isFinite(r.qty) ? Math.round(r.qty) : 1;
  const line: BasketLine = { id, label, qty: Math.min(MAX_QTY, Math.max(1, q)), at: str(r.at, 40) || now.toISOString() };
  const sub = str(r.sub, 200), merchant = str(r.merchant, 120), price = str(r.price, 40);
  const imageUrl = safeHref(r.imageUrl), href = safeHref(r.href);
  if (sub) line.sub = sub;
  if (merchant) line.merchant = merchant;
  if (price) line.price = price;
  if (imageUrl) line.imageUrl = imageUrl;
  if (href) line.href = href;
  return line;
}

/** Stored text → lines (anything malformed dropped; the same id folded into one line). */
export function parseBasket(text: string | null): BasketLine[] {
  let raw: unknown;
  try { raw = JSON.parse(text ?? "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  // Stored order kept (newest first, as `addLine` writes it); the same id folded into its first line.
  const out: BasketLine[] = [];
  for (const v of raw) {
    const l = cleanLine(v);
    if (!l) continue;
    const same = out.find((x) => x.id === l.id);
    if (same) same.qty = Math.min(MAX_QTY, same.qty + l.qty);
    else if (out.length < MAX_LINES) out.push(l);
  }
  return out;
}

/** `line` added `qty` times: to its own line when already there (the newest at the top otherwise). */
export function addLine(lines: BasketLine[], line: Omit<BasketLine, "qty" | "at"> & Partial<Pick<BasketLine, "at">>, qty = 1, now = new Date()): BasketLine[] {
  const i = lines.findIndex((l) => l.id === line.id);
  if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l));
  const clean = cleanLine({ ...line, qty, at: line.at ?? now.toISOString() }, now);
  if (!clean || lines.length >= MAX_LINES) return lines;
  return [clean, ...lines];
}

/** How many of a line; 0 takes it out. */
export function setQty(lines: BasketLine[], id: string, qty: number): BasketLine[] {
  if (qty <= 0) return lines.filter((l) => l.id !== id);
  return lines.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, Math.round(qty)) } : l));
}

/** Items in the basket (each line counted by how many). */
export const countOf = (lines: BasketLine[]) => lines.reduce((n, l) => n + l.qty, 0);

/** "$12.99", "12.99 $", "CA$12.99" → cents; null when there is no price to add up. */
export function priceCents(price: string | undefined): number | null {
  if (!price) return null;
  const m = /(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)/.exec(price.replace(/\s/g, ""));
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type StoreGroup = {
  merchant: string;
  lines: BasketLine[];
  /** The lines with a price, added up. */
  cents: number;
  /** Lines with no price: the store says what they cost. */
  unpriced: number;
};

/** The basket by store, in the order each store was first added to, with each store's total. */
export function byStore(lines: BasketLine[], unnamed = "—"): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const l of [...lines].reverse()) {
    const name = l.merchant || unnamed;
    const g = groups.get(name) ?? { merchant: name, lines: [], cents: 0, unpriced: 0 };
    g.lines.unshift(l);
    const c = priceCents(l.price);
    if (c === null) g.unpriced += 1;
    else g.cents += c * l.qty;
    groups.set(name, g);
  }
  return [...groups.values()];
}
