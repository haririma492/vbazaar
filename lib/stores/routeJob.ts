// THE ROUTE OPTIMIZER, ON THE SERVER (owner, 2026-11-04: "lets get that Route
// Optimizer to work and make it be as delicate with pay attention to detail as
// possible"). Free: ffmpeg and arithmetic, no AI.
//
//   1. Motion reader  the whole walk, 5 frames a second: four views 45° down at
//                     the floor (how far and which way it slid: forward, back,
//                     sideways, `frameShift`) and the horizon band (turning,
//                     `ringShift`).
//   2. Planner        `route.ts`: what to keep, every product still shown.
//   3. Join finder    at each cut, the pair of frames within ±`JOIN_REACH` s
//                     (10 a second) that look most alike all round (the camera
//                     where it was, facing the same way): the joins land there.
//   4. Checker        every product shown; each join's likeness said; a join
//                     too unlike (`JOIN_OK`) keeps the stretch between instead,
//                     when that is short (`BRIDGE_S`); else it is flagged.
//   5. Preview        the route as a short flat video facing ahead, for the
//                     owner to watch before anything is cut.
// The proposal is kept at `stores/<slug>/route.json`; «routeApply» hands its parts
// to the walk editor's cut (`cut-job.ts`): frame-accurate, lights and doors moved
// with the picture, the original kept («Put the original back»).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, readMastersText, readWalks, uploadFile, webObjectExists, writeMastersJson, writeWalks } from "@/lib/splats/r2";
import { entryOf, phoneKeyOf } from "@/lib/splats/walks";
import { CAMERA_HEIGHT, VIEW_FOV, VIEW_H, VIEW_PITCH, VIEW_W, frameShift } from "@/lib/splats/pace";
import { bandProfile, ringShift } from "@/lib/splats/walkTurn";
import { cutInfo } from "@/lib/splats/cut-job";
import { SOFT_S } from "@/lib/splats/cut";
import { readStore } from "./bucket";
import { probe, run } from "./media";
import { setJob } from "./jobState";
import { blocksOf, coverageCheck, ensureCoverage, planRoute, previewSlices, productsInView, type Motion } from "./route";
import { paceAt, turnEase, type WalkMotion } from "@/lib/splats/motion";
import { SPEED_DEFAULT } from "@/lib/splats/pace";
import type { Part } from "@/lib/splats/cut";

const FPS = 5;
const YAWS = [0, 90, 180, -90];
const RING_W = 1024, RING_H = 64;
/** Joins are looked for this far either side of where the plan cut (s), 10 frames a second. */
export const JOIN_REACH = 0.8;
/** A join at least this alike (correlation of the whole panorama, small) is smooth. */
export const JOIN_OK = 0.75;
/** A rough join with a stretch this short (s) between its two parts keeps that stretch instead. */
export const BRIDGE_S = 3;
/** A join may shorten the stretch the plan cuts out, but not below this share of it. */
export const KEEP_CUT = 0.8;

export type Join = { at: number; from: number; to: number; likeness: number; smooth: boolean };
export type RouteProposal = {
  walk: string; made: string; seconds: number; kept: number; parts: Part[]; joins: Join[];
  dropped: { back: number; still: number; again: number }; products: number; lost: number[];
  preview?: string; notes: string[];
};

export const routeKey = (slug: string) => `stores/${slug}/route.json`;
export async function readRoute(slug: string): Promise<RouteProposal | null> {
  try { const t = await readMastersText(routeKey(slug)); return t ? (JSON.parse(t) as RouteProposal) : null; } catch { return null; }
}

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);

