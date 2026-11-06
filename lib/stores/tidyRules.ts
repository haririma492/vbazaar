/**
 * THE TIDY AGENT'S RULES (owner, 2026-11-06: "sometimes there are objects on the scene that need to be removed or
 * replaced with some product photo: e.g. an ugly old chair, someone's sweater on the desk, some paper or stuff just
 * siting there … replace them with some products that are on a software made place or the original table where the
 * stuff was so they are not hanging in the air"). Pure and tested (`tidyRules.test.ts`); the job is `tidy.ts`.
 *
 *   plan      which moments of the store's walk are looked at: from the door on, one every `TIDY_EVERY` s,
 *             spaced out so the whole walk fits the run's ceiling (`tidyPlan`)
 *   group     each junk sighting is followed through the walk (as a product's light is); two follows that run
 *             through the same spot at the same moment are one object (`groupJunk`)
 *   pick      which store product stands in each one's place (`pickProducts`)
 *   draw      how the cover is drawn: the stand under the product, by what the junk stood on (`coverLayout`)
 */
import type { CoverBase, ItemPin } from "@/lib/splats/walks";
import type { Product } from "@/lib/splats/catalogue";
import { HEADINGS, LOOK_FOV, type Look } from "./tagging";

/** A run's ceiling (cents), from the store's own budget: about 3 cents a moment looked at. */
export const TIDY_CENTS = 200;
export const MOMENT_CENTS = 3.5;
/** One moment every this many seconds, at most. */
export const TIDY_EVERY = 4;
/** The views: six round the camera, looking a little down (tables, desks and the floor near the shelves). */
export const TIDY_PITCH = -0.22;
/** Claude's boxes below this are not trusted; ones too small or too big to be one object are not covered. */
export const MIN_CONFIDENCE = 0.7;
export const MIN_SIZE = 0.03, MAX_SIZE = 0.9;
/** At most this many objects covered on one walk. */
export const MAX_COVERS = 40;

/** The moments and views looked at, for a walk `seconds` long, from `from` s (the door). */
export function tidyPlan(seconds: number, from = 0, cents = TIDY_CENTS): Array<{ t: number; looks: Look[] }> {
  const start = from > 0 && from < seconds - 1 ? from + 0.5 : 0.5;
  const span = Math.max(0, seconds - 0.3 - start);
  const most = Math.max(1, Math.floor(cents / MOMENT_CENTS));
  const step = Math.max(TIDY_EVERY, span / most);
  const out: Array<{ t: number; looks: Look[] }> = [];
  for (let t = start; t < seconds - 0.3 && out.length < most; t += step) {
    const tt = Math.round(t * 100) / 100;
    out.push({ t: tt, looks: HEADINGS.map((heading, i) => ({ t: tt, heading, pitch: TIDY_PITCH, fov: LOOK_FOV, id: `${tt}s-${i * 60}deg` })) });
  }
  return out;
}

/** One object seen once (its middle and outline in radians), and how sure Claude was. */
export type JunkSeen = { t: number; lon: number; lat: number; size: { w: number; h: number }; what: string; base: CoverBase; confidence: number };
/** A sighting followed through the walk. */
export type JunkTrack = JunkSeen & { pins: ItemPin[] };
/** One object: every follow of it joined. */
export type Junk = JunkTrack & { seen: number };

/** A box is worth covering: sure enough, and the size of one thing (not a speck, not half the room). */
export function worthCovering(s: Pick<JunkSeen, "size" | "confidence">): boolean {
  const big = Math.max(s.size.w, s.size.h);
  return s.confidence >= MIN_CONFIDENCE && big >= MIN_SIZE && s.size.w <= MAX_SIZE && s.size.h <= MAX_SIZE;
}

