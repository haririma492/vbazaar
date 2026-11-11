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

import { followStep, matchPatch, patchAt, subPixel } from "../splats/track";
import { renderView, viewDir } from "../splats/projection";
import { flatLooks, inFlat, pinsFromFlat, pinsToFlat, sizeFromFlat, sizeToFlat, type FlatLens } from "../splats/lens";
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
/**
 * Frames a second a product is followed at. It was 5: a book 70 cm from the
 * walking camera sweeps 45° a second, 9° between two frames, more than a
 * step may jump (`MAX_RATE`), so the light went out within half a second
 * (measured on the bookshop, 2026-11-04). At 10, it moves 4.5° a frame.
 */
export const FOLLOW_FPS = 10;
/**
 * ⚠️ HOW FAR A SIGHTING IS FOLLOWED, EITHER WAY (s). It was 6, then 1.6: a
 * follow on a counter of look-alike trays stepped onto the next tray, so one
 * product's tag visited three (owner, 2026-11-01). At 1.6 a light lasted 2 s,
 * and went out while its book was still on screen (owner, 2026-11-04: "when we
 * turn the wheel sideway even if books are still in the view the tag
 * disappears"). Now each step is held to the product as Claude first saw it
 * (`ANCHOR_MIN`, `ANCHOR_REACH`): a follow that would step onto a look-alike
 * stops there, so it may go on as long as the book is in view, up to 5 s.
 */
export const FOLLOW_SPAN = 5;
/**
 * ⚠️ FINE ENOUGH TO STAND STILL (owner, 2026-11-04: "the small circle light
 * still tends to move a bit … try to make them as stationary as book
 * themselves"). Measured on the bookshop's walk: the camera barely sways
 * (0.05° a frame), but the finds zig-zagged by 1.4°, because the follow ran
 * on a panorama 1024 wide (0.35° a pixel) and stepped whole pixels. Now it
 * runs on one twice as fine, each step to a fraction of a pixel
 * (`subPixel`), and each step is put where the product looks as it did when
 * Claude saw it (`template0`, within `ANCHOR_REACH` px), so it cannot creep
 * along a shelf of look-alike spines.
 */
export const FOLLOW_W = 2048;
/** This follow's version, kept on each walk it pinned (`Walk.pinned`): 2 = the fine follow, 3 = up to 5 s either way, 4 = the Light keeper (each light checked to stay on its product, lights of one product joined) — all 2026-11-04. */
export const PIN_VERSION = 4;
const VIEW_FOV = (36 * Math.PI) / 180;
const VIEW_N = 128;
const VIEW_PATCH = 21;
const VIEW_RADIUS = 26;
const ANCHOR_REACH = 2;
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
export const ANCHOR_MIN = 0.55;
export const MAX_LAT = 1.05;
export const MAX_STEP = 0.12;
/** The most a product may move in the view, rad a second (70°/s: a book 50 cm from a camera walking 0.6 m/s); a step faster than this has jumped. */
export const MAX_RATE = 1.2;
/** Two sightings of a product closer than this (radians, at the same moment) are the same one. */
const SAME = 0.25;

/** A view the crew looks through: when, which way, how far up or down, and how wide (rad). */
export type Look = { t: number; heading: number; pitch: number; fov: number; id: string };

/**
 * ⚠️ SHELF LOOKS (owner, 2026-11-04, on a bookshop: "currently 70% of them
 * are not pictured or listed, that need to change"). Six views 75° wide from
 * the phone copy put a book's spine at a few pixels, so most titles were
 * never seen. Each moment is now `SHELF_HEADINGS` × `SHELF_PITCHES` views,
 * `SHELF_FOV` wide, cut from the full-size walk: 15 pixels a degree, the
 * video's own sharpness, from the floor-level shelves to the top ones.
 */
export const SHELF_FOV = (50 * Math.PI) / 180;
export const SHELF_HEADINGS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);
export const SHELF_PITCHES = [(-28 * Math.PI) / 180, (8 * Math.PI) / 180];

/**
 * ⚠️ A FLAT VIDEO'S LOOKS (owner, 2026-11-11: "flat videos with twice or 3 times PPD"). Its views are a grid
 * over the frame itself (`flatLooks`), each `FLAT_FOV` wide: about half a shelf look's width, so the picture
 * Claude gets keeps the sharpness the video was filmed flat for (a 4K frame 70° wide has 55 pixels a degree;
 * a 768 px view 26° wide shows 30 of them, twice a 360° shelf look).
 */
export const FLAT_FOV = (26 * Math.PI) / 180;

