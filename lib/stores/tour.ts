// THE SHELF TOUR (owner, 2026-11-05, IMPORTANT): "We need a new route that
// Camera moves logically well zoomed in on each shelf then to the next shelf
// then to the next shelf and these pieces does not need to be seamless it could
// be cut and assembled. … we need to always construct a perfect route using
// code from the raw recording." Then: "fine as long as shoppers can add to the
// basket".
//
// Pure planning (no I/O; tested in tour.test.ts). From the finder's sightings
// (every product, in the ORIGINAL recording's times) and the lights' paths
// (where each followed product was, moment by moment):
//   1. SHELVES: the sightings in time order, grouped while they stay in one
//      direction (`SHELF_SPREAD`) with no long gap (`SHELF_GAP`);
//   2. a shelf seen again (walking back, a second pass) is the same shelf: only
//      its closest visit is kept (`sameShelf`);
//   3. each shelf's CLIP: `CLIP_MIN`–`CLIP_MAX` s round the moment its products
//      looked biggest (the camera closest);
//   4. the virtual camera's AIM follows the middle of the shelf's products,
//      smoothed (`AIM_SMOOTH`) so it glides; its ZOOM fits their spread;
//   5. every product of the shelf gets its place ON SCREEN for each step of the
//      clip (`project`): the tour's green lights and taps → the basket card.
// A product with no light of its own moves with its shelf's followed products
// (its offset from them at its sighting kept).

export type Seen = { n: number; t: number; lon: number; lat: number; size: { w: number; h: number } };
/** A product's path (original times): from its light's pins. */
export type Track = { n: number; pins: Array<{ t: number; x: number; y: number }> };
export type Aim = { t: number; yaw: number; pitch: number };
export type Clip = {
  shelf: number; from: number; to: number; hfov: number; vfov: number; aim: Aim[];
  products: number[];
};
/** One product on screen: `t` in the TOUR's times, `x`/`y` fractions of the frame (0,0 top left). */
export type OnScreen = { n: number; t: number[]; x: number[]; y: number[] };
export type TourPlan = { clips: Clip[]; items: OnScreen[]; seconds: number };

// ⚠️ WHOLE BOOKCASES, NOT SECTIONS (owner, 2026-11-05: "shelf tour is jumping all over the place even it goes
// out to hallway of other stores … it jumps every 2 sec"): 25 clips of 3–6 s alternating left and right, and the
// first ones outside the door. Now: only inside (`entry`), wide shelves (`SHELF_SPREAD` ~50°, gaps to 5 s), at
// least `SHELF_MIN` products, 6–12 s each, one steady pan, ordered so the camera keeps to one side at a time.
export const STEP = 0.2, SHELF_SPREAD = 0.9, SHELF_GAP = 5, SHELF_MIN = 6, MERGE_SPREAD = 1.3, CLIP_MIN = 6, CLIP_MAX = 12, AIM_SMOOTH = 1.5;
// At most 70° (2026-11-05: at 95° a "shelf" was the whole room, desks and all).
export const FOV_MIN = (50 * Math.PI) / 180, FOV_MAX = (70 * Math.PI) / 180, ASPECT = 16 / 9, FADE = 0.25;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
/** The middle of directions round the circle: the median of their offsets from a first guess. */
function midAngle(v: number[]): number {
  if (!v.length) return 0;
  const c = Math.atan2(v.reduce((s, a) => s + Math.sin(a), 0), v.reduce((s, a) => s + Math.cos(a), 0));
  return wrap(c + median(v.map((a) => wrap(a - c))));
}

