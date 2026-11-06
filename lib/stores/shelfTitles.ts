// THE SHELF PHOTOS — every spine read (owner, 2026-11-05: "only 76 titles are typed, there are in excess of 700
// titles in this store"; 2026-11-06: "build that"). The video gives a small spine ~10 px letters: too few.
// Phone photos of the shelves (one per shelf section, about 1 m away) give several times that. The rules are
// `shelfTitlesRules.ts`.
//
//   input   the store's «shelf» uploads (masters bucket, private);
//   1       each photo upright (ffmpeg follows the phone's rotation tag), brought to at most `MAX_SIDE` px,
//           cut into overlapping tiles (`tilesOf`);
//   2       each tile read by Claude (`readSpines`): every title as printed, or left out — never guessed;
//   3       one entry per book (`mergeSpines`), the surer reading kept;
//   output  `stores/<slug>/shelf-titles.json`: the rows, and which photos are done (a photo is read once; a run
//           carries on where the last stopped, and a restart loses at most one photo).
// Claude Haiku 5.5 reads (`CHEAP_MODEL`; a fraction of a cent a request), so a photo is read at full size and a
// tile with a partly read title is read again zoomed in (`quartersOf`).
// Spends from the store's AI budget (`purseOf`); stops when it is empty, and says so. One run at a time.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presignGet, readMastersText, writeMastersJson } from "@/lib/splats/r2";
import { readStore } from "./bucket";
import { run } from "./media";
import { readSpines, OverBudget } from "./ai";
import { purseOf } from "./crew";
import { setJob } from "./jobState";
import { mergeSpines, quartersOf, readSize, tilesOf, type SpineRow } from "./shelfTitlesRules";

export type ShelfTitles = { store: string; rows: SpineRow[]; done: string[]; spentCents: number; updated: string };
export const shelfTitlesKey = (slug: string) => `stores/${slug}/shelf-titles.json`;
let busy = false;

export async function readShelfTitles(slug: string): Promise<ShelfTitles | null> {
  try { const t = await readMastersText(shelfTitlesKey(slug)); return t ? (JSON.parse(t) as ShelfTitles) : null; } catch { return null; }
}

/** How many tiles the shelf photos not read yet will take (their sizes unknown until read: 4 each, the usual phone photo). */
export const TILES_A_PHOTO = 4;

/** Read the spines in every shelf photo not read yet. Returns what it did, in a sentence. */
export async function readShelfPhotos(slug: string): Promise<string> {
  if (busy) return "The spine reader is busy.";
  busy = true;
  const dir = mkdtempSync(join(tmpdir(), "spines-"));
  try {
    const s = await readStore(slug);
    if (!s) return "No store.";
    const photos = s.files.shelf ?? [];
    if (!photos.length) return "No shelf photos uploaded yet.";
    const list: ShelfTitles = (await readShelfTitles(slug)) ?? { store: slug, rows: [], done: [], spentCents: 0, updated: "" };
    const todo = photos.filter((p) => !list.done.includes(p.key));
    if (!todo.length) return "Every shelf photo is read already.";
    const purse = purseOf(s);
    const before = purse.spent();
    let tiles = 0, stopped = "";
    for (const [i, ph] of todo.entries()) {
      await setJob("shelfTitles", { busy: true, key: slug, note: `photo ${i + 1} of ${todo.length}: ${list.rows.length} titles so far` });
      const full = join(dir, "full.jpg");
      let size: { w: number; h: number };
      try {
        const src = await presignGet(ph.key, "master", 3600);
        // Upright first (ffmpeg applies the rotation tag), then its size, then brought down to MAX_SIDE.
        const up = join(dir, "up.jpg");
        await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-frames:v", "1", "-q:v", "2", up]);
        const [w, h] = String(await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", up])).trim().split(",").map(Number);
        if (!(w > 0 && h > 0)) continue;
        size = readSize(w, h);
        await run("ffmpeg", ["-v", "error", "-y", "-i", up, "-vf", `scale=${size.w}:${size.h}:flags=lanczos`, "-q:v", "2", full]);
      } catch (e) { console.error("[spines] photo", slug, ph.name, e); continue; }
      const found: SpineRow[] = [];
      let failed = false;
      for (const [k, t] of tilesOf(size.w, size.h).entries()) {
        const tile = join(dir, `t${k}.jpg`);
        try {
          await run("ffmpeg", ["-v", "error", "-y", "-i", full, "-vf", `crop=${t.w}:${t.h}:${t.x}:${t.y}`, "-q:v", "2", tile]);
          const books = await readSpines(purse, new Uint8Array(readFileSync(tile)));
          tiles++;
          for (const b of books) if (b.readable === "full" || b.readable === "partial") found.push({ ...b, readable: b.readable, photo: ph.key, tile: k });
          // The zoom pass: a partly read title → the tile again as four enlarged quarters (Haiku is cheap: call it).
          if (books.some((b) => b.readable === "partial")) {
            for (const [qi, qr] of quartersOf(t).entries()) {
              const zf = join(dir, `t${k}q${qi}.jpg`);
              await run("ffmpeg", ["-v", "error", "-y", "-i", full, "-vf", `crop=${qr.w}:${qr.h}:${qr.x}:${qr.y},scale=iw*${qr.scale.toFixed(3)}:-2:flags=lanczos`, "-q:v", "2", zf]);
              const more = await readSpines(purse, new Uint8Array(readFileSync(zf)));
              tiles++;
              for (const b of more) if (b.readable === "full" || b.readable === "partial") found.push({ ...b, readable: b.readable, photo: ph.key, tile: k });
            }
          }
        } catch (e) {
          failed = true;
          if (e instanceof OverBudget) { stopped = ` Stopped at photo ${i + 1} of ${todo.length}: the store's AI budget is used up.`; break; }
          console.error("[spines] tile", slug, ph.name, k, e);
        }
      }
      list.rows = mergeSpines([...list.rows, ...found]);
      // A photo with a failed tile is not marked done: the next run reads it again (what it found merges).
      if (!failed) list.done.push(ph.key);
      list.spentCents = Math.round((list.spentCents + purse.spent() - before) * 100) / 100;
      list.updated = new Date().toISOString();
      await writeMastersJson(shelfTitlesKey(slug), list);
      if (stopped) break;
    }
    const inFull = list.rows.filter((r) => r.readable === "full").length;
    return `Spine reader: ${tiles} tiles read ($${((purse.spent() - before) / 100).toFixed(2)}); ${list.rows.length} titles from the shelf photos (${inFull} in full), ${list.done.length} of ${photos.length} photos done.${stopped}`;
  } finally {
    busy = false;
    rmSync(dir, { recursive: true, force: true });
    await setJob("shelfTitles", { busy: false, key: null });
  }
}