/** The moments and views the crew looks at, for a walk `seconds` long (`lens`: a flat video's, else a 360° walk). */
export function lookPlan(seconds: number, from = 0, lens?: FlatLens | null): Array<{ t: number; looks: Look[] }> {
  const out: Array<{ t: number; looks: Look[] }> = [];
  const start = from > 0 && from < seconds - 0.5 ? from + 0.5 : Math.min(1, seconds / 2);
  for (let t = start; t < seconds - 0.2; t += LOOK_EVERY) {
    const tt = Math.round(t * 100) / 100;
    const looks: Look[] = [];
    if (lens) {
      for (const l of flatLooks(lens, FLAT_FOV)) looks.push({ t: tt, heading: l.heading, pitch: l.pitch, fov: FLAT_FOV, id: `${tt}s-${l.id}` });
      out.push({ t: tt, looks });
      continue;
    }
    for (const pitch of SHELF_PITCHES) {
      for (const [i, heading] of SHELF_HEADINGS.entries()) looks.push({ t: tt, heading, pitch, fov: SHELF_FOV, id: `${tt}s-${i * 45}°${pitch < 0 ? "low" : "high"}` });
    }
    out.push({ t: tt, looks });
  }
  return out;
}

/** A box (thousandths of a LOOK_N view) → the direction of its middle in the walk. */
export function aim(look: Look, box: [number, number, number, number]): { lon: number; lat: number } {
  const px = ((box[0] + box[2]) / 2000) * LOOK_N, py = ((box[1] + box[3]) / 2000) * LOOK_N;
  return viewDir(look.heading, look.pitch, look.fov, LOOK_N, px, py);
}

/**
 * A box → the product's outline round its middle, in radians across and up
 * (`WalkItem.size`): the angles between the middles of its opposite edges. A
 * shopper's tap anywhere inside it opens the product (owner, 2026-11-04:
 * "click anywhere on that product (book) boundary").
 */
export function boxSize(look: Look, box: [number, number, number, number]): { w: number; h: number } {
  const at = (fx: number, fy: number) => viewDir(look.heading, look.pitch, look.fov, LOOK_N, (fx / 1000) * LOOK_N, (fy / 1000) * LOOK_N);
  const mx = (box[0] + box[2]) / 2, my = (box[1] + box[3]) / 2;
  const l = at(box[0], my), r = at(box[2], my), t = at(mx, box[1]), b = at(mx, box[3]);
  const lat = (l.lat + r.lat) / 2;
  const w = Math.abs(Math.atan2(Math.sin(r.lon - l.lon), Math.cos(r.lon - l.lon))) * Math.cos(lat);
  const h = Math.abs(t.lat - b.lat);
  const r3 = (v: number) => Math.round(Math.min(1.5, Math.max(0.01, v)) * 1000) / 1000;
  return { w: r3(w), h: r3(h) };
}

/**
 * A product followed from a sighting at frame `i0` (direction `at0`) through
 * `frames` (grey W×H panoramas, `FOLLOW_FPS` apart, the first at `t0` s),
 * both ways, until it is lost. Its pins, in time order. With a `lens` the
 * frames are a flat video's: the follow also stops where the product leaves
 * the picture. The pins are directions either way (`flatItem` for the walk).
 */
export function follow(frames: ArrayLike<number>[], W: number, H: number, t0: number, i0: number, at0: { lon: number; lat: number }, size?: { w: number; h: number }, lens?: FlatLens | null): ItemPin[] {
  const view = (i: number, at: { lon: number; lat: number }) => renderView(frames[i], W, H, lens ?? "equirect", at.lon, at.lat, VIEW_FOV, VIEW_N);
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
      // Held to the product as first seen: the best match of the first look within a pixel or two.
      const anchor = matchPatch(frameView, VIEW_N, VIEW_N, template0, VIEW_PATCH, r.x, r.y, ANCHOR_REACH);
      if (anchor.score < ANCHOR_MIN) break;
      const fine = subPixel(frameView, VIEW_N, VIEW_N, template0, VIEW_PATCH, anchor.x, anchor.y);
      // The same pixel convention as the first look's patch (its centre at N/2 is the sighting itself).
      const next = viewDir(guess.lon, guess.lat, VIEW_FOV, VIEW_N, fine.x, fine.y);
      const step = { lon: Math.atan2(Math.sin(next.lon - at.lon), Math.cos(next.lon - at.lon)), lat: next.lat - at.lat };
      if (Math.abs(next.lat) > MAX_LAT || Math.hypot(step.lon * Math.cos(at.lat), step.lat) > MAX_RATE / FOLLOW_FPS) break;
      if (lens && !inFlat(next.lon, next.lat, lens, FLAT_EDGE)) break;
      move = step;
      at = next;
      template = r.template;
      pins.push({ t: tOf(i), x: r3(at.lon), y: r3(at.lat) });
    }
  }
  const sorted = pins.sort((a, b) => a.t - b.t);
  return size ? stillTheSame(frames, W, H, t0, i0, sorted, size, lens) : sorted;
}
/** A light on a flat video ends this near the frame's edge (a fraction of it): half its product is out of the picture. */
export const FLAT_EDGE = 0.01;

