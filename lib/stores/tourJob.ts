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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, r2Config, readMastersText, readWalks, uploadFile, webObjectExists, writeMastersJson } from "@/lib/splats/r2";
import { cutParts } from "@/lib/splats/cut-job";
import { originalKeyOf } from "@/lib/splats/cut";
import { readStore } from "./bucket";
import { probe, run } from "./media";
import { originalTime } from "./photoSharp";
import { setJob } from "./jobState";
import { aimCommands, ASPECT, FADE, planTour, type Seen, type TourPlan, type Track } from "./tour";

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
    const t = await readMastersText(`stores/${slug}/sightings.json`).catch(() => null);
    const seen = (t ? (JSON.parse(t) as Seen[]) : []).filter((x) => x && Number.isFinite(x.t) && x.size);
    if (!seen.length) return "No sightings: the finder has not looked at this store's walk yet.";
    // The lights, in the original's times.
    const parts = await cutParts(walkKey).catch(() => []);
    const back = (v: number) => (parts.length ? originalTime(parts, v) : v);
    const walk = (await readWalks()).walks[walkKey];
    const tracks = new Map<number, Track>();
    for (const it of walk?.items ?? []) {
      if (!it.n || !it.pins.length) continue;
      const tr = tracks.get(it.n) ?? { n: it.n, pins: [] };
      tr.pins.push(...it.pins.map((p) => ({ t: back(p.t), x: p.x, y: p.y })));
      tracks.set(it.n, tr);
    }
    // The source in the sightings' times: the upload; else the walk before any cut.
    let src: string;
    if (s.files.video) src = await presignGet(s.files.video.key, "master", 6 * 3600);
    else {
      const orig = originalKeyOf(walkKey);
      src = await presignGet(parts.length && (await webObjectExists(orig)) ? orig : walkKey, "web", 6 * 3600);
    }
    const end = (await probe(src)).seconds || Math.max(...seen.map((x) => x.t)) + 1;
    const plan = planTour(seen, [...tracks.values()], end);
    if (!plan.clips.length) return "No shelves found.";
    const files: string[] = [];
    for (const [i, c] of plan.clips.entries()) {
      await setJob("tour", { busy: true, key: walkKey, note: `filming shelf ${i + 1} of ${plan.clips.length}` });
      const len = c.to - c.from, cmd = join(dir, `c${i}.cmd`), out = join(dir, `c${String(i).padStart(3, "0")}.mp4`);
      writeFileSync(cmd, aimCommands(c));
      const a0 = c.aim[0];
      const vf = [
        `sendcmd=f=${cmd}`,
        `v360@cam=input=e:output=flat:yaw=${deg(a0.yaw)}:pitch=${deg(a0.pitch)}:h_fov=${deg(c.hfov)}:v_fov=${deg(c.vfov)}:w=${TOUR_W}:h=${TOUR_H}:interp=lanczos`,
        "fps=25",
        `fade=t=in:st=0:d=${FADE}`, `fade=t=out:st=${Math.max(0, len - FADE).toFixed(3)}:d=${FADE}`,
      ].join(",");
      await run("ffmpeg", ["-v", "error", "-y", "-ss", c.from.toFixed(3), "-t", len.toFixed(3), "-i", src, "-vf", vf, "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "25", "-threads", "2", out]);
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
      store: slug, walk: walkKey, video: publicUrl(videoKey), made: new Date().toISOString(), w: TOUR_W, h: TOUR_H,
      seconds: plan.seconds, items: plan.items,
      clips: plan.clips.map((c) => { const len = c.to - c.from; const o = { shelf: c.shelf, at: Math.round(at * 100) / 100, len: Math.round(len * 100) / 100, products: c.products }; at += len; return o; }),
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

/** The store's latest tour (the private record), or null. */
export async function readTour(slug: string): Promise<(TourManifest & { plan?: unknown }) | null> {
  try { const t = await readMastersText(tourRecordKey(slug)); return t ? JSON.parse(t) : null; } catch { return null; }
}
