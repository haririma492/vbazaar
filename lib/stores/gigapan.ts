// A SHELF'S ZOOM PHOTO — the job (owner, 2026-11-11: "we are struggling with free tour quality and low pixels of
// shelf, to resolve this we are going to take 3 Gigapan style photo of a shelf and you need to stitch them together
// so user (once switch its focus on this shelf) to be able to zoom in and out and read labels"). Free: no AI.
//
//   input   the store's «gigapan» uploads (masters bucket, private), grouped by shelf (`setsOf`): three phone
//           photos of one shelf bay from one spot, the camera tilted up, level, down, a third of each shared;
//   1       `scripts/stitch/stack.py` (python3 + OpenCV, in the image): finds which photo is above which, lines
//           them up on the middle photo's plane, evens their exposure, blends the seams, crops to a clean
//           rectangle (up to 100 megapixels), and cuts the Deep Zoom (DZI) tiles;
//   2       the tiles, `manifest.json`, `shelf.dzi` and `thumb.jpg` go to the public bucket under
//           `scenes/store-<slug>/zoom/<set>-<stamp>/` (a new stitch is a new folder, so nothing cached is stale);
//           the master to the private one (`stores/<slug>/gigapan/<set>/master.jpg`);
//   3       a hotspot already pinned on the walk for this shelf (`Walk.zooms`) is pointed at the new tiles;
//   output  `stores/<slug>/gigapans.json`: every shelf's state, in a sentence a person can act on.
// Run by «Refresh all agents» (`refreshAll.ts`) and by «Stitch now» on the store's page. A shelf is stitched once,
// and again only when its photos change (`toStitch`). One run at a time; the state is in `jobs/gigapan.json`.
// The 🔍 itself is pinned on the walk by the operator: «Zoom» on the walk's `?edit=1` (one tap on the shelf).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, r2Config, readMastersText, readWalks, uploadFile, uploadMastersFile, writeMastersJson, writeWalks } from "@/lib/splats/r2";
import { MAX_ITEM_PINS, dropZoom, phoneKeyOf, quadBox, setZoom, type Walks, type ZoomFrame } from "@/lib/splats/walks";
import { webObjectExists } from "@/lib/splats/r2";
import { readStore, updateStore } from "./bucket";
import { run } from "./media";
import { setJob, readJob } from "./jobState";
import { sceneOf, type StoreRecord } from "./store";
import { labelFor, namedShelves, noteOf, setsOf, sigOf, stateOf, thin, toLocate, toStitch, type ZoomRecord, type ZoomSet } from "./gigapanRules";

export const gigapansKey = (slug: string) => `stores/${slug}/gigapans.json`;
/** The master is at most this many megapixels (`ZOOM_MAX_MP` overrides: the stitcher needs ~12 MB of memory a megapixel). */
const MAX_MP = () => Math.min(200, Math.max(10, Number(process.env.ZOOM_MAX_MP) || 100));
let busy = false;

export async function readZooms(slug: string): Promise<ZoomRecord | null> {
  try { const t = await readMastersText(gigapansKey(slug)); return t ? (JSON.parse(t) as ZoomRecord) : null; } catch { return null; }
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? filesUnder(dir, join(rel, n)) : [join(rel, n)]));
}
const TYPE: Record<string, string> = { jpg: "image/jpeg", json: "application/json", dzi: "application/xml" };

type Answer = { ok: true; w: number; h: number; mp: number; tiles: number; order: string[]; seconds: number; row?: boolean; look?: boolean } | { ok: false; error: string };