/**
 * ⚠️ THE LIGHT KEEPER'S CHECK (owner, 2026-11-04: "making green tags
 * stationary no move at all"). A follow can slide off its product onto a
 * look-alike next to it; tried on the bookshop, "finding it again after a
 * moment lost" made a 7 s light that went from the ceiling to blue spines to
 * green ones, so that was dropped. Instead each follow is checked: the
 * product's whole outline (`size`), seen at each of its moments, must still
 * look like it did at the sighting (`SAME_LOOK`, normalised correlation of a
 * small view of just the outline). Measured on the bookshop: the book one
 * outline to the side scores under 0.3 95 times in 100, so 0.3 it is; one
 * blurred frame may fall short, two in a row end the light, from the
 * sighting outwards.
 */
export const SAME_LOOK = 0.3;
function stillTheSame(frames: ArrayLike<number>[], W: number, H: number, t0: number, i0: number, pins: ItemPin[], size: { w: number; h: number }, lens?: FlatLens | null): ItemPin[] {
  const fov = Math.min(0.8, Math.max(0.04, Math.max(size.w, size.h) * 1.1));
  const n = 40;
  const look = (p: ItemPin) => {
    const i = Math.round((p.t - t0) * FOLLOW_FPS);
    return i >= 0 && i < frames.length ? renderView(frames[i], W, H, lens ?? "equirect", p.x, p.y, fov, n) : null;
  };
  const ncc = (a: Float32Array, b: Float32Array) => {
    let ma = 0, mb = 0;
    for (let k = 0; k < a.length; k++) { ma += a[k]; mb += b[k]; }
    ma /= a.length; mb /= b.length;
    let ab = 0, aa = 0, bb = 0;
    for (let k = 0; k < a.length; k++) { const x = a[k] - ma, y = b[k] - mb; ab += x * y; aa += x * x; bb += y * y; }
    return aa > 1e-6 && bb > 1e-6 ? ab / Math.sqrt(aa * bb) : 0;
  };
  const tSeen = Math.round((t0 + i0 / FOLLOW_FPS) * 100) / 100;
  const k0 = pins.findIndex((p) => Math.abs(p.t - tSeen) < 0.01);
  if (k0 < 0) return pins;
  const ref = look(pins[k0]);
  if (!ref) return pins;
  const ok = (k: number) => { const v = look(pins[k]); return Boolean(v) && ncc(ref, v!) >= SAME_LOOK; };
  let hi = k0, lo = k0;
  for (let k = k0 + 1; k < pins.length; k++) {
    if (ok(k)) { hi = k; continue; }
    if (k + 1 < pins.length && ok(k + 1)) { hi = ++k; continue; } // one blurred frame
    break;
  }
  for (let k = k0 - 1; k >= 0; k--) {
    if (ok(k)) { lo = k; continue; }
    if (k - 1 >= 0 && ok(k - 1)) { lo = --k; continue; }
    break;
  }
  return pins.slice(lo, hi + 1);
}


/**
 * ⚠️ THE CAP IS SHARED FAIRLY (2026-11-04). With more products than
 * `MAX_ITEMS` lights, keeping the tracks in time order cut the end of the walk
 * off (the bookshop: no lights after 105 s of 152). Now every product's best
 * track comes first, then the second spots, so each product gets a light
 * before any gets two, all along the walk; the lights are then in time order.
 */
export function capTracks(tracks: Track[], max: number): Track[] {
  const first: Track[] = [], rest: Track[] = [];
  const seen = new Set<number>();
  for (const t of [...tracks].sort((a, b) => b.pins.length - a.pins.length || b.confidence - a.confidence)) {
    if (seen.has(t.n)) rest.push(t);
    else { seen.add(t.n); first.push(t); }
  }
  return [...first, ...rest].slice(0, max).sort((a, b) => a.pins[0].t - b.pins[0].t);
}