/** 1–2: the shelves, in walking order, each with its sightings. */
export function shelvesOf(seen: Seen[]): Seen[][] {
  // ⚠️ SEVERAL SHELVES AT ONCE (measured on the bookshop: 58 "shelves" of one product each when grouped
  // strictly in time order): walking an aisle passes the left and the right shelf together, so each
  // sighting joins the open shelf nearest in direction (seen within `SHELF_GAP`), else opens one.
  let out: Seen[][] = [];
  for (const s of [...seen].sort((a, b) => a.t - b.t)) {
    let best: { g: Seen[]; d: number } | null = null;
    for (const g of out) {
      if (s.t - g[g.length - 1].t > SHELF_GAP) continue;
      const d = Math.abs(wrap(s.lon - midAngle(g.map((x) => x.lon))));
      if (d <= SHELF_SPREAD && (!best || d < best.d)) best = { g, d };
    }
    if (best) best.g.push(s); else out.push([s]);
  }
  // A shelf of fewer than `SHELF_MIN` products joins the nearest shelf (direction) it overlaps in time.
  const span = (g: Seen[]) => [g[0].t, g[g.length - 1].t];
  const count = (g: Seen[]) => new Set(g.map((x) => x.n)).size;
  for (let changed = true; changed;) {
    changed = false;
    for (const g of [...out].sort((a, b) => count(a) - count(b))) {
      if (count(g) >= SHELF_MIN || !out.includes(g)) continue;
      const [a0, a1] = span(g), mid = midAngle(g.map((x) => x.lon));
      let best: { h: Seen[]; d: number } | null = null;
      for (const h of out) {
        if (h === g) continue;
        const [b0, b1] = span(h);
        if (b0 > a1 + SHELF_GAP || a0 > b1 + SHELF_GAP) continue;
        const d = Math.abs(wrap(midAngle(h.map((x) => x.lon)) - mid));
        if (d <= MERGE_SPREAD && (!best || d < best.d)) best = { h, d };
      }
      if (best) { best.h.push(...g); best.h.sort((x, y) => x.t - y.t); out = out.filter((x) => x !== g); changed = true; }
    }
  }
  // A shelf seen again: the two share most products. Keep the visit where they looked biggest.
  const area = (g: Seen[]) => median(g.map((s) => s.size.w * s.size.h));
  const kept: Seen[][] = [];
  for (const g of out) {
    const i = kept.findIndex((k) => sameShelf(k, g));
    if (i < 0) kept.push(g);
    else if (area(g) > area(kept[i])) kept[i] = g;
  }
  return kept.sort((a, b) => a[0].t - b[0].t);
}
export function sameShelf(a: Seen[], b: Seen[]): boolean {
  const A = new Set(a.map((s) => s.n)), B = new Set(b.map((s) => s.n));
  let both = 0;
  for (const n of A) if (B.has(n)) both++;
  return both >= 0.5 * Math.min(A.size, B.size);
}