/** Stitch every shelf waiting (or changed; with `force`, the failed ones again). Returns what it did, in a sentence. */
export async function stitchZooms(slug: string, opts: { force?: boolean } = {}): Promise<string> {
  if (busy) return "The zoom photo stitcher is busy.";
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "zoom-"));
  try {
    const s = await readStore(slug);
    if (!s) return "No store.";
    const files = s.files.gigapan ?? [];
    if (!files.length) return "No shelf zoom photos uploaded.";
    let record: ZoomRecord = (await readZooms(slug)) ?? { store: slug, sets: [], updated: "" };
    const todo = toStitch(files, record, opts.force);
    const all = setsOf(files);
    if (!todo.length) {
      const failed = all.filter((x) => stateOf(x.photos, record.sets.find((r) => r.id === x.id)) === "failed").length;
      return `Every shelf's zoom photo is stitched already (${all.length - failed} of ${all.length}${failed ? `; ${failed} could not be joined: new photos needed` : ""}).`;
    }
    const base = r2Config().publicBase;
    // A shelf the operator marked on the walk keeps the number and name given there.
    const named = namedShelves(s.out.walk ? (await readWalks().catch(() => null))?.walks[s.out.walk]?.zooms : undefined);
    let made = 0;
    const problems: string[] = [];
    for (const [i, set] of todo.entries()) {
      const label = labelFor(set.id, set.index, named);
      await setJob("gigapan", { busy: true, key: slug, note: `stitching ${label.en} (${i + 1} of ${todo.length}): ${set.photos.length} photos` });
      const work = join(dir, set.id), src = join(work, "in"), out = join(work, "out");
      mkdirSync(src, { recursive: true });
      let result: ZoomSet = { id: set.id, label, sig: sigOf(set.photos), state: "failed", note: "", made: new Date().toISOString() };
      try {
        // The photos under their own names (what the note calls them), made safe for a path.
        const paths: string[] = [];
        for (const [k, ph] of set.photos.entries()) {
          const p = join(src, `${k}-${ph.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60) || "photo.jpg"}`);
          await downloadToFile(ph.key, p, "master");
          paths.push(p);
        }
        await run("python3", [join(process.cwd(), "scripts/stitch/stack.py"), "--out", out, "--max-mp", String(MAX_MP()), "--threads", "2", ...paths]);
        const a = JSON.parse(readFileSync(join(out, "result.json"), "utf8")) as Answer;
        if ("error" in a) result.note = a.error;
        else {
          // The numbers the stitcher put before the names come off again.
          const order = a.order.map((n) => n.replace(/^\d+-/, ""));
          const folder = `scenes/${sceneOf(slug)}/zoom/${set.id}-${Date.now()}`;
          const list = filesUnder(out).filter((f) => f !== "master.jpg" && f !== "result.json");
          const queue = [...list];
          let sent = 0;
          await Promise.all(Array.from({ length: 8 }, async () => {
            for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
              await uploadFile(`${folder}/${f.split("\\").join("/")}`, join(out, f), TYPE[f.split(".").pop() ?? ""] ?? "application/octet-stream");
              if (++sent % 100 === 0) await setJob("gigapan", { busy: true, key: slug, note: `${label.en}: ${sent} of ${list.length} tiles up` });
            }
          }));
          const master = `stores/${slug}/gigapan/${set.id}/master.jpg`;
          await uploadMastersFile(master, join(out, "master.jpg"), "image/jpeg");
          result = {
            ...result, state: "done", note: noteOf({ ...a, order }), w: a.w, h: a.h, mp: a.mp, tiles: a.tiles, master,
            manifest: `${base}/${folder}/manifest.json`, thumb: `${base}/${folder}/thumb.jpg`, dzi: `${base}/${folder}/shelf.dzi`,
          };
          made++;
        }
      } catch (e) {
        const m = (e as Error).message;
        result.note = /No module named|not on this server/.test(m)
          ? "The stitcher is not installed on this server (python3 with OpenCV: see the Dockerfile)."
          : `The stitcher stopped: ${m.slice(0, 240)}`;
        console.error("[zoom]", slug, set.id, e);
      }
      if (result.state === "failed") problems.push(`${label.en}: ${result.note}`);
      // Saved after every shelf: a restart loses at most the one being stitched.
      record = { store: slug, updated: new Date().toISOString(), sets: [...((await readZooms(slug))?.sets ?? record.sets).filter((x) => x.id !== set.id), result] };
      await writeMastersJson(gigapansKey(slug), record);
      // A hotspot already on the walk for this shelf opens the new photo.
      if (result.state === "done" && s.out.walk) await repoint(s.out.walk, result).catch((e) => console.error("[zoom] repoint", slug, e));
      rmSync(work, { recursive: true, force: true });
    }
    const pinned = s.out.walk ? ((await readWalks().catch(() => null))?.walks[s.out.walk]?.zooms ?? []).length : 0;
    const done = record.sets.filter((x) => x.state === "done").length;
    return `Zoom photos: ${made} of ${todo.length} shelves stitched; ${done} ready in all, ${pinned} pinned on the walk`
      + `${done > pinned ? ` (pin the other ${done - pinned}: «Zoom» in the walk's editor, one tap on the shelf)` : ""}.`
      + (problems.length ? ` Not joined: ${problems.join(" ")}` : "");
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("gigapan", { busy: false, key: null });
  }
}

