// THE SHELF TOUR, FILMED SHELF BY SHELF AND LEVEL BY LEVEL (owner, 2026-11-05;
// the moves are `choreo.ts`, the shelves and levels `levels.ts`). Free: no AI.
//
// For each shelf (in the store map's order when there is one, else walking order; inside the store only): one still of the
// whole shelf, cut from the upload at its closest moment (v360, Lanczos), is
// filmed by the virtual camera of `choreograph` — whole shelf, each level in
// turn (serpentine), whole shelf — rendered frame by frame here (`frameOf`)
// and encoded by ffmpeg (a keyframe every 0.2 s, faded in and out). The
// products' places on every step come from the same still, so the lights sit
// exactly on the books. The result is the same tour the player already plays
// (`scenes/store-<slug>/tour.json`): a clip a shelf, it stops at a shelf's end,
// the shopper goes back and forth, «Next shelf ›» moves on.
import { mediaPath } from "@/lib/splats/media";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, r2Config, readMastersText, uploadFile, writeMastersJson } from "@/lib/splats/r2";
import { readStore } from "./bucket";
import { run, v360Yaw } from "./media";
import { project } from "./tour";
import { planShelves, stillSize, type Boxed, type Frame } from "./levels";
import { ASPECT, choreograph, frameOf, lengthOf, windowAt, type Box } from "./choreo";
import { setJob } from "./jobState";
import { orderShelvesByMap } from "./storeMap";
import { readStoreMap } from "./mapJob";
import { shelfSightingsKey, tourInputs, tourKey, tourRecordKey, type TourManifest } from "./tourJob";

const OW = 1280, OH = 720, FPS = 25, STILL_W = 2400, STEP = 0.2, FADE = 0.5;
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);
let busy = false;

/** Raw RGB of a still of `f` at `t`, `w`×`h`. */
async function stillOf(src: string, t: number, f: Frame, w: number, h: number, hfov: number, vfov: number): Promise<Uint8Array> {
  return new Uint8Array(await run("ffmpeg", ["-v", "error", "-ss", t.toFixed(3), "-i", src, "-frames:v", "1", "-vf",
    `v360=input=e:output=flat:yaw=${v360Yaw(f.lon).toFixed(3)}:pitch=${deg(f.lat)}:h_fov=${deg(hfov)}:v_fov=${deg(vfov)}:w=${w}:h=${h}:interp=lanczos`,
    "-threads", "2", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]));
}

/** Film one shelf: frames rendered here, piped to ffmpeg. */
async function film(still: Uint8Array, W: number, H: number, levels: Box[], out: string): Promise<{ keys: ReturnType<typeof choreograph>; len: number }> {
  const keys = choreograph(W, H, levels), len = lengthOf(keys), n = Math.ceil(len * FPS);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${OW}x${OH}`, "-r", String(FPS), "-i", "pipe:0",
    "-vf", `fade=t=in:st=0:d=${FADE},fade=t=out:st=${Math.max(0, n / FPS - FADE).toFixed(3)}:d=${FADE}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "5", "-bf", "0", "-pix_fmt", "yuv420p", "-threads", "2", out], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => { err += String(d); });
  const done = new Promise<number>((r) => ff.on("close", (c) => r(c ?? 1)));
  const buf = new Uint8Array(OW * OH * 3);
  for (let f = 0; f < n; f++) {
    frameOf(still, W, H, windowAt(keys, f / FPS), OW, OH, buf);
    if (!ff.stdin.write(Buffer.from(buf))) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 25 === 0) await new Promise((r) => setImmediate(r)); // let the server breathe
  }
  ff.stdin.end();
  if ((await done) !== 0) throw new Error(`ffmpeg: ${err.slice(0, 200)}`);
  return { keys, len: n / FPS };
}

