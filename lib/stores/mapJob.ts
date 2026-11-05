// THE STORE MAP — the job (the rules are `storeMap.ts`). Free: ffmpeg and our
// own code, no AI. One at a time; state in `jobs/map.json`.
//
//   input   the upload (the recording the sightings are timed by), the
//           sightings (the finder's and the Shelf finder's) and every light's
//           path (`tourInputs`), the store's list (unnamed products → review);
//   1       how the camera moved, 5 times a second (`readMotion`, the Route
//           optimizer's own reader), kept in `stores/<slug>/motion.json` so a
//           second run does not read the video again;
//   2       small grey panoramas, one a second, for repeated visits: pairs at
//           least `LOOP_DT` s apart that the path puts close together are
//           compared over every turn (`ringMatch`); the best match per moment;
//   3       the map (`buildMap`), keeping the last map's shelf ids;
//   output  `stores/<slug>/map.json` (private: the operator's and the
//           builders'); the Shelf Tour builders read its order.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, readCatalogue, readMastersText, webObjectExists, writeMastersJson } from "@/lib/splats/r2";
import { phoneKeyOf } from "@/lib/splats/walks";
import { probe, run } from "./media";
import { setJob } from "./jobState";
import { sceneOf } from "./store";
import { readMotion } from "./routeJob";
import type { Motion } from "./route";
import { planShelves, type Boxed } from "./levels";
import { shelfSightingsKey, tourInputs } from "./tourJob";
import { buildMap, integratePath, poseAt, ringMatch, LOOP_DT, LOOP_NEAR, LOOP_OK, type Loop, type Observation, type StoreMap } from "./storeMap";

export const mapKey = (slug: string) => `stores/${slug}/map.json`;
const motionKey = (slug: string) => `stores/${slug}/motion.json`;
/** Panoramas for repeated visits: this size, one a second. */
const PW = 128, PH = 64;
/** A light's steps taken as rays: at most this many a second. */
const PIN_RATE = 2;
let busy = false;

export async function readStoreMap(slug: string): Promise<StoreMap | null> {
  try { const t = await readMastersText(mapKey(slug)); return t ? (JSON.parse(t) as StoreMap) : null; } catch { return null; }
}

export async function buildStoreMap(slug: string): Promise<string> {
  if (busy) return "The map builder is busy.";
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "map-"));
  try {
    const inp = await tourInputs(slug);
    if (typeof inp === "string") return inp;
    const { s, walkKey, seen, tracks, parts, entry } = inp;
    // The source in the sightings' times. The 4K phone copy is the same recording when the walk was never cut
    // (faster to read than the 8K upload); otherwise the upload.
    const src = !parts.length && (await webObjectExists(phoneKeyOf(walkKey))) ? await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600) : inp.src;
    const srcId = !parts.length ? `phone:${walkKey}` : `upload:${s.files.video?.key ?? walkKey}`;
    const { seconds } = await probe(src);
    // 1: the motion, kept.
    let motion: Motion | null = null;
    try { const t = await readMastersText(motionKey(slug)); const c = t ? JSON.parse(t) as { src: string; motion: Motion } : null; if (c?.src === srcId && c.motion?.fwd?.length) motion = c.motion; } catch { /* read it again */ }
    if (!motion) {
      await setJob("map", { busy: true, key: slug, note: "reading how the camera moved (a few minutes)" });
      motion = await readMotion(src, dir, seconds);
      await writeMastersJson(motionKey(slug), { src: srcId, made: new Date().toISOString(), motion });
    }
    const path = integratePath(motion);
    // 2: repeated visits.
    await setJob("map", { busy: true, key: slug, note: "looking for places the camera passed twice" });
    const loops: Loop[] = [];
    try {
      const file = join(dir, "pano.raw");
      await run("ffmpeg", ["-v", "error", "-y", "-t", String(Math.ceil(seconds)), "-i", src, "-vf", `fps=1,scale=${PW}:${PH},format=gray`, "-f", "rawvideo", file]);
      const raw = readFileSync(file), sz = PW * PH;
      const frames = Array.from({ length: Math.floor(raw.length / sz) }, (_, i) => ({ t: i + 0.5, g: new Uint8Array(raw.subarray(i * sz, (i + 1) * sz)) }));
      for (let j = 0; j < frames.length; j++) {
        const B = poseAt(path, frames[j].t);
        if (!B) continue;
        let best: Loop | null = null;
        for (let i = 0; i < j; i++) {
          if (frames[j].t - frames[i].t < LOOP_DT) break;
          const A = poseAt(path, frames[i].t);
          if (!A || Math.hypot(A.x - B.x, A.y - B.y) > LOOP_NEAR) continue;
          const m = ringMatch(frames[i].g, frames[j].g, PW, PH, 2);
          if (m.score >= LOOP_OK && (!best || m.score > best.score)) best = { a: frames[i].t, b: frames[j].t, score: m.score, shift: m.shift };
        }
        // One loop per stretch: a later moment matching the same earlier one adds nothing new.
        if (best && !loops.some((l) => Math.abs(l.a - best!.a) < 3 && Math.abs(l.b - best!.b) < 3)) loops.push(best);
      }
    } catch (e) { console.error("[map] panoramas", slug, e); }
    // 3: observations — every sighting, and each light's steps (a few a second).
    const observations: Observation[] = seen.map((x) => ({ n: x.n, t: x.t, lon: x.lon }));
    for (const tr of tracks.values()) {
      let last = -Infinity;
      for (const p of [...tr.pins].sort((a, b) => a.t - b.t)) if (p.t - last >= 1 / PIN_RATE) { observations.push({ n: tr.n, t: p.t, lon: p.x }); last = p.t; }
    }
    // The shelves: the Shelf finder's pictures; else the finder's sightings, grouped the same way.
    const sh = await readMastersText(shelfSightingsKey(slug)).catch(() => null);
    const boxed = ((sh ? (JSON.parse(sh) as Boxed[]) : []) as Boxed[]).filter((x) => x && Number.isFinite(x.t) && x.size && x.t >= entry - 0.5);
    const shelves = planShelves(boxed.length ? boxed : seen.filter((x) => x.t >= entry - 0.5));
    const c = await readCatalogue(sceneOf(slug));
    const unnamed = (c?.products ?? []).filter((p) => !p.en?.trim() && !p.fa?.trim()).map((p) => p.n);
    const prev = await readStoreMap(slug);
    const map = buildMap({ store: slug, made: new Date().toISOString(), path, loops, observations, shelves, entry, prev, unnamed });
    if (!boxed.length) map.notes.push("No Shelf finder pictures yet: the shelves are the finder's sightings grouped. Run the Shelf finder for one picture per shelf.");
    await writeMastersJson(mapKey(slug), map);
    const q = map.quality;
    return `Store map: ${q.shelves} shelves (${q.merged} merged from partial views), ${q.triangulated} of ${q.products} products placed by triangulation, ${q.loopsClosed} repeated visit${q.loopsClosed === 1 ? "" : "s"} corrected; ${map.review.length} items to review. The Shelf Tour follows the map's order the next time it is built.`;
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("map", { busy: false, key: null });
  }
}
