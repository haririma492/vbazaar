/**
 * THE TAGGER'S RULES — price tags pinned on the products of a store's 360°
 * walk, with nobody tapping them (owner, 2026-10-30: "put labels on all the
 * products that need label and are listed in the spreadsheet").
 *
 *   1. look       every `LOOK_EVERY` s, `HEADINGS` normal camera views round
 *                 the camera (`lookPlan`); Claude names the list's products
 *                 in them, each with a box (`ai.ts`, `findInViews`)
 *   2. aim        a box's middle → a direction in the walk (`aim`), with the
 *                 same maths the walk draws with (`viewDir`)
 *   3. follow     from there, frame by frame either way, the same patch of
 *                 picture is found again (`follow`, `lib/splats/track.ts` —
 *                 what «📌 Pin to the product» does on the walk page), so the
 *                 tag stays on the product as the camera walks past
 *   4. keep       per product, its best follows: the longest, and a second
 *                 one only where the product is seen again elsewhere
 *                 (`keepTracks`); each becomes a walk item (`itemOf`)
 *
 * Pure: `node --test` runs it.
 */

import { followStep, matchPatch, patchAt } from "../splats/track";
import { renderView, viewDir } from "../splats/projection";
import type { ItemPin, WalkItem } from "../splats/walks";
import type { Product } from "../splats/catalogue";

/** How often the tagger looks round, in seconds of walk. */
export const LOOK_EVERY = 3;
/** Views round the camera per look: 6 × 60° is the whole circle with some overlap at 75°. */
export const HEADINGS = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3);
export const LOOK_PITCH = -0.15;
export const LOOK_FOV = (75 * Math.PI) / 180;
export const LOOK_N = 768;

/** Following: the step, how far either way, and the small view it is followed in (as on the walk page). */
export const FOLLOW_FPS = 5;
export const FOLLOW_SPAN = 6;
export const FOLLOW_W = 1024;
const VIEW_FOV = (36 * Math.PI) / 180;
const VIEW_N = 96;
const VIEW_PATCH = 15;
const VIEW_RADIUS = 20;
/** A follow shorter than this many pins is not kept on its own (one sighting, seen once). */
export const MIN_PINS = 3;
/**
 * ⚠️ A FOLLOW STOPS WHEN IT HAS LEFT ITS PRODUCT (owner, 2026-11-01: "the tags
 * on the items should be stationary why they move with camera?"). On the
 * first real store, follows slid off a glass case onto whatever moves with
 * the camera — down to the camera's own mount, straight below — and the tag
 * went with them. A step is refused when what it found no longer looks like
 * the product as first seen (`ANCHOR_MIN`), when it is near straight down or
 * up (`MAX_LAT`: no shelf is there, the mount and the ceiling lights are),
 * or when it jumps (`MAX_STEP`).
 */
export const ANCHOR_MIN = 0.35;
export const MAX_LAT = 1.05;
export const MAX_STEP = 0.12;
/** Two sightings of a product closer than this (radians, at the same moment) are the same one. */
const SAME = 0.25;

export type Look = { t: number; heading: number; id: string };

/** The moments and headings the tagger looks at, for a walk `seconds` long. */
export function lookPlan(seconds: number): Array<{ t: number; looks: Look[] }> {
  const out: Array<{ t: number; looks: Look[] }> = [];
  for (let t = Math.min(1, seconds / 2); t < seconds - 0.2; t += LOOK_EVERY) {
    const tt = Math.round(t * 100) / 100;
    out.push({ t: tt, looks: HEADINGS.map((heading, i) => ({ t: tt, heading, id: `${tt}s-${i * 60}°` })) });
  }
  return out;
}

/** A box (thousandths of a LOOK_N view) → the direction of its middle in the walk. */
export function aim(look: Look, box: [number, number, number, number]): { lon: number; lat: number } {
  const px = ((box[0] + box[2]) / 2000) * LOOK_N, py = ((box[1] + box[3]) / 2000) * LOOK_N;
  return viewDir(look.heading, LOOK_PITCH, LOOK_FOV, LOOK_N, px, py);
}

/**
 * A product followed from a sighting at frame `i0` (direction `at0`) through
 * `frames` (grey W×H panoramas, `FOLLOW_FPS` apart, the first at `t0` s),
 * both ways, until it is lost. Its pins, in time order.
 */
