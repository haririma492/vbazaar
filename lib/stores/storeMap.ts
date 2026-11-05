// THE STORE MAP — the Spatial Mapping Engine, first version (owner, 2026-11-05:
// "The photographer's actual walking route must NOT dictate the shopper's
// virtual journey … identify shelves and store sections, understand their
// spatial relationships … construct a logical virtual tour"; "The first
// implementation should create a reliable 2D spatial map. Do not begin by
// attempting a complete 3D reconstruction").
//
// Pure (no I/O; tested in storeMap.test.ts). Free: no AI. From what the crew
// already measures and finds:
//   1. THE CAMERA'S PATH (`integratePath`): the Route optimizer's motion reader
//      (the floor's slide ahead and sideways, the horizon's turn, 5 a second;
//      `routeJob.ts`) summed into a position and a heading for every moment —
//      dead reckoning, in metres (the floor's slide is scaled by the camera's
//      height, so they are estimated metres);
//   2. REPEATED VISITS (`closeLoops`): two moments far apart in time whose
//      panoramas match are the same spot; the path's drift between them is
//      spread back over the stretch (`LOOP_*`), so a shelf seen twice lands in
//      one place;
//   3. EACH PRODUCT ON THE FLOOR (`placeProducts`): every sighting and every
//      step of its light is a ray from where the camera was, in the direction
//      the product was seen (heading + the product's longitude). Rays from a
//      moving camera cross where the product stands: least-squares, checked
//      for a real baseline, a real spread of angles, a sane distance and small
//      residuals. A product only seen from one spot is ESTIMATED at
//      `ASSUMED_DIST`, said so, and goes on the review list;
//   4. SHELVES (`buildMap`): the Shelf finder's shelves (`levels.ts`, one
//      picture each) become segments on the floor (their products' points,
//      fitted), the shelf facing the camera that saw it; two segments of one
//      bookcase seen in two pictures (collinear, touching, facing the same way)
//      are merged — "a partial view of a previously detected shelf";
//   5. PERSISTENT SHELF IDS (`assignIds`): a shelf keeps its id from the last
//      map when it shares most products, else when it stands in the same place;
//   6. THE TOUR ORDER (`mapOrder`): from the entrance, shelf to the nearest
//      shelf by where a shopper would stand in front of it, then shortened
//      (2-opt) — the store's layout, not the order the photographer filmed in.
// Nothing here moves a light or cuts a video; the map is a record the Shelf
// Tour and its builders read (`orderShelvesByMap`).
//
// ⚠️ Honest limits, stated rather than hidden: dead reckoning drifts (a few
// percent of the distance walked; heading drift is not corrected, only
// position at matched revisits); there is no checkout counter, sign or display
// table on the map yet — those need a detector the crew does not run (see
// docs/research/cv-spatial.md).

import type { Motion } from "./route";
import type { Boxed, Shelf } from "./levels";

export const MAP_VERSION = 1;