/** 1. How the camera moved, every 1/FPS s. */
export async function readMotion(src: string, dir: string, seconds: number): Promise<Motion> {
  const views = YAWS.map((y, i) => `[s${i}]v360=e:flat:yaw=${y}:pitch=-${deg(VIEW_PITCH)}:h_fov=${deg(VIEW_FOV)}:v_fov=${deg((VIEW_FOV * VIEW_H) / VIEW_W)}:w=${VIEW_W}:h=${VIEW_H},format=gray[v${i}]`).join(";");
  const graph = `[0:v]fps=${FPS},scale=1920:960,split=5${YAWS.map((_, i) => `[s${i}]`).join("")}[r];${views};${YAWS.map((_, i) => `[v${i}]`).join("")}hstack=inputs=4[o1];[r]crop=1920:240:0:360,scale=${RING_W}:${RING_H},format=gray[o2]`;
  const floorFile = join(dir, "floor.raw"), ringFile = join(dir, "ring.raw");
  await run("ffmpeg", ["-v", "error", "-t", String(Math.ceil(seconds)), "-i", src, "-filter_complex", graph,
    "-map", "[o1]", "-f", "rawvideo", "-pix_fmt", "gray", floorFile, "-map", "[o2]", "-f", "rawvideo", "-pix_fmt", "gray", ringFile]);
  const floor = readFileSync(floorFile), ring = readFileSync(ringFile);
  const FW = VIEW_W * 4, fsz = FW * VIEW_H, rsz = RING_W * RING_H;
  const n = Math.min(Math.floor(floor.length / fsz), Math.floor(ring.length / rsz));
  const viewOf = (f: number, i: number) => { const o = new Uint8Array(VIEW_W * VIEW_H); for (let y = 0; y < VIEW_H; y++) o.set(floor.subarray(f * fsz + y * FW + i * VIEW_W, f * fsz + y * FW + (i + 1) * VIEW_W), y * VIEW_W); return o; };
  const prof = (f: number) => { const rgba = new Uint8Array(rsz * 4); for (let k = 0; k < rsz; k++) { const v = ring[f * rsz + k]; rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = v; } return bandProfile(rgba, RING_W, RING_H); };
  const metres = (dy: number) => (dy * (VIEW_FOV / VIEW_W) * CAMERA_HEIGHT) / Math.sin(VIEW_PITCH) ** 2;
  const dt = 1 / FPS;
  const m: Motion = { dt, fwd: [], side: [], turn: [], sure: [] };
  let last = prof(0);
  for (let f = 0; f + 1 < n; f++) {
    const sh = [0, 1, 2, 3].map((i) => frameShift(viewOf(f, i), viewOf(f + 1, i), VIEW_W, VIEW_H));
    const next = prof(f + 1);
    const r = ringShift(last, next, 40);
    last = next;
    // Forward: the floor ahead and the floor behind slide opposite ways; averaged (the one behind may hold the photographer).
    m.fwd.push((metres(sh[0].dy) - metres(sh[2].dy)) / 2 / dt);
    m.side.push((metres(sh[1].dy) - metres(sh[3].dy)) / 2 / dt);
    m.turn.push(((r.shift * 2 * Math.PI) / RING_W) / dt);
    m.sure.push(Math.min(...sh.map((s) => s.score)));
  }
  return m;
}

/** 3. Small grey panoramas round a moment, 10 a second, for the join finder. */
export async function panoramas(src: string, from: number, to: number): Promise<Array<{ t: number; g: Uint8Array }>> {
  const w = 256, h = 128, s = Math.max(0, from);
  const raw = await run("ffmpeg", ["-v", "error", "-ss", s.toFixed(2), "-t", (to - s).toFixed(2), "-i", src, "-vf", `fps=10,scale=${w}:${h},format=gray`, "-f", "rawvideo", "pipe:1"]);
  const out: Array<{ t: number; g: Uint8Array }> = [];
  for (let i = 0; (i + 1) * w * h <= raw.length; i++) out.push({ t: Math.round((s + i / 10) * 100) / 100, g: new Uint8Array(raw.subarray(i * w * h, (i + 1) * w * h)) });
  return out;
}
export function likeness(a: Uint8Array, b: Uint8Array): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let ab = 0, aa = 0, bb = 0;
  // Only the band round the horizon and below (the top is ceiling lights, the same everywhere).
  const w = 256, h = 128;
  for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.85); y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = a[i] - ma, v = b[i] - mb;
    ab += u * v; aa += u * u; bb += v * v;
  }
  return aa > 1e-6 && bb > 1e-6 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Plan the route of a store's walk and keep the proposal (nothing is cut). Returns what it did, in a sentence. */