export type Track = { n: number; pins: ItemPin[]; confidence: number; size?: { w: number; h: number } };

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

/** Whether `b` starts where `a` stops: within `JOIN_GAP` s after it, near where `a` was heading. */
function carriesOn(a: ItemPin[], b: ItemPin[]): boolean {
  if (a.length < 2 || !b.length) return false;
  const z = a[a.length - 1], y = a[a.length - 2], f = b[0];
  const gap = f.t - z.t;
  if (gap <= 0 || gap > JOIN_GAP) return false;
  const dt = z.t - y.t || 0.1;
  const px = z.x + (Math.atan2(Math.sin(z.x - y.x), Math.cos(z.x - y.x)) / dt) * gap, py = z.y + ((z.y - y.y) / dt) * gap;
  return angle(px, f.x) < SAME / 3 && Math.abs(py - f.y) < SAME / 3;
}
/** Two follows of one product as one: every moment either has, the two averaged where both have it. */
export function joinPins(a: ItemPin[], b: ItemPin[]): ItemPin[] {
  const at = new Map<number, ItemPin[]>();
  for (const p of [...a, ...b]) {
    const k = Math.round(p.t * 100);
    at.set(k, [...(at.get(k) ?? []), p]);
  }
  return [...at.values()].map((ps) => {
    if (ps.length === 1) return ps[0];
    const x0 = ps[0].x;
    const dx = ps.reduce((s, p) => s + Math.atan2(Math.sin(p.x - x0), Math.cos(p.x - x0)), 0) / ps.length;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return { t: ps[0].t, x: r3(Math.atan2(Math.sin(x0 + dx), Math.cos(x0 + dx))), y: r3(ps.reduce((s, p) => s + p.y, 0) / ps.length) };
  }).sort((p, q) => p.t - q.t);
}
/** Follows of one product this close in time (s) and heading the same way are one light. */
const JOIN_GAP = 1.2;

/**
 * Per product, the tracks worth tags: sightings of one spot merged into the
 * longest of them, at most two spots per product, and none shorter than
 * `MIN_PINS` (a sighting the follow lost at once is too uncertain to tag).
 */
export function keepTracks(tracks: Track[], perProduct = 12): Track[] {
  const byN = new Map<number, Track[]>();
  for (const t of tracks) if (t.pins.length >= MIN_PINS) byN.set(t.n, [...(byN.get(t.n) ?? []), t]);
  const out: Track[] = [];
  for (const list of byN.values()) {
    const sorted = [...list].sort((a, b) => b.pins.length - a.pins.length || b.confidence - a.confidence);
    const kept: Track[] = [];
    for (const t of sorted) {
      // ⚠️ JOINED, NOT DROPPED (the Light keeper, 2026-11-04): another look's follow of the same
      // product in the same place, or one that carries on right where a kept one stops, makes that
      // light last longer instead of being thrown away.
      const k = kept.find((k) => sameSpot(k.pins, t.pins) || sameSpot(t.pins, k.pins) || carriesOn(k.pins, t.pins) || carriesOn(t.pins, k.pins));
      if (k) { k.pins = joinPins(k.pins, t.pins); continue; }
      if (kept.length >= perProduct) continue;
      kept.push({ ...t, pins: [...t.pins] });
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
    ...(track.size ? { size: track.size } : {}),
  };
}

/**
 * A crew light as a FLAT walk keeps it (`lens.ts`): its pins and outline in fractions of the frame, where the
 * walk page draws them. The outline is measured where the product was seen biggest in the frame's middle: the
 * track's middle pin.
 */
export function flatItem<T extends { pins: ItemPin[]; size?: { w: number; h: number } }>(item: T, lens: FlatLens): T {
  const mid = item.pins[Math.floor(item.pins.length / 2)];
  return {
    ...item,
    pins: pinsToFlat(item.pins, lens),
    ...(item.size && mid ? { size: sizeToFlat(item.size, { lon: mid.x, lat: mid.y }, lens) } : {}),
  };
}

/** The other way, for the crew: a flat walk's light with its pins and outline as directions (a 360° walk's: as it is). */
export function itemDirs<T extends { pins: ItemPin[]; size?: { w: number; h: number } }>(item: T, lens: FlatLens | null): T {
  if (!lens) return item;
  const mid = item.pins[Math.floor(item.pins.length / 2)];
  return { ...item, pins: pinsFromFlat(item.pins, lens), ...(item.size && mid ? { size: sizeFromFlat(item.size, mid, lens) } : {}) };
}