export type Pose = { t: number; x: number; y: number; th: number; sure: number };
export type Ray = { t: number; x: number; y: number; dx: number; dy: number };
export type Observation = { n: number; t: number; lon: number };
export type Placed = { n: number; x: number; y: number; method: "triangulated" | "estimated"; conf: number; rays: number; dist: number };
export type Loop = { a: number; b: number; score: number; shift: number };
export type MapShelf = {
  id: string; t: number; center: { x: number; y: number }; dir: number; length: number;
  /** Where a shopper stands to see it: `STAND_M` in front of its middle. */
  face: { x: number; y: number }; normal: number;
  products: number[]; levels: number; placed: number; conf: number;
};
export type ReviewItem = { kind: "shelf" | "product"; id: string; why: string };
export type StoreMap = {
  store: string; version: number; made: string; units: "m (estimated)";
  entrance: { x: number; y: number; th: number; t: number };
  path: Array<{ t: number; x: number; y: number }>;
  loops: Loop[];
  shelves: MapShelf[];
  products: Array<Placed & { shelf: string | null }>;
  order: string[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  quality: { products: number; triangulated: number; estimated: number; shelves: number; merged: number; meanSure: number; loopsClosed: number };
  review: ReviewItem[];
  notes: string[];
};

/** The motion is smoothed over this (s), as the Route optimizer's blocks are. */
export const SMOOTH_S = 0.5;
/** A product needs rays from at least this far apart (m) and this spread of angles (rad, ~3.4°) to be triangulated. */
export const MIN_BASELINE = 0.3, MIN_SPREAD = 0.06;
/** A triangulated product is between these distances (m) from the camera, and its rays miss it by at most RMS_BASE + RMS_PER_M·distance. */
export const DIST_MIN = 0.25, DIST_MAX = 8, RMS_BASE = 0.2, RMS_PER_M = 0.05;
/** At least this share of rays must point at the product, not away from it. */
export const AHEAD_MIN = 0.8;
/** A product seen from one spot only is put this far (m) along its ray. */
export const ASSUMED_DIST = 1.2;
/** At most this many rays per product (evenly taken). */
export const OBS_MAX = 40;
/** Where a shopper stands in front of a shelf (m). */
export const STAND_M = 0.9;
/** A shelf with fewer points than this gets its direction from the camera's view, not a fit. */
export const FIT_MIN = 3;
/** Two shelf segments are one bookcase: angle within this (rad, ~25°), this far off its line (m), this gap along it (m). */
export const MERGE_ANGLE = 0.44, MERGE_OFF = 0.35, MERGE_GAP = 0.4;
/** A loop: two moments at least `LOOP_DT` s apart whose panoramas match at least `LOOP_OK`, and the path says they are within `LOOP_NEAR` m. */
export const LOOP_DT = 15, LOOP_OK = 0.88, LOOP_NEAR = 2.0;
/** A shelf below this share of products placed by triangulation goes on the review list. */
export const SHELF_CONF_MIN = 0.5;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

function smooth(v: number[], k: number): number[] {
  return v.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(v.length - 1, i + k); j++) { s += v[j]; n++; }
    return n ? s / n : 0;
  });
}

/**
 * 1: the camera's pose at every reading. Reading i is the move from i·dt to (i+1)·dt, so the pose
 * AFTER it belongs at (i+1)·dt. Same conventions as `blocksOf` (route.ts): heading `th` + = turned
 * right; a product at longitude `lon` lies at world angle `th + lon`; x along angle 0, y along +90°.
 */
export function integratePath(m: Motion): Pose[] {
  const k = Math.max(1, Math.round(SMOOTH_S / m.dt));
  const fwd = smooth(m.fwd, k), side = smooth(m.side, k), turn = smooth(m.turn, k);
  const out: Pose[] = [{ t: 0, x: 0, y: 0, th: 0, sure: m.sure[0] ?? 0 }];
  let th = 0, x = 0, y = 0;
  for (let i = 0; i < fwd.length; i++) {
    th += turn[i] * m.dt;
    x += (fwd[i] * Math.cos(th) - side[i] * Math.sin(th)) * m.dt;
    y += (fwd[i] * Math.sin(th) + side[i] * Math.cos(th)) * m.dt;
    out.push({ t: r3((i + 1) * m.dt), x, y, th, sure: m.sure[i] ?? 0 });
  }
  return out;
}

/** The pose at `t` (between readings: interpolated; the heading the short way round). Null on an empty path. */
export function poseAt(path: Pose[], t: number): Pose | null {
  if (!path.length) return null;
  if (t <= path[0].t) return path[0];
  if (t >= path[path.length - 1].t) return path[path.length - 1];
  let lo = 0, hi = path.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid].t <= t) lo = mid; else hi = mid; }
  const a = path[lo], b = path[hi], f = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, th: a.th + wrap(b.th - a.th) * f, sure: Math.min(a.sure, b.sure) };
}

export function rayOf(p: Pose, lon: number): Ray {
  const a = p.th + lon;
  return { t: p.t, x: p.x, y: p.y, dx: Math.cos(a), dy: Math.sin(a) };
}