export function follow(frames: Float32Array[], W: number, H: number, t0: number, i0: number, at0: { lon: number; lat: number }): ItemPin[] {
  const view = (i: number, at: { lon: number; lat: number }) => renderView(frames[i], W, H, "equirect", at.lon, at.lat, VIEW_FOV, VIEW_N);
  const c = VIEW_N / 2;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const tOf = (i: number) => Math.round((t0 + i / FOLLOW_FPS) * 100) / 100;
  const template0 = patchAt(view(i0, at0), VIEW_N, c, c, VIEW_PATCH);
  const pins: ItemPin[] = [{ t: tOf(i0), x: r3(at0.lon), y: r3(at0.lat) }];
  for (const dir of [1, -1] as const) {
    let at = at0, move = { lon: 0, lat: 0 }, template = template0;
    for (let i = i0 + dir; i >= 0 && i < frames.length && Math.abs(i - i0) <= FOLLOW_SPAN * FOLLOW_FPS; i += dir) {
      const guess = { lon: at.lon + move.lon, lat: at.lat + move.lat };
      const frameView = view(i, guess);
      const r = followStep(frameView, VIEW_N, VIEW_N, template, VIEW_PATCH, { x: c, y: c }, VIEW_RADIUS);
      if (!r) break;
      if (matchPatch(frameView, VIEW_N, VIEW_N, template0, VIEW_PATCH, r.x, r.y, 0).score < ANCHOR_MIN) break;
      const next = viewDir(guess.lon, guess.lat, VIEW_FOV, VIEW_N, r.x, r.y);
      const step = { lon: Math.atan2(Math.sin(next.lon - at.lon), Math.cos(next.lon - at.lon)), lat: next.lat - at.lat };
      if (Math.abs(next.lat) > MAX_LAT || Math.hypot(step.lon * Math.cos(at.lat), step.lat) > MAX_STEP) break;
      move = step;
      at = next;
      template = r.template;
      pins.push({ t: tOf(i), x: r3(at.lon), y: r3(at.lat) });
    }
  }
  return pins.sort((a, b) => a.t - b.t);
}

export type Track = { n: number; pins: ItemPin[]; confidence: number };

const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Where a track is at `t` (between its pins), or null outside it. */
function trackAt(pins: ItemPin[], t: number): { x: number; y: number } | null {
  if (!pins.length || t < pins[0].t || t > pins[pins.length - 1].t) return null;
  let best = pins[0];
  for (const p of pins) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

/** Whether two tracks are the same product in the same place (they overlap in time and point the same way). */
function sameSpot(a: ItemPin[], b: ItemPin[]): boolean {
  for (const p of b) {
    const q = trackAt(a, p.t);
    if (q && angle(q.x, p.x) < SAME && Math.abs(q.y - p.y) < SAME) return true;
  }
  return false;
}

/**
 * Per product, the tracks worth tags: sightings of one spot merged into the
 * longest of them, at most two spots per product, and none shorter than
 * `MIN_PINS` (a sighting the follow lost at once is too uncertain to tag).
 */
export function keepTracks(tracks: Track[], perProduct = 2): Track[] {
  const byN = new Map<number, Track[]>();
  for (const t of tracks) if (t.pins.length >= MIN_PINS) byN.set(t.n, [...(byN.get(t.n) ?? []), t]);
  const out: Track[] = [];
  for (const list of byN.values()) {
    const sorted = [...list].sort((a, b) => b.pins.length - a.pins.length || b.confidence - a.confidence);
    const kept: Track[] = [];
    for (const t of sorted) {
      if (kept.some((k) => sameSpot(k.pins, t.pins) || sameSpot(t.pins, k.pins))) continue;
      kept.push(t);
      if (kept.length >= perProduct) break;
    }
    out.push(...kept);
  }
  return out.sort((a, b) => a.pins[0].t - b.pins[0].t);
}

/** A kept track as a walk item: tagged by its number, so the card reads name, unit, price and photo from the list. */
export function itemOf(track: Track, product: Product, index: number): Omit<WalkItem, "id"> & { id: string } {
  return {
    id: `auto-${product.n}-${index}`,
    label: { en: product.en || product.fa || `#${product.n}`, ...(product.fa ? { fa: product.fa } : {}) },
    n: product.n,
    pins: track.pins,
  };
}
