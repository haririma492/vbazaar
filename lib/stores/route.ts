// THE ROUTE OPTIMIZER'S RULES (owner, 2026-11-04: "edit the ride - the route so
// there is not so much back and forth and shoppers get a smooth move from shelf
// to shelf in progression rather than many back and forth that I did during
// filming"; "make it be as delicate with pay attention to detail as possible").
//
// Pure: from how the camera moved (`Motion`, read off the floor and the horizon
// by `routeJob.ts`) and which products are in view when (the walk's lights),
// which stretches of the walk to keep (`planRoute`), in order, so the walk goes
// on from shelf to shelf. The cut itself is the walk editor's own (`cut-job.ts`):
// frame-accurate, the lights and doors move with the picture, the original kept.
//
//   kept:    the way in through the store's door (`entry`), every stretch
//            that shows a product not shown yet, and a short look (`LOOK_S`)
//            where the photographer stood still;
//   dropped: walking backward (unless it alone shows some products), standing
//            on after the look, and passing again where the route has been,
//            with nothing new in view.
// Then the parts are tidied: small gaps filled (a jump of a fraction of a second
// is worse than a moment more), slivers dropped or grown, at most `MAX_ROUTE_PARTS`.
// Every product shown before must be shown after (`coverageCheck`).

import type { Walk } from "@/lib/splats/walks";

/** How the camera moved, sampled every `dt` s: forward (m/s, + ahead), sideways (m/s), turning (rad/s), and how sure (0–1). */
export type Motion = { dt: number; fwd: number[]; side: number[]; turn: number[]; sure: number[] };
export type { Part } from "@/lib/splats/cut";
import type { Part } from "@/lib/splats/cut";
export type Block = { t: number; kind: "forward" | "back" | "still" | "turn"; x: number; y: number; products: number[] };

/** Blocks the walk is judged in (s). */
export const BLOCK_S = 0.5;
/** Walking backward: slower than this (m/s) for a block. */
export const BACK = -0.12;
/** Standing: slower than this (m/s), turning slower than `STILL_TURN` (rad/s). */
export const STILL = 0.07, STILL_TURN = 0.09;
/** Turning on the spot: faster than this (rad/s, ~25°/s). */
export const TURNING = 0.45;
/** A stand keeps this long: time to look at the shelf (s). */
export const LOOK_S = 1.5;
/** Within this (m) of where the route has been, more than `AGO_S` s earlier, is passing again. */
export const NEAR_M = 0.7, AGO_S = 5;
/** Gaps shorter than this (s) are kept, not cut: a tiny jump is worse than a moment more. */
export const FILL_S = 1.0;
/** A part shorter than this (s) is grown to it, or dropped when it shows nothing new. */
export const MIN_PART_S = 1.5;
export const MAX_ROUTE_PARTS = 40; // the cut's MAX_PARTS

/** Mean of v over a window of ±k samples (a 1 s smoothing at 5 a second is k = 2). */
function smooth(v: number[], k: number): number[] {
  return v.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(v.length - 1, i + k); j++) { s += v[j]; n++; }
    return n ? s / n : 0;
  });
}

/** Which products are in view at each moment, from the walk's lights (their first and last pin). */
export function productsInView(walk: Walk | null): Array<{ n: number; from: number; to: number }> {
  return (walk?.items ?? []).filter((it) => it.n && it.pins.length).map((it) => ({ n: it.n!, from: it.pins[0].t, to: it.pins[it.pins.length - 1].t }));
}

/** The walk in blocks: how the camera moved in each, where it was (an approximate map), what it showed. */
export function blocksOf(m: Motion, seen: Array<{ n: number; from: number; to: number }>, duration: number): Block[] {
  const k = Math.max(1, Math.round(0.5 / m.dt));
  const fwd = smooth(m.fwd, k), side = smooth(m.side, k), turn = smooth(m.turn, k);
  const out: Block[] = [];
  let th = 0, x = 0, y = 0;
  for (let b = 0; b * BLOCK_S < duration; b++) {
    // Samples by time, not by count (at 5 a second, 0.5 s is 2.5 samples: counted, the blocks drifted).
    const i0 = Math.round((b * BLOCK_S) / m.dt), i1 = Math.min(fwd.length, Math.round(((b + 1) * BLOCK_S) / m.dt));
    let f = 0, s = 0, w = 0, nn = 0;
    for (let i = i0; i < i1; i++) {
      f += fwd[i]; s += side[i]; w += turn[i]; nn++;
      // The map: turned, then moved along where the camera faced.
      th += turn[i] * m.dt;
      x += (fwd[i] * Math.cos(th) - side[i] * Math.sin(th)) * m.dt;
      y += (fwd[i] * Math.sin(th) + side[i] * Math.cos(th)) * m.dt;
    }
    if (nn) { f /= nn; s /= nn; w /= nn; }
    const speed = Math.hypot(f, s);
    const kind: Block["kind"] = f < BACK && Math.abs(f) > Math.abs(s) * 0.7 ? "back" : Math.abs(w) > TURNING ? "turn" : speed < STILL && Math.abs(w) < STILL_TURN ? "still" : "forward";
    const t = b * BLOCK_S;
    const products = seen.filter((p) => p.from < t + BLOCK_S && p.to >= t).map((p) => p.n);
    out.push({ t, kind, x, y, products: [...new Set(products)] });
  }
  return out;
}