/**
 * 2: repeated visits. `pairs` are moments (a < b) whose panoramas matched (`score`, 0–1); each accepted one
 * says the camera was in the same place at `a` and `b`, so the drift between is spread linearly over a…b and
 * everything after b moves with it. Taken in order of `b`. Returns a new path.
 */
export function closeLoops(path: Pose[], pairs: Loop[]): { path: Pose[]; used: Loop[] } {
  let p = path.map((q) => ({ ...q }));
  const used: Loop[] = [];
  for (const l of [...pairs].sort((x, y) => x.b - y.b)) {
    if (l.score < LOOP_OK || l.b - l.a < LOOP_DT) continue;
    const A = poseAt(p, l.a), B = poseAt(p, l.b);
    if (!A || !B) continue;
    const ex = B.x - A.x, ey = B.y - A.y;
    if (Math.hypot(ex, ey) > LOOP_NEAR) continue;
    p = p.map((q) => {
      if (q.t <= l.a) return q;
      const f = q.t >= l.b ? 1 : (q.t - l.a) / (l.b - l.a);
      return { ...q, x: q.x - ex * f, y: q.y - ey * f };
    });
    used.push(l);
  }
  return { path: p, used };
}

/** The point nearest every ray (least squares on the perpendicular distances), and how good it is. Null when the rays are (near) parallel. */
export function triangulate(rays: Ray[]): { x: number; y: number; rms: number; baseline: number; spread: number; ahead: number; dist: number } | null {
  if (rays.length < 2) return null;
  let a = 0, b = 0, c = 0, bx = 0, by = 0;
  for (const r of rays) {
    // (I − d dᵀ) for the ray's direction d.
    const m11 = 1 - r.dx * r.dx, m12 = -r.dx * r.dy, m22 = 1 - r.dy * r.dy;
    a += m11; b += m12; c += m22;
    bx += m11 * r.x + m12 * r.y; by += m12 * r.x + m22 * r.y;
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-6 * rays.length * rays.length) return null;
  const x = (c * bx - b * by) / det, y = (a * by - b * bx) / det;
  let sq = 0, ahead = 0, dist = 0, baseline = 0;
  const angles: number[] = [];
  for (const r of rays) {
    const vx = x - r.x, vy = y - r.y, along = vx * r.dx + vy * r.dy;
    const off = vx * r.dy - vy * r.dx;
    sq += off * off;
    if (along > 0) ahead++;
    dist += Math.hypot(vx, vy);
    angles.push(Math.atan2(r.dy, r.dx));
  }
  for (let i = 0; i < rays.length; i++) for (let j = i + 1; j < rays.length; j++) baseline = Math.max(baseline, Math.hypot(rays[i].x - rays[j].x, rays[i].y - rays[j].y));
  const mid = Math.atan2(angles.reduce((s, q) => s + Math.sin(q), 0), angles.reduce((s, q) => s + Math.cos(q), 0));
  const offs = angles.map((q) => wrap(q - mid));
  return { x, y, rms: Math.sqrt(sq / rays.length), baseline, spread: Math.max(...offs) - Math.min(...offs), ahead: ahead / rays.length, dist: dist / rays.length };
}

/** At most `max` items, evenly taken (first and last kept). */
function evenly<T>(v: T[], max: number): T[] {
  if (v.length <= max) return v;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(v[Math.round((i * (v.length - 1)) / (max - 1))]);
  return out;
}

