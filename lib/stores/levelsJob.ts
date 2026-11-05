// THE SHELF TOUR BY SHELF AND LEVEL — the job (owner, 2026-11-05; the plan is
// `levels.ts`). Free: ffmpeg only, on the Shelf finder's boxes.
//
//   input   `stores/<slug>/shelf-sightings.json` (every product boxed in a
//           square-on picture of its shelf, at that picture's moment, in the
//           original recording's times) and the upload (the sharpest source);
//   output  for each shelf: a still of the whole shelf, and a still of each of
//           its levels (a camera aimed at that row, zoomed to fit), cut from
//           the upload at the shelf's own moment; every product's place on
//           each still (exact: the same moment it was boxed at);
//           `scenes/store-<slug>/shelves/<stamp>/…jpg` and
//           `scenes/store-<slug>/shelves.json` (public, via `/api/shelves/<slug>`).
// One at a time; state in `jobs/shelves.json`.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, r2Config, readMastersText, uploadFile, writeMastersJson } from "@/lib/splats/r2";
import { readStore } from "./bucket";
import { run, v360Yaw } from "./media";
import { project } from "./tour";
import { planShelves, stillSize, type Boxed, type Frame } from "./levels";
import { setJob } from "./jobState";
import { shelfSightingsKey, tourInputs } from "./tourJob";

export type StillOut = { img: string; w: number; h: number; items: Array<{ n: number; x: number; y: number; w: number; h: number }> };
export type ShelvesManifest = {
  store: string; made: string;
  shelves: Array<StillOut & { levels: Array<StillOut & { box: { x: number; y: number; w: number; h: number } }> }>;
};
export const shelvesKey = (slug: string) => `stores/${slug}/shelves.json`;

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
let busy = false;

/** Where products (and a frame) sit on a still aimed at `f` (fractions of the still). */
function placesOn(f: Frame, hfov: number, vfov: number, ps: Boxed[]) {
  const out: StillOut["items"] = [];
  for (const p of ps) {
    const c = project(p.lon, p.lat, f.lon, f.lat, hfov, vfov);
    if (!c) continue;
    const l = project(p.lon - p.size.w / 2 / Math.max(0.2, Math.cos(p.lat)), p.lat, f.lon, f.lat, hfov, vfov);
    const r = project(p.lon + p.size.w / 2 / Math.max(0.2, Math.cos(p.lat)), p.lat, f.lon, f.lat, hfov, vfov);
    const t = project(p.lon, p.lat + p.size.h / 2, f.lon, f.lat, hfov, vfov), b = project(p.lon, p.lat - p.size.h / 2, f.lon, f.lat, hfov, vfov);
    out.push({ n: p.n, x: r3(c.x), y: r3(c.y), w: r3(l && r ? r.x - l.x : 0.05), h: r3(t && b ? b.y - t.y : 0.05) });
  }
  return out;
}

export async function buildShelves(slug: string): Promise<string> {
  if (busy) return "The shelf-and-level builder is busy.";
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "shelves-"));
  try {
    const s = await readStore(slug);
    if (!s) return "No store.";
    const t = await readMastersText(shelfSightingsKey(slug)).catch(() => null);
    // Inside the store only (owner, 2026-11-05): pictures from before its door were the window and the hallway.
    const inp = await tourInputs(slug);
    const entry = typeof inp === "string" ? 0 : inp.entry;
    const boxed = (t ? (JSON.parse(t) as Boxed[]) : []).filter((x) => x && Number.isFinite(x.t) && x.size && x.t >= entry - 0.5);
    if (!boxed.length) return "No shelf pictures yet: run «Find more products on these shelves» (the Shelf finder) first.";
    if (!s.files.video) return "No upload to cut the shelves from.";
    const src = await presignGet(s.files.video.key, "master", 6 * 3600);
    const plan = planShelves(boxed);
    if (!plan.length) return "No shelves found in the shelf pictures.";
    const stamp = Date.now(), base = `scenes/store-${slug}/shelves/${stamp}`;
    const cut = async (key: string, at: number, f: Frame, maxW: number) => {
      const z = stillSize(f, maxW);
      const out = join(dir, key.replace(/\//g, "_"));
      await run("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(3), "-i", src, "-frames:v", "1", "-vf",
        `v360=input=e:output=flat:yaw=${v360Yaw(f.lon).toFixed(3)}:pitch=${deg(f.lat)}:h_fov=${deg(z.hfov)}:v_fov=${deg(z.vfov)}:w=${z.w}:h=${z.h}:interp=lanczos,unsharp=5:5:0.3:5:5:0`,
        "-threads", "2", "-q:v", "2", out]);
      await uploadFile(`${base}/${key}`, out, "image/jpeg");
      return { img: `${r2Config().publicBase}/${base}/${key}`, ...z };
    };
    const manifest: ShelvesManifest = { store: slug, made: new Date().toISOString(), shelves: [] };
    for (const [i, sh] of plan.entries()) {
      await setJob("shelves", { busy: true, key: slug, note: `shelf ${i + 1} of ${plan.length}: ${sh.levels.length} levels` });
      const all = sh.levels.flatMap((l) => l.products);
      const whole = await cut(`s${i + 1}.jpg`, sh.t, sh.frame, 1600);
      const levels: ShelvesManifest["shelves"][number]["levels"] = [];
      for (const [j, lv] of sh.levels.entries()) {
        const st = await cut(`s${i + 1}-l${j + 1}.jpg`, sh.t, lv.frame, 2048);
        // The level's outline on the shelf's still, for the shelf view.
        const corner = (dx: number, dy: number) => project(lv.frame.lon + dx * lv.frame.w / 2, lv.frame.lat + dy * lv.frame.h / 2, sh.frame.lon, sh.frame.lat, whole.hfov, whole.vfov);
        const tl = corner(-1, 1), br = corner(1, -1);
        levels.push({
          img: st.img, w: st.w, h: st.h, items: placesOn(lv.frame, st.hfov, st.vfov, lv.products),
          box: tl && br ? { x: r3(tl.x), y: r3(tl.y), w: r3(br.x - tl.x), h: r3(br.y - tl.y) } : { x: 0, y: 0, w: 1, h: 1 },
        });
      }
      manifest.shelves.push({ img: whole.img, w: whole.w, h: whole.h, items: placesOn(sh.frame, whole.hfov, whole.vfov, all), levels });
    }
    const mf = join(dir, "shelves.json");
    writeFileSync(mf, JSON.stringify(manifest));
    await uploadFile(`scenes/store-${slug}/shelves.json`, mf, "application/json");
    await writeMastersJson(shelvesKey(slug), manifest);
    const nLevels = manifest.shelves.reduce((x, s) => x + s.levels.length, 0);
    const nItems = new Set(manifest.shelves.flatMap((s) => s.levels.flatMap((l) => l.items.map((it) => it.n)))).size;
    return `Shelf Tour by shelf and level: ${manifest.shelves.length} shelves, ${nLevels} levels, ${nItems} products.`;
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("shelves", { busy: false, key: null });
  }
}

export async function readShelves(slug: string): Promise<ShelvesManifest | null> {
  try { const t = await readMastersText(shelvesKey(slug)); return t ? (JSON.parse(t) as ShelvesManifest) : null; } catch { return null; }
}
