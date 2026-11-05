// THE SHELF FINDER (owner, 2026-11-05: "the Shelf Tour itself I guess will lead
// to discovery and identification of many more new books"; "yes" to about $2–3
// from the store's budget). Looks again at the store's shelves, through the
// Shelf Tour's own camera: one steady, square-on picture of each shelf at its
// closest moment, cut from the original upload (`tour.ts` plans where).
//
//   1. Claude lists every product in the picture, boxed (`findOnShelf`);
//   2. each box is put back where it is in the recording (`unproject`); a
//      product of the list already THERE (its light, or its sighting) is the
//      same one: it keeps its number (and its title reading), and gets this
//      sighting; a box no product is in is NEW, numbered after the list; the
//      same new product in two shelves' pictures is found once;
//   3. the new products join the list (named by what was seen, no price), get
//      a photo, and a light in the Free Tour (followed through the walk as the
//      finder's lights are); the sightings are kept
//      (`stores/<slug>/shelf-sightings.json`, the original's times);
//   4. the Photo improver and the Shelf Tour are made again (free).
// Spends from the store's purse (`purseOf`); stops when it is empty.
import { readCatalogue, readMastersText, readWalks, presignGet, writeCatalogue, writeMastersJson, writeWalks, putSignImage, r2Config } from "@/lib/splats/r2";
import { MAX_ITEMS } from "@/lib/splats/walks";
import type { Product } from "@/lib/splats/catalogue";
import { sceneOf } from "./store";
import { grayFrames, jpegOf, productPhoto, run } from "./media";
import { findOnShelf, OverBudget } from "./ai";
import { purseOf, queuePhotos } from "./crew";
import { FOLLOW_FPS, FOLLOW_SPAN, FOLLOW_W, capTracks, follow, itemOf, keepTracks, type Track as Pinned } from "./tagging";
import { planTour, project, unproject, type Seen } from "./tour";
import { buildTour, shelfSightingsKey, tourInputs } from "./tourJob";
import { setJob } from "./jobState";
import { gapShots, type Obs } from "./gapShots";

/** The picture sent for a shelf (px): Claude's largest useful size, 16:9. */
export const PIC_W = 1568, PIC_H = 882;
/** A box with an existing product's place inside it (grown by this share) is that product. */
const SAME_GROW = 0.15;
/** At most this many pictures in a "gaps" run, unless the caller says (each one ~$0.07). */
export const GAP_MAX = 30;

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let busy = false;

/** Original time → the cut walk's time, or null when that moment was cut out. */
export function cutTime(parts: Array<{ from: number; to: number }>, t: number): number | null {
  if (!parts.length) return t;
  let at = 0;
  for (const p of parts) {
    if (t >= p.from && t <= p.to) return at + (t - p.from);
    at += p.to - p.from;
  }
  return null;
}

/**
 * `mode`: "tour" looks at each shelf the Shelf Tour stops at (and replaces the shelf sightings); "gaps" looks only
 * where the walk saw products that no shelf picture holds yet (`gapShots`), at most `max` pictures, and ADDS to
 * the sightings kept (owner, 2026-11-05: "lets extend to all shelves, there are only 12 now").
 */