// ── THE SHELF FOUND IN THE WALK, AND BORDERED (owner, 2026-11-11: "during the free tour … we need to identify the
// shelves for which a set of gigapan photos are submitted … bordered with some line, maybe green line, in a
// rectangle shape"). Free: no AI. For every stitched shelf not looked for yet in the store's current walk,
// `scripts/stitch/locate.py` matches the stitched photo against the walk's own video (its phone copy when there is
// one: smaller to fetch, sharp enough), follows the shelf while it is in view, and gives the photo's four corners at
// every step. They go on the walk as the shelf's border (`WalkZoom.outline`, `auto`): the player draws it in green
// and a tap inside opens the photo. A shelf the operator pinned by hand is left as it is. A shelf not in the walk
// (another room, a walk filmed before the shelf was set up) says so on the card, and is looked for again only when
// the walk or the photo changes.
let locating = false;
type Found = { ok: boolean; found: boolean; note: string; frames?: ZoomFrame[] };

export async function locateZooms(slug: string, opts: { force?: boolean } = {}): Promise<string> {
  if (locating) return "The shelf finder is busy.";
  locating = true;
  const dir = mkdtempSync(join(tmpdir(), "zoomfind-"));
  try {
    const s = await readStore(slug);
    const walkKey = s?.out.walk;
    if (!s || !walkKey) return "No walk yet: the shelves are looked for once the store's walk is made.";
    const record = await readZooms(slug);
    const walks0 = await readWalks();
    const w0 = walks0.walks[walkKey];
    const byHand = new Set((w0?.zooms ?? []).filter((z) => !z.auto).map((z) => z.id));
    const todo = (record?.sets ?? []).filter((x) => toLocate(x, walkKey, opts.force) && !byHand.has(x.id));
    if (!record || !todo.length) return "";
    if (w0?.projection === "eac") return "This walk is a cube-map video: shelves are not looked for in it (pin each 🔍 by hand: «Zoom» in the walk's editor).";
    const projection = w0?.projection === "flat" ? "flat" : "equirect";
    await setJob("gigapan", { busy: true, key: slug, note: "fetching the walk to look for the shelves in it" });
    const phone = phoneKeyOf(walkKey);
    const videoKey = phone && (await webObjectExists(phone).catch(() => false)) ? phone : walkKey;
    const video = join(dir, "walk.mp4");
    await downloadToFile(videoKey, video, "web");
    const said: string[] = [];
    for (const [i, set] of todo.entries()) {
      await setJob("gigapan", { busy: true, key: slug, note: `looking for ${set.label.en} in the walk (${i + 1} of ${todo.length})` });
      let place: NonNullable<ZoomSet["place"]> = { walk: walkKey, manifest: set.manifest!, found: false, note: "", at: new Date().toISOString() };
      try {
        const master = join(dir, `${set.id}.jpg`), out = join(dir, `${set.id}.json`);
        await downloadToFile(set.master!, master, "master");
        await run("python3", [join(process.cwd(), "scripts/stitch/locate.py"), "--master", master, "--video", video, "--projection", projection, "--out", out, "--threads", "2"]);
        const f = JSON.parse(readFileSync(out, "utf8")) as Found;
        place = { ...place, found: Boolean(f.found && f.frames?.length), note: f.note };
        if (place.found) {
          const round = projection !== "flat";
          const outline = thin(f.frames!, 400);
          const pins = thin(outline, MAX_ITEM_PINS).map((fr) => { const b = quadBox(fr.c, round); return { t: fr.t, x: b.x, y: b.y }; });
          const walks = await readWalks();
          // Marked by the operator meanwhile: their border stays. A number or name they gave a found shelf is kept.
          const had = walks.walks[walkKey]?.zooms?.find((z) => z.id === set.id);
          if (had && !had.auto) { place = { ...place, note: "Bordered by the operator on the walk." }; }
          else await writeWalks(setZoom(walks, walkKey, {
            id: set.id, label: had && (had.n !== undefined || had.name) ? had.label : set.label,
            ...(had?.n !== undefined ? { n: had.n } : {}), ...(had?.name ? { name: had.name } : {}),
            manifest: set.manifest!, ...(set.thumb ? { thumb: set.thumb } : {}), pins, outline, auto: true,
          }), walks);
        } else {
          // Looked for and not there: a border the finder put there for an earlier photo or walk comes off.
          const walks = await readWalks();
          if (walks.walks[walkKey]?.zooms?.some((z) => z.id === set.id && z.auto)) await writeWalks(dropZoom(walks, walkKey, set.id), walks);
        }
        rmSync(master, { force: true });
      } catch (e) {
        const m = (e as Error).message;
        place.note = /No module named|not on this server/.test(m) ? "The finder is not installed on this server (python3 with OpenCV: see the Dockerfile)." : `The finder stopped: ${m.slice(0, 200)}`;
        console.error("[zoom] locate", slug, set.id, e);
      }
      said.push(`${set.label.en}: ${place.found ? "bordered on the walk" : `not on the walk (${place.note})`}`);
      const now = await readZooms(slug);
      if (now) await writeMastersJson(gigapansKey(slug), { ...now, updated: new Date().toISOString(), sets: now.sets.map((x) => (x.id === set.id ? { ...x, place } : x)) });
    }
    return `Shelves looked for in the walk: ${said.join("; ")}.`;
  } finally {
    locating = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("gigapan", { busy: false, key: null });
  }
}