/** Where product `n` is at `t` (lon/lat), from its light, else moved with its shelf's followed products; null if unknown. */
export function placeAt(n: number, t: number, tracks: Map<number, Track>, seen: Seen, shelfTracks: Track[]): { x: number; y: number } | null {
  const own = tracks.get(n);
  const near = (tr: Track) => {
    let best: { t: number; x: number; y: number } | null = null;
    for (const p of tr.pins) if (Math.abs(p.t - t) <= 0.35 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
    return best;
  };
  const p = own ? near(own) : null;
  if (p) return { x: p.x, y: p.y };
  if (Math.abs(t - seen.t) <= 0.3) return { x: seen.lon, y: seen.lat };
  // Moved with the shelf: the followed products' drift since the sighting.
  const dx: number[] = [], dy: number[] = [];
  for (const tr of shelfTracks) {
    const a = near(tr), b = tr.pins.reduce<{ t: number; x: number; y: number } | null>((best, q) => (Math.abs(q.t - seen.t) <= 0.35 && (!best || Math.abs(q.t - seen.t) < Math.abs(best.t - seen.t)) ? q : best), null);
    if (a && b) { dx.push(wrap(a.x - b.x)); dy.push(a.y - b.y); }
  }
  // Nothing followed on its shelf: where it was seen, for a moment either side (it drifts little in a second).
  if (!dx.length) return Math.abs(t - seen.t) <= 1 ? { x: seen.lon, y: seen.lat } : null;
  return { x: wrap(seen.lon + median(dx)), y: seen.lat + median(dy) };
}

/** A direction (lon, lat) on the screen of a camera aimed (yaw, pitch) with fields (hfov, vfov): fractions, or null behind/outside. */
export function project(lon: number, lat: number, yaw: number, pitch: number, hfov: number, vfov: number): { x: number; y: number } | null {
  const d = wrap(lon - yaw);
  const X = Math.cos(lat) * Math.sin(d), Y = Math.sin(lat), Z = Math.cos(lat) * Math.cos(d);
  const y1 = Y * Math.cos(pitch) - Z * Math.sin(pitch), z1 = Z * Math.cos(pitch) + Y * Math.sin(pitch);
  if (z1 <= 0.05) return null;
  const x = 0.5 + X / z1 / (2 * Math.tan(hfov / 2)), y = 0.5 - y1 / z1 / (2 * Math.tan(vfov / 2));
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

/** The inverse of `project`: a point on the screen (fractions) → its direction (lon, lat). */
export function unproject(x: number, y: number, yaw: number, pitch: number, hfov: number, vfov: number): { lon: number; lat: number } {
  const X = (x - 0.5) * 2 * Math.tan(hfov / 2), y1 = (0.5 - y) * 2 * Math.tan(vfov / 2), z1 = 1;
  // Undo the pitch: y1 = Y cos p − Z sin p; z1 = Z cos p + Y sin p.
  const Y = y1 * Math.cos(pitch) + z1 * Math.sin(pitch), Z = z1 * Math.cos(pitch) - y1 * Math.sin(pitch);
  const r = Math.hypot(X, Y, Z);
  return { lon: wrap(yaw + Math.atan2(X, Z)), lat: Math.asin(Y / r) };
}

/** 3–5: the whole tour. `end` is the recording's length. */
/** Where the camera operator is at a moment (the Lock agent's `hide`, in the original's times): never in a clip. */
/** The furthest a clip is turned away from the operator (rad, ~35°). */
export const DODGE_MAX = 0.6;
export type OperatorAt = (t: number) => { yaw: number; width: number } | null;
export function planTour(seenAll: Seen[], trackList: Track[], end: number, entry = 0, operator: OperatorAt = () => null): TourPlan {
  const seen = seenAll.filter((x) => x.t >= entry);
  const tracks = new Map(trackList.map((t) => [t.n, t]));
  const clips: Clip[] = [];
  const items = new Map<number, OnScreen>();
  let at = 0;
  // The order: from the earliest shelf, the next is the one starting soon after that turns the camera least.
  const left = shelvesOf(seen);
  const ordered: Seen[][] = [];
  let heading: number | null = null;
  while (left.length) {
    left.sort((a, b) => a[0].t - b[0].t);
    const soon = left.filter((g) => g[0].t <= left[0][0].t + 6);
    const dir = (g: Seen[]) => midAngle(g.map((x) => x.lon));
    const pick = heading === null ? soon[0] : soon.reduce((a, b) => (Math.abs(wrap(dir(b) - heading!)) < Math.abs(wrap(dir(a) - heading!)) ? b : a));
    ordered.push(pick);
    heading = dir(pick);
    left.splice(left.indexOf(pick), 1);
  }
  for (const [k, g] of ordered.entries()) {
    const products = [...new Set(g.map((s) => s.n))];
    if (products.length < 1) continue;
    // 3. Round the moment the products looked biggest.
    const big = [...g].sort((a, b) => b.size.w * b.size.h - a.size.w * a.size.h).slice(0, Math.max(1, Math.ceil(g.length / 3)));
    const tc = median(big.map((s) => s.t));
    const span = Math.min(CLIP_MAX, Math.max(CLIP_MIN, g[g.length - 1].t - g[0].t + 1));
    // Round the closest moment, but over the shelf's own sightings: all of them when the clip is long enough.
    const lo = g[0].t - 0.3, hi = g[g.length - 1].t + 0.3;
    let from = tc - span / 2;
    from = hi - lo <= span ? Math.min(lo, Math.max(hi - span, from)) : Math.max(lo, Math.min(hi - span, from));
    from = Math.max(0, Math.min(end - span, from));
    const to = Math.min(end, from + span);
    const firstSeen = new Map<number, Seen>();
    for (const s of big.concat(g)) if (!firstSeen.has(s.n)) firstSeen.set(s.n, s);
    const shelfTracks = products.map((n) => tracks.get(n)).filter((x): x is Track => Boolean(x));
    // 4. The aim: the products' middle each step, smoothed; held where nothing is known.
    const steps: number[] = [];
    for (let t = from; t <= to + 1e-9; t += STEP) steps.push(Math.round(t * 1000) / 1000);
    const raw = steps.map((t) => {
      const ps = products.map((n) => placeAt(n, t, tracks, firstSeen.get(n)!, shelfTracks)).filter((p): p is { x: number; y: number } => Boolean(p));
      return ps.length ? { yaw: midAngle(ps.map((p) => p.x)), pitch: median(ps.map((p) => p.y)), xs: ps.map((p) => p.x) } : null;
    });
    const fallback = { yaw: midAngle(g.map((s) => s.lon)), pitch: median(g.map((s) => s.lat)) };
    // ONE STEADY PAN: from the products' middle over the first third to their middle over the last third,
    // eased in and out; the height held. Never the per-moment middle (it wobbled as products came and went).
    const third = Math.max(1, Math.floor(raw.length / 3));
    const yawsOf = (xs: typeof raw) => xs.filter((x): x is NonNullable<typeof x> => Boolean(x)).map((x) => x.yaw);
    const y0s = yawsOf(raw.slice(0, third)), y1s = yawsOf(raw.slice(-third));
    const yaw0 = y0s.length ? midAngle(y0s) : fallback.yaw, yaw1 = y1s.length ? midAngle(y1s) : yaw0;
    const pitches = raw.filter((x): x is NonNullable<typeof x> => Boolean(x)).map((x) => x.pitch);
    const pitch = Math.max(-0.6, Math.min(0.6, pitches.length ? median(pitches) : fallback.pitch));
    // ⚠️ A FIXED CAMERA, LIKE A TRIPOD (owner, 2026-11-05: "still the same thing"). The pan was sent to ffmpeg's
    // v360 as a command every 0.2 s, and v360 ADDS each command's rotation to the last: the view spun a little
    // further every 0.2 s, into the hallway and other scenes (measured: a big change every 0.2 s through the whole
    // tour). Each clip now holds ONE direction, between the shelf's two ends, and is widened to hold both.
    const turn = wrap(yaw1 - yaw0);
    const yawMid = wrap(yaw0 + turn / 2);
    const aim: Aim[] = steps.map((t) => ({ t, yaw: yawMid, pitch }));
    void AIM_SMOOTH;
    // The zoom: the products' spread round the aim (10th–90th), plus room; within FOV_MIN…FOV_MAX.
    const offs = raw.flatMap((x, i) => (x ? x.xs.map((v) => Math.abs(wrap(v - aim[i].yaw))) : [])).sort((a, b) => a - b);
    const spread = offs.length ? offs[Math.floor(offs.length * 0.9)] : 0.4;
    const hfov = Math.max(FOV_MIN, Math.min(FOV_MAX, 2 * spread * 1.25 + 0.15 + Math.abs(turn) / 2));
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / ASPECT);
    // ⚠️ THE OPERATOR STAYS OUT (2026-11-05: the photographer filled two clips). A clip whose camera would have
    // the operator in view for more than a fifth of it is dropped; the shelf is seen in another or not at all.
    // Turned away from them just enough (at most `DODGE_MAX`), the same way all through the clip; dropped only
    // if that is not enough.
    const clear = (yaw: number, t: number) => { const o = operator(t); return !o || Math.abs(wrap(yaw - o.yaw)) >= hfov / 2 + o.width / 2 + 0.05; };
    let shift = 0;
    if (!aim.every((a) => clear(a.yaw, a.t))) {
      shift = NaN;
      for (let d = 0.05; d <= DODGE_MAX + 1e-9; d += 0.05) {
        if (aim.every((a) => clear(a.yaw + d, a.t))) { shift = d; break; }
        if (aim.every((a) => clear(a.yaw - d, a.t))) { shift = -d; break; }
      }
      if (Number.isNaN(shift)) continue;
      for (const a of aim) a.yaw = wrap(a.yaw + shift);
    }
    clips.push({ shelf: k + 1, from, to, hfov, vfov, aim, products });
    // 5. Each product's place on screen through the clip, in the tour's times.
    for (const n of products) {
      const o = items.get(n) ?? { n, t: [], x: [], y: [] };
      for (const [i, t] of steps.entries()) {
        const p = placeAt(n, t, tracks, firstSeen.get(n)!, shelfTracks);
        const s = p && project(p.x, p.y, aim[i].yaw, aim[i].pitch, hfov, vfov);
        if (s) { o.t.push(Math.round((at + (t - from)) * 100) / 100); o.x.push(Math.round(s.x * 1000) / 1000); o.y.push(Math.round(s.y * 1000) / 1000); }
      }
      if (o.t.length) items.set(n, o);
    }
    at += to - from;
  }
  return { clips, items: [...items.values()], seconds: Math.round(at * 100) / 100 };
}