export async function buildShelfFilm(slug: string): Promise<string> {
  if (busy) return "The Shelf Tour builder is busy.";
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "shelffilm-"));
  try {
    const s = await readStore(slug);
    if (!s?.files.video || !s.out.walk) return "No upload or walk.";
    const inp = await tourInputs(slug);
    if (typeof inp === "string" && /^This store's video is flat/.test(inp)) return inp;
    const entry = typeof inp === "string" ? 0 : inp.entry;
    const t = await readMastersText(shelfSightingsKey(slug)).catch(() => null);
    const boxed = (t ? (JSON.parse(t) as Boxed[]) : []).filter((x) => x && Number.isFinite(x.t) && x.size && x.t >= entry - 0.5);
    if (!boxed.length) return "No shelf pictures yet: run the Shelf finder first.";
    // In the store map's order (`storeMap.ts`): the layout of the store, not the order it was filmed in.
    const plan = orderShelvesByMap(planShelves(boxed), await readStoreMap(slug));
    if (!plan.length) return "No shelves found.";
    const src = await presignGet(s.files.video.key, "master", 6 * 3600);
    const files: string[] = [];
    const clips: TourManifest["clips"] = [];
    const items = new Map<number, { n: number; t: number[]; x: number[]; y: number[] }>();
    let at = 0;
    for (const [i, sh] of plan.entries()) {
      await setJob("tour", { busy: true, key: s.out.walk, note: `filming shelf ${i + 1} of ${plan.length} (${sh.levels.length} levels)` });
      const z = stillSize(sh.frame, STILL_W, 360, 3000);
      const still = await stillOf(src, sh.t, sh.frame, z.w, z.h, z.hfov, z.vfov);
      if (still.length < z.w * z.h * 3) continue;
      const px = (lon: number, lat: number) => { const p = project(lon, lat, sh.frame.lon, sh.frame.lat, z.hfov, z.vfov); return p ? { x: p.x * z.w, y: p.y * z.h } : null; };
      const levels: Box[] = sh.levels.map((lv) => {
        const a = px(lv.frame.lon - lv.frame.w / 2, lv.frame.lat + lv.frame.h / 2), b = px(lv.frame.lon + lv.frame.w / 2, lv.frame.lat - lv.frame.h / 2);
        return a && b ? { x: Math.max(0, a.x), y: Math.max(0, a.y), w: Math.min(z.w, b.x) - Math.max(0, a.x), h: Math.min(z.h, b.y) - Math.max(0, a.y) } : { x: 0, y: 0, w: z.w, h: z.h };
      }).filter((b) => b.w > 4 && b.h > 4);
      const out = join(dir, `c${String(i).padStart(3, "0")}.mp4`);
      const { keys, len } = await film(still, z.w, z.h, levels, out);
      files.push(out);
      // Every product of the shelf on screen, step by step, in the tour's times.
      const products = sh.levels.flatMap((l) => l.products);
      for (const p of products) {
        const q = px(p.lon, p.lat);
        if (!q) continue;
        const o = items.get(p.n) ?? { n: p.n, t: [], x: [], y: [] };
        for (let tt = 0; tt <= len + 1e-9; tt += STEP) {
          const v = windowAt(keys, tt), h = v.w / ASPECT;
          const fx = (q.x - (v.cx - v.w / 2)) / v.w, fy = (q.y - (v.cy - h / 2)) / h;
          if (fx < 0 || fx > 1 || fy < 0 || fy > 1) continue;
          o.t.push(Math.round((at + tt) * 100) / 100); o.x.push(Math.round(fx * 1000) / 1000); o.y.push(Math.round(fy * 1000) / 1000);
        }
        if (o.t.length) items.set(p.n, o);
      }
      clips.push({ shelf: i + 1, at: Math.round(at * 100) / 100, len: Math.round(len * 100) / 100, products: [...new Set(products.map((p) => p.n))] });
      at += len;
    }
    if (!files.length) return "No shelf could be filmed.";
    await setJob("tour", { busy: true, key: s.out.walk, note: "putting the shelves together" });
    const list = join(dir, "list.txt");
    writeFileSync(list, files.map((f) => `file '${f}'`).join("\n") + "\n");
    const video = join(dir, "tour.mp4");
    await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", video]);
    const videoKey = `scenes/store-${slug}/tour-${Date.now()}.mp4`;
    await uploadFile(videoKey, video, "video/mp4");
    const manifest: TourManifest = {
      store: slug, walk: s.out.walk, video: mediaPath(videoKey), made: new Date().toISOString(), w: OW, h: OH,
      seconds: Math.round(at * 100) / 100, items: [...items.values()], clips,
    };
    const mf = join(dir, "tour.json");
    writeFileSync(mf, JSON.stringify(manifest));
    await uploadFile(tourKey(slug), mf, "application/json");
    await writeMastersJson(tourRecordKey(slug), { ...manifest, kind: "shelf-film" });
    return `Shelf Tour filmed: ${clips.length} shelves, ${plan.reduce((x, sh) => x + sh.levels.length, 0)} levels, ${Math.round(at)} s, ${items.size} products.`;
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("tour", { busy: false, key: null });
  }
}