export async function planStoreRoute(slug: string): Promise<string> {
  const s = await readStore(slug);
  if (!s?.out.walk) return "No walk.";
  const walkKey = s.out.walk;
  await setJob("route", { busy: true, key: walkKey, note: "reading how the camera moved" });
  const dir = mkdtempSync(join(tmpdir(), "route-"));
  try {
    const info = await cutInfo(walkKey);
    if (info.original) return "This walk was cut before: put the original back first (walk editor, «Cut»), then plan the route on the whole walk.";
    const walk = (await readWalks()).walks[walkKey] ?? null;
    const src = (await webObjectExists(phoneKeyOf(walkKey))) ? await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600) : await presignGet(walkKey, "web", 6 * 3600);
    const { seconds } = await probe(src);
    // 1–2
    const motion = await readMotion(src, dir, seconds);
    await setJob("route", { busy: true, key: walkKey, note: "planning" });
    const seen = productsInView(walk);
    const blocks = blocksOf(motion, seen, seconds);
    const { parts: planned, dropped } = planRoute(blocks, entryOf(walk), seconds);
    let parts = ensureCoverage(seen, planned, seconds);
    // 3–4: each join where the two moments look most alike; a rough one with a short stretch between keeps it.
    await setJob("route", { busy: true, key: walkKey, note: `finding the best moment for ${parts.length - 1} joins` });
    const notes: string[] = [];
    for (let round = 0; round < 2; round++) {
      const joins: Join[] = [];
      for (let i = 0; i + 1 < parts.length; i++) {
        const a = parts[i], b = parts[i + 1];
        const A = await panoramas(src, Math.max(a.from + 1, a.to - JOIN_REACH), a.to + JOIN_REACH);
        const B = await panoramas(src, Math.max(0, b.from - JOIN_REACH), Math.min(b.to - 1, b.from + JOIN_REACH));
        // ⚠️ A JOIN STILL CUTS WHAT THE PLAN CUTS (found on the bookshop: left free, the finder chose two
        // frames 0.1 s apart — "alike", and nothing cut). It may move each end by up to JOIN_REACH, but the
        // stretch between must stay at least `KEEP_CUT` of the planned one.
        const gap = b.from - a.to;
        let best = { from: a.to, to: b.from, l: -1 };
        for (const p of A) for (const q of B) {
          if (q.t - p.t < gap * KEEP_CUT) continue;
          const l = likeness(p.g, q.g);
          if (l > best.l) best = { from: p.t, to: q.t, l };
        }
        joins.push({ at: i, from: best.from, to: best.to, likeness: Math.round(best.l * 100) / 100, smooth: best.l >= JOIN_OK });
      }
      // Moved to the best moments.
      const moved = parts.map((p) => ({ ...p }));
      for (const j of joins) { moved[j.at].to = j.from; moved[j.at + 1].from = j.to; }
      // A rough join with a short stretch between: that stretch is kept instead (no join there at all).
      const rough = joins.filter((j) => !j.smooth && j.to - j.from <= BRIDGE_S);
      if (!rough.length || round === 1) {
        // The rough joins that stay get a soft edge each side (a short dip; `Part.soft` in cut.ts).
        for (const j of joins) {
          if (j.smooth) continue;
          moved[j.at].soft = { ...(moved[j.at].soft ?? {}), out: true };
          moved[j.at + 1].soft = { ...(moved[j.at + 1].soft ?? {}), in: true };
        }
        parts = moved;
        const proposalJoins = joins.map((j, k) => ({ ...j, at: Math.round(parts.slice(0, k + 1).reduce((t, p) => t + p.to - p.from, 0) * 10) / 10 }));
        const lost = coverageCheck(seen, parts);
        const kept = parts.reduce((t, p) => t + p.to - p.from, 0);
        const roughLeft = proposalJoins.filter((j) => !j.smooth).length;
        if (roughLeft) notes.push(`${roughLeft} join${roughLeft > 1 ? "s" : ""} could not be made seamless (the camera was elsewhere): each gets a short dip to black, as a deliberate step. See them in the preview.`);
        if (lost.length) notes.push(`${lost.length} products would not be shown: #${lost.slice(0, 10).join(", #")}.`);
        // 5. The preview AS SHOPPERS RIDE IT (owner, 2026-11-04: "let me see the new"): the kept parts in slices,
        // each at the player's even speed (the speed bar's default) and turned by its ease, the dips at rough joins.
        await setJob("route", { busy: true, key: walkKey, note: "making the preview" });
        let preview: string | undefined;
        try {
          const wm = walkMotionOf(motion);
          // The preview plays as the player does now: one steady rate, no eased turns (owner, 2026-11-05).
          void wm;
          const slices = previewSlices(parts, () => null, () => 0, SPEED_DEFAULT, walk?.pace ?? 0.5);
          const files: string[] = [];
          for (const [k, sl] of slices.entries()) {
            const len = sl.to - sl.from, out = len / sl.rate;
            const vf = [`v360=input=e:output=flat:yaw=${deg(sl.yaw)}:pitch=-10:h_fov=100:v_fov=62:w=960:h=540`, `setpts=(PTS-STARTPTS)/${sl.rate}`, "fps=25"];
            if (sl.fadeIn) vf.push(`fade=t=in:st=0:d=${SOFT_S}`);
            if (sl.fadeOut) vf.push(`fade=t=out:st=${Math.max(0, out - SOFT_S).toFixed(3)}:d=${SOFT_S}`);
            const f = join(dir, `s${String(k).padStart(4, "0")}.mp4`);
            await run("ffmpeg", ["-v", "error", "-y", "-ss", sl.from.toFixed(3), "-t", len.toFixed(3), "-i", src, "-vf", vf.join(","), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-r", "25", "-threads", "2", f]);
            files.push(f);
            if (k % 25 === 0) await setJob("route", { busy: true, key: walkKey, note: `making the preview: ${k + 1} of ${slices.length} slices` });
          }
          const list = join(dir, "list.txt");
          writeFileSync(list, files.map((f) => `file '${f}'`).join("\n") + "\n");
          const out = join(dir, "preview.mp4");
          await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
          const key = `scenes/store-${slug}/route-preview-${Date.now()}.mp4`;
          await uploadFile(key, out, "video/mp4");
          preview = key;
        } catch (e) { notes.push(`No preview: ${(e as Error).message.slice(0, 120)}`); }
        const proposal: RouteProposal = {
          walk: walkKey, made: new Date().toISOString(), seconds: Math.round(seconds * 10) / 10, kept: Math.round(kept * 10) / 10,
          parts: parts.map((p) => ({ from: Math.round(p.from * 100) / 100, to: Math.round(p.to * 100) / 100, ...(p.soft ? { soft: p.soft } : {}) })), joins: proposalJoins,
          dropped, products: new Set(seen.map((p) => p.n)).size, lost, ...(preview ? { preview } : {}), notes,
        };
        await writeMastersJson(routeKey(slug), proposal);
        return `Route planned: ${proposal.kept} s kept of ${proposal.seconds} in ${parts.length} parts (dropped: ${dropped.back} s walking back, ${dropped.again} s passing again, ${dropped.still} s standing); ${proposalJoins.length - roughLeft} of ${proposalJoins.length} joins seamless; ${lost.length ? `${lost.length} products would be lost` : "every product still shown"}.`;
      }
      // Bridge the rough short ones and look again.
      for (const j of rough.sort((x, y) => y.at - x.at)) parts.splice(j.at, 2, { from: parts[j.at].from, to: parts[j.at + 1].to });
      notes.push(`${rough.length} rough join${rough.length > 1 ? "s" : ""} replaced by keeping the few seconds between.`);
    }
    return "No plan.";
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await setJob("route", { busy: false, key: null });
  }
}

// ── Smoothness: the walk's motion, measured and kept (owner, 2026-11-04: "the route optimizer also is in charge
// of smoothness, to fix sharp turns, fast moves in one spot and slow in another") ─────────────────────────────

/**
 * A reading → the walk's motion as the player uses it: reading i is the move
 * from frame i to frame i + 1, so the heading after it belongs at (i + 1)·dt —
 * stamped at i·dt, the ease would have lagged the picture by a frame.
 */
export function walkMotionOf(m: Motion): WalkMotion {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const yaw = [0];
  for (const w of m.turn) yaw.push(r3(yaw[yaw.length - 1] + w * m.dt));
  const speed = m.fwd.map((f, i) => r3(Math.hypot(f, m.side[i])));
  speed.push(speed[speed.length - 1] ?? 0);
  return { dt: m.dt, speed, yaw };
}

/** Measure how the camera moved through the walk as it is now and keep it on the walk (`Walk.motion`). Free. */
export async function measureSmoothness(walkKey: string): Promise<string> {
  const before = (await readWalks()).walks[walkKey];
  if (!before) return "No such walk.";
  if (before.projection === "flat" || before.projection === "eac") return "Not a 360° walk.";
  const dir = mkdtempSync(join(tmpdir(), "smooth-"));
  try {
    const src = (await webObjectExists(phoneKeyOf(walkKey))) ? await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600) : await presignGet(walkKey, "web", 6 * 3600);
    const { seconds } = await probe(src);
    const m = await readMotion(src, dir, seconds);
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const { speed, yaw: heading } = walkMotionOf(m);
    const walks = await readWalks();
    const w = walks.walks[walkKey];
    if (!w) return "The walk is gone.";
    await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, motion: { dt: m.dt, speed, yaw: heading, rev: w.rev ?? 0 } } } }, walks);
    return `Motion kept: ${speed.length} moments; the player evens the speed and eases sharp turns from it.`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SMOOTH_PENDING = "smooth/pending.json";
