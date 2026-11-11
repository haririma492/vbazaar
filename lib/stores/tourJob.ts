// THE SHELF TOUR BUILDER — the job (owner, 2026-11-05; the plan is `tour.ts`).
// Free: no AI (the finder's sightings are reused), only ffmpeg on our server.
//
//   inputs  the store's sightings (`stores/<slug>/sightings.json`, the original
//           recording's times), its lights (in the walk's times, taken back to
//           the original's through the cut), and the upload itself (the
//           sharpest source; the walk as it was before any cut without one);
//   output  `scenes/store-<slug>/tour-<stamp>.mp4` (1280×720, H.264, a clip a
//           shelf, each faded in and out) and `scenes/store-<slug>/tour.json`
//           (the latest: its video, its clips and every product's place on
//           screen through it), both public: `/vca/tour?s=<slug>` plays them.
// One at a time; state in `jobs/tour.json` for the dashboard and the store page.
import { mediaPath } from "@/lib/splats/media";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, r2Config, readMastersText, readWalks, uploadFile, webObjectExists, writeMastersJson } from "@/lib/splats/r2";
import { cutParts } from "@/lib/splats/cut-job";
import { entryOf, hideAt, lensOf } from "@/lib/splats/walks";
import { flatNotYet } from "@/lib/splats/lens";

/** Original time → the cut walk's time, or null when that moment was cut out. */
export function cutTimeOf(parts: Array<{ from: number; to: number }>, t: number): number | null {
  if (!parts.length) return t;
  let at = 0;
  for (const p of parts) {
    if (t >= p.from && t <= p.to) return at + (t - p.from);
    at += p.to - p.from;
  }
  return null;
}
import { originalKeyOf } from "@/lib/splats/cut";
import { readStore } from "./bucket";
import { probe, run } from "./media";
import { originalTime } from "./photoSharp";
import { setJob } from "./jobState";
import { ASPECT, FADE, HOLD, SLOW, clipLen, planTour, type OperatorAt, type Seen, type TourPlan, type Track } from "./tour";

export const TOUR_W = 1280, TOUR_H = Math.round(TOUR_W / ASPECT);
export type TourManifest = Omit<TourPlan, "clips"> & {
  store: string; video: string; made: string; w: number; h: number; walk: string;
  clips: Array<{ shelf: number; at: number; len: number; products: number[] }>;
};
export const tourKey = (slug: string) => `scenes/store-${slug}/tour.json`;
export const tourRecordKey = (slug: string) => `stores/${slug}/tour.json`;

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);
let busy = false;
const publicUrl = (key: string) => `${r2Config().publicBase}/${key}`;

/** Build the store's Shelf tour. Returns what it did, in a sentence. */
export async function buildTour(slug: string): Promise<string> {
  if (busy) return "The Shelf tour builder is busy with another store.";
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "tour-"));
  try {
    const s = await readStore(slug);
    const walkKey = s?.out.walk;
    if (!s || !walkKey) return "No walk.";
    await setJob("tour", { busy: true, key: walkKey, note: "reading the sightings" });
    const inp = await tourInputs(slug);
    if (typeof inp === "string") return inp;
    const { seen, tracks, src, end, entry, operator } = inp;
    const plan = planTour(seen, [...tracks.values()], end, entry, operator);
    if (!plan.clips.length) return "No shelves found.";
    const files: string[] = [];
    for (const [i, c] of plan.clips.entries()) {
      await setJob("tour", { busy: true, key: walkKey, note: `filming shelf ${i + 1} of ${plan.clips.length}` });
      const len = c.to - c.from, out = join(dir, `c${String(i).padStart(3, "0")}.mp4`);
      const a0 = c.aim[0];
      const vf = [
        `v360=input=e:output=flat:yaw=${deg(a0.yaw)}:pitch=${deg(a0.pitch)}:h_fov=${deg(c.hfov)}:v_fov=${deg(c.vfov)}:w=${TOUR_W}:h=${TOUR_H}:interp=lanczos`,
        "fps=25",
        // Half speed, the frames between computed (not repeated), then the opening still, then the fades.
        `setpts=${SLOW}*PTS`, "minterpolate=fps=25:mi_mode=mci:mc_mode=aobmc:vsbmc=1",
        `tpad=start_mode=clone:start_duration=${HOLD}`,
        `fade=t=in:st=0:d=${FADE}`, `fade=t=out:st=${Math.max(0, clipLen(c) - FADE).toFixed(3)}:d=${FADE}`,
      ].join(",");
      await run("ffmpeg", ["-v", "error", "-y", "-ss", c.from.toFixed(3), "-t", len.toFixed(3), "-i", src, "-vf", vf, "-an",
        // A keyframe every 0.2 s and no B-frames: dragging along a shelf, backwards too, lands at once.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "5", "-bf", "0", "-pix_fmt", "yuv420p", "-r", "25", "-threads", "4", out]);
      files.push(out);
    }
    await setJob("tour", { busy: true, key: walkKey, note: "putting the shelves together" });
    const list = join(dir, "list.txt");
    writeFileSync(list, files.map((f) => `file '${f}'`).join("\n") + "\n");
    const video = join(dir, "tour.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", video]);
    const videoKey = `scenes/store-${slug}/tour-${Date.now()}.mp4`;
    await uploadFile(videoKey, video, "video/mp4");
    let at = 0;
    const manifest: TourManifest = {
      store: slug, walk: walkKey, video: mediaPath(videoKey), made: new Date().toISOString(), w: TOUR_W, h: TOUR_H,
      seconds: plan.seconds, items: plan.items,
      clips: plan.clips.map((c) => { const len = clipLen(c); const o = { shelf: c.shelf, at: Math.round(at * 100) / 100, len: Math.round(len * 100) / 100, products: c.products }; at += len; return o; }),
    };
    const mf = join(dir, "tour.json");
    writeFileSync(mf, JSON.stringify(manifest));
    await uploadFile(tourKey(slug), mf, "application/json");
    // The record kept privately too, with the clips' source times (for checking).
    await writeMastersJson(tourRecordKey(slug), { ...manifest, plan: plan.clips.map(({ shelf, from, to, hfov }) => ({ shelf, from, to, hfov })) });
    return `Shelf tour made: ${plan.clips.length} shelves, ${Math.round(plan.seconds)} s, ${plan.items.length} products on screen.`;
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("tour", { busy: false, key: null });
  }
}