/** The whole of it, as «Refresh all agents» and the card run it: stitch what waits, then find each shelf in the walk. */
export async function refreshZooms(slug: string, opts: { force?: boolean; relocate?: boolean } = {}): Promise<string> {
  const stitched = await stitchZooms(slug, { force: opts.force });
  const found = await locateZooms(slug, { force: opts.relocate }).catch((e) => `The shelf finder stopped: ${(e as Error).message.slice(0, 200)}`);
  return [stitched, found].filter(Boolean).join(" ");
}

/** The walk's hotspot for `set` (if it has one) pointed at the set's new tiles. */
async function repoint(walkKey: string, set: ZoomSet): Promise<void> {
  const walks = await readWalks();
  const w = walks.walks[walkKey];
  if (!w?.zooms?.some((z) => z.id === set.id && z.manifest !== set.manifest)) return;
  const zooms = w.zooms.map((z) => (z.id === set.id ? { ...z, manifest: set.manifest!, ...(set.thumb ? { thumb: set.thumb } : {}) } : z));
  await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, zooms } } }, walks);
}

/** A shelf's zoom photo taken away: its uploads off the record, its hotspot off the walk. The files stay in the bucket. */
export async function removeZoom(slug: string, id: string): Promise<StoreRecord | null> {
  const next = await updateStore(slug, (x) => ({ ...x, files: { ...x.files, gigapan: (x.files.gigapan ?? []).filter((p) => p.set !== id) } }));
  const record = await readZooms(slug);
  if (record?.sets.some((x) => x.id === id)) await writeMastersJson(gigapansKey(slug), { ...record, sets: record.sets.filter((x) => x.id !== id), updated: new Date().toISOString() });
  if (next?.out.walk) {
    const walks: Walks = await readWalks();
    // A shelf the operator marked stays on the walk with its border and its name; only its photo comes off.
    const z = walks.walks[next.out.walk]?.zooms?.find((x) => x.id === id);
    if (z && !z.auto && z.outline?.length) {
      const { manifest: _m, thumb: _t, ...bare } = z;
      await writeWalks(setZoom(walks, next.out.walk, bare), walks);
    } else {
      const without = dropZoom(walks, next.out.walk, id);
      if (without !== walks) await writeWalks(without, walks);
    }
  }
  return next;
}