let smoothing = false;
async function readSmoothQueue(): Promise<string[]> {
  try { const t = await readMastersText(SMOOTH_PENDING); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; }
}
export async function queueSmooth(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await writeMastersJson(SMOOTH_PENDING, [...new Set([...(await readSmoothQueue()), ...keys])]);
  void drainSmooth();
}
/** Every 360° walk whose motion is not measured, or was measured before its last cut. */
export async function walksToSmooth(): Promise<string[]> {
  const all = (await readWalks()).walks;
  return Object.keys(all).filter((k) => {
    const w = all[k];
    return /^scenes\//.test(k) && w.projection !== "flat" && w.projection !== "eac" && (!w.motion || (w.motion.rev ?? 0) !== (w.rev ?? 0));
  });
}
export async function drainSmooth(): Promise<void> {
  if (smoothing) return;
  smoothing = true;
  try {
    for (;;) {
      const [key, ...rest] = await readSmoothQueue();
      if (!key) return;
      await setJob("smooth", { busy: true, key });
      try { console.log("[smooth]", key, await measureSmoothness(key)); } catch (e) { console.error("[smooth]", key, e); }
      await setJob("smooth", { busy: false, key: null });
      await writeMastersJson(SMOOTH_PENDING, rest);
    }
  } finally {
    smoothing = false;
  }
}