const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Where a follow is at `t` (its nearest pin within 0.15 s), or null. */
function at(pins: ItemPin[], t: number): ItemPin | null {
  let best: ItemPin | null = null;
  for (const p of pins) if (Math.abs(p.t - t) <= 0.15 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
  return best;
}

/** Two follows are one object when, at a moment both have, they are within half the object's size of each other. */
export function sameObject(a: JunkTrack, b: JunkTrack): boolean {
  const reach = Math.max(a.size.w, a.size.h, b.size.w, b.size.h) / 2;
  for (const p of a.pins) {
    const q = at(b.pins, p.t);
    if (q && Math.hypot(angle(p.x, q.x) * Math.cos(p.y), p.y - q.y) <= reach) return true;
  }
  return false;
}

/** Pins joined: every moment either has; the two averaged where both have one. */
function join(a: ItemPin[], b: ItemPin[]): ItemPin[] {
  const by = new Map<number, ItemPin[]>();
  for (const p of [...a, ...b]) { const k = Math.round(p.t * 100); by.set(k, [...(by.get(k) ?? []), p]); }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return [...by.values()].map((ps) => {
    if (ps.length === 1) return ps[0];
    const x0 = ps[0].x;
    const dx = ps.reduce((s, p) => s + Math.atan2(Math.sin(p.x - x0), Math.cos(p.x - x0)), 0) / ps.length;
    return { t: ps[0].t, x: r3(Math.atan2(Math.sin(x0 + dx), Math.cos(x0 + dx))), y: r3(ps.reduce((s, p) => s + p.y, 0) / ps.length) };
  }).sort((p, q) => p.t - q.t);
}

/** At most `max` pins, evenly kept (the walk's file keeps 200 a cover). */
export function thinPins(pins: ItemPin[], max = 200): ItemPin[] {
  if (pins.length <= max) return pins;
  const out: ItemPin[] = [];
  for (let i = 0; i < max; i++) out.push(pins[Math.round((i * (pins.length - 1)) / (max - 1))]);
  return out;
}

/**
 * The follows grouped into objects. Within one: the pins joined, the largest outline kept (a cover a little too big
 * hides everything; one too small lets the junk show), and the name and base of its surest sighting.
 */
export function groupJunk(tracks: JunkTrack[], minPins = 3): Junk[] {
  const ok = tracks.filter((t) => t.pins.length >= minPins && worthCovering(t));
  const parent = ok.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) if (sameObject(ok[i], ok[j])) parent[root(j)] = root(i);
  const groups = new Map<number, JunkTrack[]>();
  ok.forEach((t, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), t]));
  const out: Junk[] = [];
  for (const g of groups.values()) {
    const sure = [...g].sort((a, b) => b.confidence - a.confidence)[0];
    let pins: ItemPin[] = [];
    for (const t of g) pins = join(pins, t.pins);
    out.push({
      ...sure, pins: thinPins(pins), seen: g.length,
      size: { w: Math.max(...g.map((t) => t.size.w)), h: Math.max(...g.map((t) => t.size.h)) },
    });
  }
  // The longest-seen first: those are the ones shoppers would notice.
  return out.sort((a, b) => b.pins.length - a.pins.length).slice(0, MAX_COVERS);
}

/**
 * The products to stand in the junk's places: ones with a photo, priced ones first, the store's own photos (its
 * sheet or website) before ones cut out of the video; each used once before any twice. `used` are the products
 * other covers already show.
 */
export function pickProducts(products: Product[], count: number, used: number[] = []): number[] {
  const withPhoto = products.filter((p) => p.photo);
  if (!withPhoto.length || count <= 0) return [];
  const rank = (p: Product) => (p.priceCents !== null ? 0 : 2) + (p.by === "video" ? 1 : 0);
  const order = [...withPhoto].sort((a, b) => rank(a) - rank(b) || a.n - b.n);
  const uses = new Map<number, number>();
  for (const n of used) uses.set(n, (uses.get(n) ?? 0) + 1);
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const p = [...order].sort((a, b) => (uses.get(a.n) ?? 0) - (uses.get(b.n) ?? 0))[0];
    out.push(p.n);
    uses.set(p.n, (uses.get(p.n) ?? 0) + 1);
  }
  return out;
}

/**
 * How a cover is drawn, in pixels of a `W`-wide picture shaped like the cover: a stand at the bottom (a low riser
 * on a table or counter, a plinth on the floor, none on a wall) and a white card with the product's photo above it,
 * filling the rest, so nothing of the junk shows through.
 */
export function coverLayout(cover: { w: number; h: number }, base: CoverBase, W = 512) {
  const H = Math.max(96, Math.min(1536, Math.round((W * cover.h) / Math.max(0.001, cover.w))));
  const stand = Math.round(H * (base === "floor" ? 0.45 : base === "table" ? 0.16 : 0));
  const card = { x: Math.round(W * 0.03), y: 0, w: W - 2 * Math.round(W * 0.03), h: H - stand };
  const pad = Math.max(4, Math.round(Math.min(card.w, card.h) * 0.05));
  const photo = { x: card.x + pad, y: card.y + pad, w: Math.max(2, card.w - 2 * pad), h: Math.max(2, card.h - 2 * pad) };
  // ffmpeg wants even sizes for its scale and pad.
  const even = (v: number) => Math.max(2, v - (v % 2));
  return { W, H, stand, card, photo: { ...photo, w: even(photo.w), h: even(photo.h) } };
}

/** The base Claude named, as one of ours. */
export function baseOf(v: unknown): CoverBase {
  return v === "floor" ? "floor" : v === "wall" ? "wall" : "table";
}