export type ZoomForPage = {
  id: string; label: { en: string; fa: string }; photos: Array<{ name: string; size: number }>;
  /** `empty`: a shelf marked on the walk whose photos are still to come. */
  state: "empty" | "waiting" | "changed" | "done" | "failed"; note: string; pinned: boolean;
  /** On the walk with its green border; `drawn`: by the operator (else found by the finder); what the finder last said. */
  bordered: boolean; drawn: boolean; placeNote: string | null;
  manifest: string | null; thumb: string | null; w: number | null; h: number | null; mp: number | null;
};
/** What the store's page shows: every shelf with photos, where it stands, and whether its 🔍 is on the walk. */
export async function zoomsForPage(s: StoreRecord): Promise<{ sets: ZoomForPage[]; working: boolean; note: string }> {
  const [record, walks, job] = await Promise.all([readZooms(s.slug), s.out.walk ? readWalks().catch(() => null) : null, readJob("gigapan")]);
  const onWalk = s.out.walk ? walks?.walks[s.out.walk]?.zooms ?? [] : [];
  const on = new Set(onWalk.map((z) => z.id));
  const bordered = new Set(onWalk.filter((z) => z.outline?.length).map((z) => z.id));
  const drawn = new Set(onWalk.filter((z) => z.outline?.length && !z.auto).map((z) => z.id));
  const named = namedShelves(onWalk);
  const withPhotos = setsOf(s.files.gigapan ?? []);
  // Shelves marked on the walk with no photos yet: listed, so their photos can be added to them.
  const empty: ZoomForPage[] = onWalk.filter((z) => z.outline?.length && !withPhotos.some((x) => x.id === z.id)).sort((a, b) => (a.n ?? 1000) - (b.n ?? 1000))
    .map((z) => ({ id: z.id, label: { en: z.label.en, fa: z.label.fa ?? z.label.en }, photos: [], state: "empty", note: "", pinned: true, bordered: true, drawn: !z.auto, placeNote: null, manifest: null, thumb: null, w: null, h: null, mp: null }));
  const working = Boolean(job?.busy && job.key === s.slug && Date.now() - Date.parse(job.at) < 3600_000);
  return {
    working, note: working ? job?.note ?? "" : "",
    sets: [...withPhotos.map((set, i): ZoomForPage => {
      const m = record?.sets.find((x) => x.id === set.id);
      const state = stateOf(set.photos, m);
      const shown = state === "done" || state === "changed";
      return {
        id: set.id, label: labelFor(set.id, i, named), photos: set.photos.map((p) => ({ name: p.name, size: p.size })), state, note: m?.note ?? "", pinned: on.has(set.id),
        bordered: bordered.has(set.id), drawn: drawn.has(set.id), placeNote: m?.place && m.place.walk === s.out.walk ? m.place.note : null,
        manifest: shown ? m?.manifest ?? null : null, thumb: shown ? m?.thumb ?? null : null, w: m?.w ?? null, h: m?.h ?? null, mp: m?.mp ?? null,
      };
    }), ...empty],
  };
}