/** 3: every product's place on the floor, from its observations (sightings and its light's steps). */
export function placeProducts(obs: Observation[], path: Pose[]): Map<number, Placed> {
  const byN = new Map<number, Observation[]>();
  for (const o of obs) if (Number.isFinite(o.t) && Number.isFinite(o.lon)) byN.set(o.n, [...(byN.get(o.n) ?? []), o]);
  const out = new Map<number, Placed>();
  for (const [n, list] of byN) {
    const rays = evenly([...list].sort((a, b) => a.t - b.t), OBS_MAX).map((o) => { const p = poseAt(path, o.t); return p ? rayOf(p, o.lon) : null; }).filter((r): r is Ray => !!r);
    if (!rays.length) continue;
    const tri = triangulate(rays);
    if (tri && tri.baseline >= MIN_BASELINE && tri.spread >= MIN_SPREAD && tri.ahead >= AHEAD_MIN
      && tri.dist >= DIST_MIN && tri.dist <= DIST_MAX && tri.rms <= RMS_BASE + RMS_PER_M * tri.dist) {
      const conf = Math.min(1, tri.spread / 0.25) * Math.max(0, 1 - tri.rms / (2 * (RMS_BASE + RMS_PER_M * tri.dist)));
      out.set(n, { n, x: r3(tri.x), y: r3(tri.y), method: "triangulated", conf: r3(Math.max(0.3, conf)), rays: rays.length, dist: r3(tri.dist) });
      continue;
    }
    // One spot (or rays that do not agree): along the middle ray, at the assumed distance.
    const r = rays[rays.length >> 1];
    out.set(n, { n, x: r3(r.x + r.dx * ASSUMED_DIST), y: r3(r.y + r.dy * ASSUMED_DIST), method: "estimated", conf: 0.2, rays: rays.length, dist: ASSUMED_DIST });
  }
  return out;
}

/** A segment through points: middle, direction (rad, 0…π), length (m). With too few points, across `view` (the camera's ray to them). */
export function fitSegment(pts: Array<{ x: number; y: number }>, view: number): { center: { x: number; y: number }; dir: number; length: number } {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let dir: number;
  if (pts.length >= FIT_MIN) {
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) { const u = p.x - cx, v = p.y - cy; sxx += u * u; sxy += u * v; syy += v * v; }
    dir = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  } else dir = view + Math.PI / 2;
  dir = ((dir % Math.PI) + Math.PI) % Math.PI;
  const ux = Math.cos(dir), uy = Math.sin(dir);
  const along = pts.map((p) => (p.x - cx) * ux + (p.y - cy) * uy);
  const lo = Math.min(...along), hi = Math.max(...along);
  const mid = (lo + hi) / 2;
  return { center: { x: cx + ux * mid, y: cy + uy * mid }, dir, length: Math.max(0.4, hi - lo + 0.2) };
}

/** The shelf's face: perpendicular to it, towards the camera that saw it. */
function faceOf(center: { x: number; y: number }, dir: number, viewer: { x: number; y: number }): { normal: number; face: { x: number; y: number } } {
  let normal = dir + Math.PI / 2;
  if (Math.cos(normal) * (viewer.x - center.x) + Math.sin(normal) * (viewer.y - center.y) < 0) normal += Math.PI;
  normal = wrap(normal);
  return { normal, face: { x: r3(center.x + Math.cos(normal) * STAND_M), y: r3(center.y + Math.sin(normal) * STAND_M) } };
}

type Draft = Omit<MapShelf, "id"> & { pts: Array<{ x: number; y: number }>; viewer: { x: number; y: number } };

function draftOf(sh: Shelf, placed: Map<number, Placed>, path: Pose[]): Draft | null {
  const products = [...new Set(sh.levels.flatMap((l) => l.products.map((p) => p.n)))];
  const cam = poseAt(path, sh.t);
  if (!cam) return null;
  const pl = products.map((n) => placed.get(n)).filter((p): p is Placed => !!p);
  const tri = pl.filter((p) => p.method === "triangulated");
  // ⚠️ The shelf's line from triangulated products only when there are enough; an estimated point lies on a
  // circle round the camera and would bend the fit. Too few: the shelf across the camera's view of its frame.
  const pts = (tri.length >= FIT_MIN ? tri : pl).map((p) => ({ x: p.x, y: p.y }));
  const view = cam.th + sh.frame.lon;
  const use = pts.length ? pts : [{ x: cam.x + Math.cos(view) * ASSUMED_DIST, y: cam.y + Math.sin(view) * ASSUMED_DIST }];
  const seg = fitSegment(use, view);
  const viewer = { x: cam.x, y: cam.y };
  const { normal, face } = faceOf(seg.center, seg.dir, viewer);
  return {
    t: sh.t, center: { x: r3(seg.center.x), y: r3(seg.center.y) }, dir: r3(seg.dir), length: r3(seg.length), face, normal: r3(normal),
    products, levels: sh.levels.length, placed: tri.length, conf: r3(products.length ? tri.length / products.length : 0), pts: use, viewer,
  };
}