export const shelfSightingsKey = (slug: string) => `stores/${slug}/shelf-sightings.json`;

/** A light with no box: about a product's size seen from the aisle (radians; Saraye Bamdad's median is 0.14 × 0.23). */
export const LIGHT_SIZE = { w: 0.15, h: 0.18 };

/**
 * What a tour (and the Shelf finder) is made from: the sightings (the finder's, else each light's middle,
 * plus the Shelf finder's), every product's path, the source in the sightings' times and its length.
 */
export async function tourInputs(slug: string): Promise<string | { s: NonNullable<Awaited<ReturnType<typeof readStore>>>; walkKey: string; seen: Seen[]; tracks: Map<number, Track>; src: string; end: number; parts: Array<{ from: number; to: number }>; entry: number; operator: OperatorAt }> {
    const s = await readStore(slug);
    const walkKey = s?.out.walk;
    if (!s || !walkKey) return "No walk.";
    // ⚠️ 360° ONLY, FOR NOW (2026-11-11): the Shelf finder, the store map and the Shelf Tour place shelves round
    // the camera. A store filmed flat (`lens.ts`) is told so, plainly, by each of them.
    if (lensOf((await readWalks()).walks[walkKey])) return flatNotYet("the Shelf Tour (with its Shelf finder and store map)");
    const t = await readMastersText(`stores/${slug}/sightings.json`).catch(() => null);
    let seen = (t ? (JSON.parse(t) as Seen[]) : []).filter((x) => x && Number.isFinite(x.t) && x.size);
    // The lights, in the original's times.
    const parts = await cutParts(walkKey).catch(() => []);
    const back = (v: number) => (parts.length ? originalTime(parts, v) : v);
    const walk = (await readWalks()).walks[walkKey];
    const tracks = new Map<number, Track>();
    const longest = new Map<number, { pins: Array<{ t: number; x: number; y: number }>; size: { w: number; h: number }; sized: boolean }>();
    for (const it of walk?.items ?? []) {
      if (!it.n || !it.pins.length) continue;
      const pins = it.pins.map((p) => ({ t: back(p.t), x: p.x, y: p.y }));
      const tr = tracks.get(it.n) ?? { n: it.n, pins: [] };
      tr.pins.push(...pins);
      tracks.set(it.n, tr);
      // ⚠️ A LIGHT PINNED BEFORE LIGHTS CARRIED THEIR BOX (stores tagged before 2026-11-04: HeloGolab, test3)
      // has no size; it stands in at a typical product's (`LIGHT_SIZE`), or the store would have no tour at all.
      const size = it.size ?? LIGHT_SIZE;
      const prev = longest.get(it.n);
      if (!prev || (it.size && !prev.sized) || (Boolean(it.size) === prev.sized && pins.length > prev.pins.length)) longest.set(it.n, { pins, size, sized: Boolean(it.size) });
    }
    // ⚠️ A STORE FOUND BEFORE SIGHTINGS WERE KEPT (the bookshop, found 2026-11-04 before «sightings.json»
    // existed): each light's middle moment stands in for its sighting, at the size the finder boxed.
    if (!seen.length) {
      seen = [...longest.entries()].map(([n, l]) => { const p = l.pins[l.pins.length >> 1]; return { n, t: p.t, lon: p.x, lat: p.y, size: l.size }; });
    }
    // The Shelf finder's sightings (`shelfFinder.ts`), in the same times.
    const sh = await readMastersText(shelfSightingsKey(slug)).catch(() => null);
    if (sh) seen = seen.concat((JSON.parse(sh) as Seen[]).filter((x) => x && Number.isFinite(x.t) && x.size));
    if (!seen.length) return "No sightings and no lights: the finder has not looked at this store's walk yet.";
    // The source in the sightings' times: the upload; else the walk before any cut.
    let src: string;
    if (s.files.video) src = await presignGet(s.files.video.key, "master", 6 * 3600);
    else {
      const orig = originalKeyOf(walkKey);
      src = await presignGet(parts.length && (await webObjectExists(orig)) ? orig : walkKey, "web", 6 * 3600);
    }
    const end = (await probe(src)).seconds || Math.max(...seen.map((x) => x.t)) + 1;
    // The store's door, in the original's times: the tour stays inside (owner, 2026-11-05).
    const entry = back(entryOf(walk ?? null));
    // The operator, from the Lock agent (in the walk's times): the tour never aims at them.
    const hide = walk?.hide;
    const operator = (t: number) => { if (!hide) return null; const ct = cutTimeOf(parts, t); return ct === null ? null : hideAt(hide, ct); };
    return { s, walkKey, seen, tracks, src, end, parts, entry, operator };
}

/** The store's latest tour (the private record), or null. */
export async function readTour(slug: string): Promise<(TourManifest & { plan?: unknown }) | null> {
  try { const t = await readMastersText(tourRecordKey(slug)); return t ? JSON.parse(t) : null; } catch { return null; }
}