export async function findShelves(slug: string, opts: { mode?: "tour" | "gaps"; max?: number } = {}): Promise<string> {
  const mode = opts.mode ?? "tour";
  if (busy) return "The Shelf finder is busy.";
  busy = true;
  try {
    const inp = await tourInputs(slug);
    if (typeof inp === "string") return inp;
    const { s, walkKey, seen, tracks, src, end, parts, entry, operator } = inp;
    const c = await readCatalogue(sceneOf(slug));
    if (!c) return "No product list.";
    const keptText = mode === "gaps" ? await readMastersText(shelfSightingsKey(slug)).catch(() => null) : null;
    const kept: Array<Seen & { confidence: number }> = keptText ? (JSON.parse(keptText) as Array<Seen & { confidence: number }>).filter((x) => x && Number.isFinite(x.t)) : [];
    let shots: Array<{ t: number; yaw: number; pitch: number; hfov: number; vfov: number }>;
    if (mode === "gaps") {
      const obs: Obs[] = seen.map((x) => ({ n: x.n, t: x.t, lon: x.lon, lat: x.lat, area: x.size.w * x.size.h }));
      for (const tr of tracks.values()) { const p = [...tr.pins].sort((a, b) => a.t - b.t)[tr.pins.length >> 1]; if (p) obs.push({ n: tr.n, t: p.t, lon: p.x, lat: p.y, area: 0.0005 }); }
      shots = gapShots(obs, new Set(kept.map((x) => x.n)), entry, opts.max ?? GAP_MAX)
        // Never a picture of the camera operator (the Lock agent's `hide`).
        .filter((g) => { const op = operator(g.t); return !op || Math.abs(Math.atan2(Math.sin(g.yaw - op.yaw), Math.cos(g.yaw - op.yaw))) > op.width / 2 + g.hfov / 2; });
      if (!shots.length) return "Shelf finder (gaps): every product the walk saw is already in a shelf picture: nothing to look at.";
    } else {
      const plan = planTour(seen, [...tracks.values()], end, entry, operator);
      shots = plan.clips.map((clip) => ({ ...clip.aim[clip.aim.length >> 1], hfov: clip.hfov, vfov: clip.vfov }));
    }
    const purse = purseOf(s);
    const before = purse.spent();
    // Where each product of the list is at t (its light; else a sighting within a second).
    const placesAt = (t: number) => {
      const out: Array<{ n: number; lon: number; lat: number }> = [];
      for (const tr of tracks.values()) {
        let best: { t: number; x: number; y: number } | null = null;
        for (const p of tr.pins) if (Math.abs(p.t - t) <= 0.35 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
        if (best) out.push({ n: tr.n, lon: best.x, lat: best.y });
      }
      for (const x of seen) if (!tracks.has(x.n) && Math.abs(x.t - t) <= 1) out.push({ n: x.n, lon: x.lon, lat: x.lat });
      return out;
    };
    let next = Math.max(0, ...c.products.map((p) => p.n)) + 1;
    const found: Array<Seen & { confidence: number }> = [...kept];
    const fresh: Array<{ n: number; en: string; fa: string; t: number; lon: number; lat: number; size: { w: number; h: number } }> = [];
    let looked = 0, again = 0, stopped = "";
    for (const [i, a] of shots.entries()) {
      const clip = a;
      await setJob("shelfFind", { busy: true, key: walkKey, note: `looking at ${mode === "gaps" ? "picture" : "shelf"} ${i + 1} of ${shots.length}: ${fresh.length} new so far` });
      const t = a.t;
      let pic: Uint8Array;
      try {
        pic = new Uint8Array(await run("ffmpeg", ["-v", "error", "-ss", t.toFixed(3), "-i", src, "-frames:v", "1", "-vf",
          `v360=input=e:output=flat:yaw=${deg(a.yaw)}:pitch=${deg(a.pitch)}:h_fov=${deg(clip.hfov)}:v_fov=${deg(clip.vfov)}:w=${PIC_W}:h=${PIC_H}:interp=lanczos`,
          "-threads", "1", "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "pipe:1"]));
      } catch (e) { console.error("[shelf-find] frame", slug, i, e); continue; }
      let list;
      try { list = await findOnShelf(purse, pic, PIC_W, PIC_H); }
      catch (e) {
        if (e instanceof OverBudget) { stopped = ` Stopped at ${i + 1} of ${shots.length}: the store's AI budget is used up.`; break; }
        console.error("[shelf-find] look", slug, i, e); continue;
      }
      looked++;
      const here = placesAt(t).map((p) => ({ ...p, at: project(p.lon, p.lat, a.yaw, a.pitch, clip.hfov, clip.vfov) }));
      for (const f of list) {
        if (f.confidence < 0.6) continue;
        const [x1, y1, x2, y2] = f.box;
        const mid = unproject((x1 + x2) / 2, (y1 + y2) / 2, a.yaw, a.pitch, clip.hfov, clip.vfov);
        const l = unproject(x1, (y1 + y2) / 2, a.yaw, a.pitch, clip.hfov, clip.vfov), r = unproject(x2, (y1 + y2) / 2, a.yaw, a.pitch, clip.hfov, clip.vfov);
        const top = unproject((x1 + x2) / 2, y1, a.yaw, a.pitch, clip.hfov, clip.vfov), bot = unproject((x1 + x2) / 2, y2, a.yaw, a.pitch, clip.hfov, clip.vfov);
        const size = { w: Math.round(Math.abs(wrap(r.lon - l.lon)) * Math.cos(mid.lat) * 1000) / 1000, h: Math.round(Math.abs(top.lat - bot.lat) * 1000) / 1000 };
        const gx = (x2 - x1) * SAME_GROW, gy = (y2 - y1) * SAME_GROW;
        const old = here.find((p) => p.at && p.at.x >= x1 - gx && p.at.x <= x2 + gx && p.at.y >= y1 - gy && p.at.y <= y2 + gy);
        let n: number;
        if (old) { n = old.n; again++; }
        else {
          const twin = fresh.find((q) => Math.abs(q.t - t) <= 2.5 && Math.hypot(wrap(q.lon - mid.lon) * Math.cos(mid.lat), q.lat - mid.lat) <= Math.max(size.w, size.h, q.size.w, q.size.h) / 2);
          if (twin) n = twin.n;
          else { n = next++; fresh.push({ n, en: f.en, fa: f.fa, t, lon: mid.lon, lat: mid.lat, size }); }
        }
        found.push({ n, t, lon: Math.round(mid.lon * 10000) / 10000, lat: Math.round(mid.lat * 10000) / 10000, size, confidence: f.confidence });
      }
    }
    // The sightings, kept (a "tour" run replaces them: it looks at the same shelves again; a "gaps" run adds).
    await writeMastersJson(shelfSightingsKey(slug), found);
    // The new products join the list, each with a first photo (the Photo improver makes it again).
    await setJob("shelfFind", { busy: true, key: walkKey, note: `adding ${fresh.length} new products to the list` });
    const added: Product[] = [];
    for (const q of fresh) {
      let photo: string | undefined;
      try {
        const key = `scenes/catalogues/${sceneOf(slug)}/p${q.n}-shelf-${Date.now()}.jpg`;
        await putSignImage(key, "image/jpeg", await jpegOf(await productPhoto(src, q.t, q.lon, q.lat, q.size, 768), 1200));
        photo = `${r2Config().publicBase}/${key}`;
      } catch (e) { console.error("[shelf-find] photo", slug, q.n, e); }
      added.push({ n: q.n, seen: q.en, unit: "piece", priceCents: null, by: "video", ...(photo ? { photo } : {}) });
    }
    const now = await readCatalogue(sceneOf(slug));
    if (now && added.length) await writeCatalogue({ ...now, products: [...now.products, ...added.filter((p) => !now.products.some((x) => x.n === p.n))] });
    // New products' lights in the Free Tour: followed through the cut walk, as the finder's are.
    let lit = 0;
    try {
      const walkSrc = await presignGet(walkKey, "web", 6 * 3600);
      const tracksNew: Pinned[] = [];
      const byMoment = new Map<number, typeof fresh>();
      for (const q of fresh) { const ct = cutTime(parts, q.t); if (ct === null) continue; const k = Math.round(ct * 10) / 10; byMoment.set(k, [...(byMoment.get(k) ?? []), q]); }
      let k = 0;
      for (const [ct, qs] of byMoment) {
        await setJob("shelfFind", { busy: true, key: walkKey, note: `lighting the new products: ${++k} of ${byMoment.size}` });
        const start = Math.max(0, ct - FOLLOW_SPAN);
        const { frames, W, H } = await grayFrames(walkSrc, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
        if (!frames.length) continue;
        const i0 = Math.min(frames.length - 1, Math.round((ct - start) * FOLLOW_FPS));
        for (const q of qs) tracksNew.push({ n: q.n, confidence: 0.8, pins: follow(frames, W, H, start, i0, { lon: q.lon, lat: q.lat }, q.size), size: q.size });
      }
      const walks = await readWalks();
      const walk = walks.walks[walkKey];
      if (walk && tracksNew.length) {
        const room = Math.max(0, MAX_ITEMS - (walk.items?.length ?? 0));
        const byN = new Map(added.map((p) => [p.n, p]));
        const items = capTracks(keepTracks(tracksNew), room).map((tr) => itemOf(tr, byN.get(tr.n)!, 0)).map((it) => ({ ...it, id: `${it.id}-shelf` }));
        lit = new Set(items.map((it) => it.n)).size;
        await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...walk, items: [...(walk.items ?? []), ...items] } } }, walks);
      }
    } catch (e) { console.error("[shelf-find] lights", slug, e); }
    void queuePhotos([slug]).catch(() => {});
    void buildTour(slug).then((note) => console.log("[tour]", slug, note)).catch((e) => console.error("[tour]", slug, e));
    return `Shelf finder${mode === "gaps" ? " (new shelves)" : ""}: looked at ${looked} ${mode === "gaps" ? "pictures" : "shelves"} ($${((purse.spent() - before) / 100).toFixed(2)}); ${fresh.length} new products added, ${again} sightings of products already listed; ${lit} new products lit in the Free Tour. The photos and the Shelf Tour are being made again.${stopped}`;
  } finally {
    busy = false;
    await setJob("shelfFind", { busy: false, key: null });
  }
}