/** Two drafts are one bookcase seen in two pictures. */
export function oneBookcase(a: { center: { x: number; y: number }; dir: number; length: number; normal: number }, b: typeof a): boolean {
  const dd = Math.abs(wrap(2 * (a.dir - b.dir))) / 2;
  if (dd > MERGE_ANGLE) return false;
  if (Math.cos(a.normal - b.normal) < 0) return false; // back to back: two sides of an aisle, not one shelf
  const ux = Math.cos(a.dir), uy = Math.sin(a.dir);
  const vx = b.center.x - a.center.x, vy = b.center.y - a.center.y;
  const off = Math.abs(vx * uy - vy * ux), along = Math.abs(vx * ux + vy * uy);
  return off <= MERGE_OFF && along - (a.length + b.length) / 2 <= MERGE_GAP;
}

function mergeDrafts(ds: Draft[]): { out: Draft[]; merged: number } {
  let out = [...ds], merged = 0;
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (!oneBookcase(out[i], out[j])) continue;
      const a = out[i], b = out[j];
      const pts = [...a.pts, ...b.pts];
      const seg = fitSegment(pts, Math.atan2(a.center.y - a.viewer.y, a.center.x - a.viewer.x));
      const { normal, face } = faceOf(seg.center, seg.dir, a.viewer);
      const products = [...new Set([...a.products, ...b.products])];
      const placed = a.placed + b.placed;
      const m: Draft = {
        t: Math.min(a.t, b.t), center: { x: r3(seg.center.x), y: r3(seg.center.y) }, dir: r3(seg.dir), length: r3(seg.length), face, normal: r3(normal),
        products, levels: Math.max(a.levels, b.levels), placed, conf: r3(products.length ? Math.min(1, placed / products.length) : 0), pts, viewer: a.viewer,
      };
      out = [...out.slice(0, i), m, ...out.slice(i + 1, j), ...out.slice(j + 1)];
      merged++; changed = true;
      break outer;
    }
  }
  return { out, merged };
}

/**
 * 5: persistent ids. A shelf takes the id of the last map's shelf sharing most of its products (at least half of
 * the smaller), else of one standing in the same place (one bookcase by `oneBookcase`); else the next new id.
 * Each old id is used once.
 */
export function assignIds<T extends { products: number[]; center: { x: number; y: number }; dir: number; length: number; normal: number }>(shelves: T[], prev: MapShelf[]): Array<T & { id: string }> {
  const used = new Set<string>();
  let next = Math.max(0, ...prev.map((p) => Number(/^S(\d+)$/.exec(p.id)?.[1] ?? 0))) + 1;
  const ids = new Array<string | null>(shelves.length).fill(null);
  // Best product overlaps first, so a strong match is not taken by a weak one.
  const cands: Array<{ i: number; id: string; score: number }> = [];
  for (const [i, s] of shelves.entries()) for (const p of prev) {
    const P = new Set(p.products);
    const both = s.products.filter((n) => P.has(n)).length;
    if (both && both >= 0.5 * Math.min(s.products.length, p.products.length)) cands.push({ i, id: p.id, score: both / Math.max(s.products.length, p.products.length) });
  }
  for (const c of cands.sort((a, b) => b.score - a.score)) if (!ids[c.i] && !used.has(c.id)) { ids[c.i] = c.id; used.add(c.id); }
  for (const [i, s] of shelves.entries()) {
    if (ids[i]) continue;
    const p = prev.find((q) => !used.has(q.id) && oneBookcase(q, s));
    if (p) { ids[i] = p.id; used.add(p.id); }
  }
  return shelves.map((s, i) => ({ ...s, id: ids[i] ?? `S${next++}` }));
}