/** The plan: which blocks are kept, and why each dropped one was dropped. */
export function planRoute(blocks: Block[], entry: number, duration: number): { parts: Part[]; dropped: { back: number; still: number; again: number } } {
  const keep = blocks.map(() => false);
  const covered = new Set<number>();
  const kept: Block[] = [];
  const dropped = { back: 0, still: 0, again: 0 };
  let stillRun = 0;
  blocks.forEach((b, i) => {
    const fresh = b.products.filter((n) => !covered.has(n));
    let k: boolean;
    if (b.t < entry + 2) k = true; // the way in through the door, as filmed
    else if (b.kind === "back") { k = fresh.length >= 2; if (!k) dropped.back += BLOCK_S; }
    else if (b.kind === "still") {
      stillRun += BLOCK_S;
      k = fresh.length > 0 || stillRun <= LOOK_S;
      if (!k) dropped.still += BLOCK_S;
    } else {
      const again = kept.some((q) => b.t - q.t > AGO_S && Math.hypot(q.x - b.x, q.y - b.y) < NEAR_M);
      k = fresh.length > 0 || !again;
      if (!k) dropped.again += BLOCK_S;
    }
    if (b.kind !== "still") stillRun = 0;
    keep[i] = k;
    if (k) { kept.push(b); for (const n of b.products) covered.add(n); }
  });
  return { parts: tidy(blocks, keep, duration), dropped };
}

/** Kept blocks → parts: gaps under `FILL_S` filled, slivers grown or dropped, at most `MAX_ROUTE_PARTS`. */
export function tidy(blocks: Block[], keep: boolean[], duration: number): Part[] {
  let parts: Part[] = [];
  blocks.forEach((b, i) => {
    if (!keep[i]) return;
    const end = Math.min(duration, b.t + BLOCK_S);
    const last = parts[parts.length - 1];
    if (last && b.t - last.to < FILL_S + 1e-9) last.to = end;
    else parts.push({ from: b.t, to: end });
  });
  // Slivers: grown to MIN_PART_S round their middle (they hold something new, or they would not be kept).
  parts = parts.map((p) => {
    if (p.to - p.from >= MIN_PART_S) return p;
    const mid = (p.from + p.to) / 2;
    return { from: Math.max(0, mid - MIN_PART_S / 2), to: Math.min(duration, mid + MIN_PART_S / 2) };
  });
  // Grown parts may now touch: joined.
  parts = parts.reduce<Part[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (last && p.from - last.to < FILL_S) last.to = Math.max(last.to, p.to);
    else acc.push({ ...p });
    return acc;
  }, []);
  // Too many joins: the smallest gaps are kept until few enough.
  while (parts.length > MAX_ROUTE_PARTS) {
    let g = 0;
    for (let i = 1; i < parts.length - 1; i++) if (parts[i + 1].from - parts[i].to < parts[g + 1].from - parts[g].to) g = i;
    parts.splice(g, 2, { from: parts[g].from, to: parts[g + 1].to });
  }
  return parts.map((p) => ({ from: Math.round(p.from * 100) / 100, to: Math.round(p.to * 100) / 100 }));
}

/** Products shown in the walk that the route would not show (it must be none). */
export function coverageCheck(seen: Array<{ n: number; from: number; to: number }>, parts: Part[]): number[] {
  const shown = new Set(seen.filter((p) => parts.some((q) => p.from < q.to && p.to > q.from)).map((p) => p.n));
  return [...new Set(seen.map((p) => p.n))].filter((n) => !shown.has(n));
}

/** Parts grown so every product is shown: for each missing one, its own stretch (at least `MIN_PART_S`) is kept. */
export function ensureCoverage(seen: Array<{ n: number; from: number; to: number }>, parts: Part[], duration: number): Part[] {
  const missing = coverageCheck(seen, parts);
  if (!missing.length) return parts;
  const add = missing.map((n) => {
    const p = seen.filter((q) => q.n === n).sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const mid = (p.from + p.to) / 2, half = Math.max(MIN_PART_S, p.to - p.from) / 2;
    return { from: Math.max(0, mid - half), to: Math.min(duration, mid + half) };
  });
  const all = [...parts, ...add].sort((a, b) => a.from - b.from);
  return all.reduce<Part[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (last && p.from - last.to < FILL_S) last.to = Math.max(last.to, p.to);
    else acc.push({ ...p });
    return acc;
  }, []).map((p) => ({ from: Math.round(p.from * 100) / 100, to: Math.round(p.to * 100) / 100 }));
}