/** 6: the tour's order: from `start`, each time the nearest shelf by where a shopper stands; then 2-opt on the open path. */
export function mapOrder(shelves: Array<{ id: string; face: { x: number; y: number } }>, start: { x: number; y: number }): string[] {
  if (!shelves.length) return [];
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const left = [...shelves];
  const order: typeof shelves = [];
  let at = start;
  while (left.length) {
    let k = 0;
    for (let i = 1; i < left.length; i++) if (d(at, left[i].face) < d(at, left[k].face)) k = i;
    const [s] = left.splice(k, 1);
    order.push(s); at = s.face;
  }
  // 2-opt: reverse a stretch when that shortens the walk (the start fixed, the end free).
  const pt = (i: number) => (i < 0 ? start : order[i].face);
  for (let improved = true, rounds = 0; improved && rounds < 50; rounds++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const before = d(pt(i - 1), pt(i)) + (j + 1 < order.length ? d(pt(j), pt(j + 1)) : 0);
      const after = d(pt(i - 1), pt(j)) + (j + 1 < order.length ? d(pt(i), pt(j + 1)) : 0);
      if (after < before - 1e-6) { order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse()); improved = true; }
    }
  }
  return order.map((s) => s.id);
}

export type MapInputs = {
  store: string; made: string; path: Pose[]; loops: Loop[]; observations: Observation[];
  /** The Shelf finder's shelves (`planShelves`), or the tagger's sightings grouped by the same rules. */
  shelves: Shelf[]; entry: number; prev: StoreMap | null;
  /** Products of the list with no name (the owner has not named them, and no title was read). */
  unnamed: number[];
};

/** The whole map. */
export function buildMap(inp: MapInputs): StoreMap {
  const { path: closed, used } = closeLoops(inp.path, inp.loops);
  const placed = placeProducts(inp.observations, closed);
  const drafts = inp.shelves.map((sh) => draftOf(sh, placed, closed)).filter((d): d is Draft => !!d);
  const { out, merged } = mergeDrafts(drafts);
  const withIds = assignIds(out.map(({ pts: _p, viewer: _v, ...rest }) => rest), inp.prev?.shelves ?? []);
  const shelfOf = new Map<number, string>();
  for (const s of withIds) for (const n of s.products) if (!shelfOf.has(n)) shelfOf.set(n, s.id);
  const e = poseAt(closed, inp.entry) ?? closed[0] ?? { t: 0, x: 0, y: 0, th: 0, sure: 0 };
  const order = mapOrder(withIds, e);
  const products = [...placed.values()].sort((a, b) => a.n - b.n).map((p) => ({ ...p, shelf: shelfOf.get(p.n) ?? null }));
  const review: ReviewItem[] = [];
  for (const s of withIds) {
    if (!s.placed) review.push({ kind: "shelf", id: s.id, why: "No product on it could be placed by triangulation: its place on the map is estimated from one view." });
    else if (s.conf < SHELF_CONF_MIN) review.push({ kind: "shelf", id: s.id, why: `Only ${s.placed} of ${s.products.length} products placed by triangulation.` });
  }
  for (const p of products) if (p.method === "estimated") review.push({ kind: "product", id: String(p.n), why: "Seen from one spot only: its place is estimated." });
  for (const n of inp.unnamed) review.push({ kind: "product", id: String(n), why: "No name: the title could not be read; the owner names it, or it is filmed again closer." });
  // Every point for the bounds: the path, the shelves' ends, the products.
  const xs: number[] = [], ys: number[] = [];
  for (const q of closed) { xs.push(q.x); ys.push(q.y); }
  for (const s of withIds) for (const k of [-1, 1]) { xs.push(s.center.x + (k * Math.cos(s.dir) * s.length) / 2); ys.push(s.center.y + (k * Math.sin(s.dir) * s.length) / 2); }
  for (const p of products) { xs.push(p.x); ys.push(p.y); }
  const tri = products.filter((p) => p.method === "triangulated").length;
  const pathOut: StoreMap["path"] = [];
  for (const q of closed) if (!pathOut.length || q.t - pathOut[pathOut.length - 1].t >= 0.5 - 1e-9) pathOut.push({ t: q.t, x: r3(q.x), y: r3(q.y) });
  const notes = [
    "Positions are from dead reckoning (the floor's slide scaled by the camera's assumed height): estimated metres, drifting a few percent of the distance walked.",
    used.length ? `${used.length} repeated visit${used.length > 1 ? "s" : ""} recognised; the path's drift corrected there.` : "No repeated visit recognised: the path's drift is not corrected.",
  ];
  return {
    store: inp.store, version: MAP_VERSION, made: inp.made, units: "m (estimated)",
    entrance: { x: r3(e.x), y: r3(e.y), th: r3(e.th), t: r3(inp.entry) },
    path: pathOut, loops: used, shelves: withIds, products, order,
    bounds: { minX: r3(Math.min(...xs, 0)), minY: r3(Math.min(...ys, 0)), maxX: r3(Math.max(...xs, 0)), maxY: r3(Math.max(...ys, 0)) },
    quality: { products: products.length, triangulated: tri, estimated: products.length - tri, shelves: withIds.length, merged, meanSure: r3(median(closed.map((q) => q.sure))), loopsClosed: used.length },
    review, notes,
  };
}

/**
 * The Shelf finder's shelves (`planShelves`, in walking order) put in the map's order: each shelf goes where the
 * map shelf sharing most of its products stands in `map.order`; a shelf the map does not know keeps its place
 * after them, in walking order. Without a map: as given.
 */
export function orderShelvesByMap<S extends { t: number; levels: Array<{ products: Boxed[] }> }>(shelves: S[], map: Pick<StoreMap, "shelves" | "order"> | null): S[] {
  if (!map || !map.order.length) return shelves;
  const rank = new Map(map.order.map((id, i) => [id, i]));
  const sets = map.shelves.map((s) => ({ id: s.id, P: new Set(s.products) }));
  const where = (s: S) => {
    const ns = s.levels.flatMap((l) => l.products.map((p) => p.n));
    let best: { id: string; both: number } | null = null;
    for (const m of sets) { const both = ns.filter((n) => m.P.has(n)).length; if (both && (!best || both > best.both)) best = { id: m.id, both }; }
    return best ? rank.get(best.id) ?? Infinity : Infinity;
  };
  return shelves.map((s, i) => ({ s, i, r: where(s) })).sort((a, b) => a.r - b.r || a.s.t - b.s.t || a.i - b.i).map((x) => x.s);
}

/**
 * The best match of two small grey panoramas (row-major `w`×`h`) over every circular shift of `step` columns:
 * correlation on the band round the horizon (the ceiling is the same everywhere). For loop finding.
 */
export function ringMatch(a: Uint8Array, b: Uint8Array, w: number, h: number, step = 4): { score: number; shift: number } {
  const y0 = Math.floor(h * 0.3), y1 = Math.floor(h * 0.85);
  const band = (g: Uint8Array) => { const o = new Float64Array((y1 - y0) * w); let m = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) { const v = g[y * w + x]; o[(y - y0) * w + x] = v; m += v; } m /= o.length; for (let i = 0; i < o.length; i++) o[i] -= m; return o; };
  const A = band(a), B = band(b), rows = y1 - y0;
  let aa = 0, bb = 0;
  for (let i = 0; i < A.length; i++) { aa += A[i] * A[i]; bb += B[i] * B[i]; }
  if (aa < 1e-6 || bb < 1e-6) return { score: 0, shift: 0 };
  let best = { score: -1, shift: 0 };
  for (let s = 0; s < w; s += step) {
    let ab = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) ab += A[y * w + x] * B[y * w + ((x + s) % w)];
    const sc = ab / Math.sqrt(aa * bb);
    if (sc > best.score) best = { score: sc, shift: s };
  }
  return { score: r3(best.score), shift: best.shift };
}
