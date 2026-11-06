// THE TIDY AGENT (owner, 2026-11-06: "on vbazaar virtual tour sometimes there are objects on the scene that need to be
// removed or replaced with some product photo: e.g. an ugly old chair, someone's sweater on the desk, some paper or
// stuff just siting there, lets deploy an agent that identify ugly unfitted junk or object and replace them with some
// products that are on a software made place or th original table where the stuff was so they are not hanging in the
// air at the end of store page there has to be a list of photos of those removed objects").
//
//   Finder    from the store's door on, one moment every few seconds, six views round the camera; Claude boxes the
//             clutter in them and says what it stands on (`findJunk`, Opus: a wrong box hides a product for sale)
//   Follower  each sighting is followed through the walk like a product's light (`follow`, free); follows of the
//             same thing are one object (`groupJunk`)
//   Dresser   each object gets a store product (`pickProducts`) on a made-up stand: a low riser on a table, a plinth
//             on the floor, none on a wall (`coverLayout`), composed by ffmpeg as a PNG; a photo of the object as it
//             was is kept for the store's page
//   Placer    the covers go on the walk (`Walk.covers`): the player draws each one standing where the junk stood and a
//             tap opens the product. The video is not touched, so «Bring it back» is exact.
//
// Spends from the store's own budget, at most `TIDY_CENTS` a run. Its progress is in the masters bucket after every
// look, so a restart (every push to main) carries on without paying twice. Server only.
import { putSignImage, presignGet, r2Config, readCatalogue, readMastersText, readWalks, webObjectExists, writeMastersJson, writeWalks } from "@/lib/splats/r2";
import { coverSize, phoneKeyOf, type WalkCover } from "@/lib/splats/walks";
import { readStore } from "./bucket";
import { sceneOf } from "./store";
import { purseOf } from "./crew";
import { findJunk, OverBudget, type Purse } from "./ai";
import { grayFrames, jpegOf, probe, productPhoto, run, views } from "./media";
import { setJob } from "./jobState";
import { FOLLOW_FPS, FOLLOW_SPAN, FOLLOW_W, LOOK_N, aim, boxSize, follow } from "./tagging";
import { TIDY_CENTS, baseOf, coverLayout, groupJunk, pickProducts, sameObject, tidyPlan, worthCovering, type Junk, type JunkSeen, type JunkTrack } from "./tidyRules";

const stateKey = (slug: string) => `stores/${slug}/tidy-state.json`;
/** Spots the owner said to leave as they are («Bring it back»): never covered again. */
const keptKey = (slug: string) => `stores/${slug}/tidy-kept.json`;

export type TidyState = {
  slug: string; walk: string; phase: "looking" | "dressing" | "done" | "failed"; note: string; at: string;
  looked: number; moments: number; seen: JunkSeen[]; spentFrom: number; resumes: number;
};
export async function readTidy(slug: string): Promise<TidyState | null> {
  try { const t = await readMastersText(stateKey(slug)); return t ? (JSON.parse(t) as TidyState) : null; } catch { return null; }
}
async function save(st: TidyState) {
  try { await writeMastersJson(stateKey(st.slug), { ...st, at: new Date().toISOString() }); } catch (e) { console.error("[tidy] state", e); }
}
const working = (st: TidyState | null) => Boolean(st && (st.phase === "looking" || st.phase === "dressing") && Date.now() - Date.parse(st.at) < 3 * 3600_000);

type Kept = { pins: Array<{ t: number; x: number; y: number }>; size: { w: number; h: number } };
async function readKept(slug: string): Promise<Kept[]> {
  try { const t = await readMastersText(keptKey(slug)); const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}

let busy = false;

/** Start the Tidy agent on a store's walk, behind the answer. Null when it started, else why not. */
export async function startTidy(slug: string, resume: TidyState | null = null): Promise<string | null> {
  if (busy || (!resume && working(await readTidy(slug)))) return "The Tidy agent is already working on this store.";
  const s = await readStore(slug);
  if (!s) return "No such store.";
  if (!s.out.walk) return "The store has no walk yet.";
  void tidyStore(slug, resume).then((note) => console.log("[tidy]", slug, note)).catch((e) => console.error("[tidy]", slug, e));
  return null;
}

/** On the server's start: a run a restart cut off carries on (at most 4 restarts). */
export async function resumeTidy(): Promise<void> {
  const { readIndex } = await import("./bucket");
  for (const s of await readIndex().catch(() => [])) {
    const st = await readTidy(s.slug);
    if (!st || !(st.phase === "looking" || st.phase === "dressing")) continue;
    if (st.resumes >= 4 || Date.now() - Date.parse(st.at) > 6 * 3600_000) { await save({ ...st, phase: "failed", note: "Stopped: the server restarted too often while it worked. Run it again." }); continue; }
    console.log("[tidy] resuming", s.slug, `${st.looked}/${st.moments}`);
    await startTidy(s.slug, { ...st, resumes: st.resumes + 1 });
    return; // one at a time
  }
}

/** The cover's picture: the product's photo on a white card, standing on a riser or plinth; transparent round it. */
async function composeCover(photoUrl: string, size: { w: number; h: number }, base: Junk["base"]): Promise<Uint8Array> {
  const res = await fetch(photoUrl);
  if (!res.ok) throw new Error(`the product's photo answered ${res.status}`);
  const photo = new Uint8Array(await res.arrayBuffer());
  const L = coverLayout(coverSize(size), base);
  const box = (x: number, y: number, w: number, h: number, c: string) => (w > 0 && h > 0 ? `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${c}:t=fill` : "");
  const stand = L.stand ? [
    box(0, L.H - L.stand, L.W, L.stand, "0xEDE6D6@1"), // the riser or plinth, a warm off-white
    box(0, L.H - L.stand, L.W, Math.max(3, Math.round(L.stand * 0.07)), "0xFFFFFF@1"), // its lit top edge
    box(Math.round(L.W * 0.82), L.H - L.stand, Math.round(L.W * 0.18), L.stand, "0xD9D0BD@1"), // its shaded side
    box(0, L.H - Math.max(4, Math.round(L.stand * 0.1)), L.W, Math.max(4, Math.round(L.stand * 0.1)), "0xBFB49C@1"), // where it meets the surface
  ] : [];
  const card = [
    box(L.card.x + 6, L.card.y + 6, L.card.w - 6, L.card.h - 6, "black@0.22"), // the card's shadow
    box(L.card.x, L.card.y, L.card.w, L.card.h, "0xFFFFFF@1"),
    `drawbox=x=${L.card.x}:y=${L.card.y}:w=${L.card.w}:h=${L.card.h}:color=0xD6CFC0@1:t=3`,
  ];
  const draw = [...stand, ...card].filter(Boolean).join(",");
  // ⚠️ drawbox paints colour, never alpha: the picture is drawn on white, then cut out by a mask of the same boxes.
  const solid = (x: number, y: number, w: number, h: number) => (w > 0 && h > 0 ? `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=white:t=fill` : "");
  const mask = [solid(0, L.H - L.stand, L.W, L.stand), solid(L.card.x, L.card.y, L.card.w + 6, L.card.h)].filter(Boolean).join(",");
  const graph = `[1:v]format=rgb24,${draw}[bg];` +
    `[0:v]scale=${L.photo.w}:${L.photo.h}:force_original_aspect_ratio=decrease,pad=${L.photo.w}:${L.photo.h}:(ow-iw)/2:(oh-ih)/2:color=white,format=rgb24[ph];` +
    `[bg][ph]overlay=${L.photo.x}:${L.photo.y}[pic];[2:v]format=gray,${mask}[m];[pic][m]alphamerge,format=rgba[out]`;
  return new Uint8Array(await run("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-f", "lavfi", "-i", `color=c=white:s=${L.W}x${L.H}`, "-f", "lavfi", "-i", `color=c=black:s=${L.W}x${L.H}`,
    "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-threads", "1", "-f", "image2", "-c:v", "png", "pipe:1",
  ], { input: photo }));
}

/** The whole run. Returns what it did, in a sentence. */
export async function tidyStore(slug: string, resume: TidyState | null = null): Promise<string> {
  if (busy) return "The Tidy agent is busy.";
  busy = true;
  const s = await readStore(slug);
  if (!s?.out.walk) { busy = false; return "No walk."; }
  const walkKey = s.out.walk;
  const store = purseOf(s);
  const st: TidyState = resume && resume.walk === walkKey ? resume : {
    slug, walk: walkKey, phase: "looking", note: "Starting…", at: "", looked: 0, moments: 0, seen: [], spentFrom: store.spent(), resumes: 0,
  };
  // The run's own ceiling inside the store's budget.
  const purse: Purse = { spent: store.spent, limit: Math.min(store.limit, st.spentFrom + TIDY_CENTS), add: store.add };
  const say = async (note: string) => { st.note = note; await save(st); await setJob("tidy", { busy: true, key: walkKey, note }); };
  try {
    const walk = (await readWalks()).walks[walkKey];
    if (!walk) throw new Error("The walk is gone.");
    if (walk.projection === "flat" || walk.projection === "eac") throw new Error("Not a 360° walk.");
    const src = await presignGet(walkKey, "web", 6 * 3600);
    const followSrc = (await webObjectExists(phoneKeyOf(walkKey))) ? await presignGet(phoneKeyOf(walkKey), "web", 6 * 3600) : src;
    const { seconds } = await probe(src);
    if (!seconds) throw new Error("The walk's video could not be read.");
    const plan = tidyPlan(seconds, walk.faceAt ?? walk.tagsFrom ?? 0);
    st.moments = plan.length;

    // 1. Finder.
    let stopped = "";
    for (const m of plan.slice(st.looked)) {
      if (st.phase !== "looking") break;
      await say(`Looking for clutter… ${Math.round((st.looked / plan.length) * 100)}% (${st.seen.length} sightings)`);
      let pics: Uint8Array[];
      try { pics = await views(src, m.t, m.looks.map((l) => l.heading), m.looks[0].pitch, m.looks[0].fov, LOOK_N); }
      catch (e) { console.error("[tidy] views", slug, m.t, e); st.looked++; continue; }
      let found;
      try { found = await findJunk(purse, m.looks.map((l, i) => ({ id: l.id, jpeg: pics[i] }))); }
      catch (e) {
        if (e instanceof OverBudget) { stopped = ` The ceiling ($${(TIDY_CENTS / 100).toFixed(2)} a run, within the store's budget) stopped the looking at ${Math.round((st.looked / plan.length) * 100)}% of the walk.`; break; }
        console.error("[tidy] look", slug, m.t, e); st.looked++; continue;
      }
      for (const f of found) {
        const look = m.looks.find((l) => l.id === f.view);
        if (!look) continue;
        const at = aim(look, f.box), size = boxSize(look, f.box);
        const seen: JunkSeen = { t: m.t, lon: at.lon, lat: at.lat, size, what: f.what, base: baseOf(f.base), confidence: f.confidence };
        if (worthCovering(seen)) st.seen.push(seen);
      }
      st.looked++;
      await save(st);
    }
    if (!st.seen.length) {
      st.phase = "done";
      await say(`No clutter found in the store's walk.${stopped}`);
      return st.note;
    }

    // 2. Follower.
    st.phase = "dressing";
    const tracks: JunkTrack[] = [];
    const moments = [...new Set(st.seen.map((x) => x.t))].sort((a, b) => a - b);
    for (const [i, t] of moments.entries()) {
      await say(`Following ${st.seen.length} sightings through the walk… ${i + 1} of ${moments.length}`);
      const start = Math.max(0, t - FOLLOW_SPAN);
      const { frames, W, H } = await grayFrames(followSrc, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
      if (!frames.length) continue;
      const i0 = Math.min(frames.length - 1, Math.round((t - start) * FOLLOW_FPS));
      for (const x of st.seen.filter((y) => y.t === t)) tracks.push({ ...x, pins: follow(frames, W, H, start, i0, { lon: x.lon, lat: x.lat }, x.size) });
    }
    const kept = await readKept(slug);
    const junk = groupJunk(tracks).filter((j) => !kept.some((k) => sameObject(j, { ...j, pins: k.pins, size: k.size })));

    // 3. Dresser.
    const c = await readCatalogue(sceneOf(slug));
    const ns = pickProducts(c?.products ?? [], junk.length);
    if (!ns.length) throw new Error("The store's list has no product with a photo to put in the clutter's place.");
    const byN = new Map((c?.products ?? []).map((p) => [p.n, p]));
    const base = r2Config().publicBase;
    const covers: WalkCover[] = [];
    for (const [i, j] of junk.entries()) {
      await say(`Putting products in place of ${junk.length} objects… ${i + 1} of ${junk.length}`);
      const id = `tidy-${Math.round(j.t * 10)}-${i + 1}`;
      const stamp = Date.now();
      try {
        const wasKey = `scenes/${sceneOf(slug)}/tidy/${id}-was-${stamp}.jpg`;
        await putSignImage(wasKey, "image/jpeg", await jpegOf(await productPhoto(src, j.t, j.lon, j.lat, j.size, 640), 900));
        const p = byN.get(ns[i])!;
        const coverKey = `scenes/${sceneOf(slug)}/tidy/${id}-cover-${stamp}.png`;
        await putSignImage(coverKey, "image/png", await composeCover(p.photo!, j.size, j.base));
        covers.push({ id, n: p.n, pins: j.pins, size: j.size, base: j.base, what: j.what, image: `${base}/${coverKey}`, photo: `${base}/${wasKey}` });
      } catch (e) { console.error("[tidy] dress", slug, id, e); }
    }

    // 4. Placer: the run's covers replace the last run's.
    const walks = await readWalks();
    const w = walks.walks[walkKey];
    if (!w) throw new Error("The walk is gone.");
    await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...w, covers } } }, walks);
    st.phase = "done";
    await say(`Hid ${covers.length} objects behind the store's products ($${((store.spent() - st.spentFrom) / 100).toFixed(2)} spent).${stopped} They are listed at the end of the store's page; «Bring it back» takes any cover off.`);
    return st.note;
  } catch (e) {
    st.phase = "failed";
    await say(e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    busy = false;
    await setJob("tidy", { busy: false, key: null });
  }
}

/** «Bring it back»: one cover off, and that spot remembered so a later run leaves it. */
export async function dropCover(slug: string, id: string): Promise<string> {
  const s = await readStore(slug);
  if (!s?.out.walk) return "No walk.";
  const walks = await readWalks();
  const w = walks.walks[s.out.walk];
  // `id` "all": no tidying on this store at all (owner, 2026-11-06: "an option on each object replaced if we do not
  // want any tidy ness"): every cover off, every spot remembered.
  const gone = id === "all" ? (w?.covers ?? []) : (w?.covers ?? []).filter((x) => x.id === id);
  const c = gone[0];
  if (!w || !c) return id === "all" ? "Nothing is hidden on this walk." : "No such cover.";
  await writeMastersJson(keptKey(slug), [...(await readKept(slug)), ...gone.map((x) => ({ pins: x.pins, size: x.size }))]);
  const covers = (w.covers ?? []).filter((x) => !gone.includes(x));
  const { covers: _, ...rest } = w;
  await writeWalks({ ...walks, walks: { ...walks.walks, [s.out.walk]: covers.length ? { ...rest, covers } : rest } }, walks);
  return id === "all" ? `All ${gone.length} objects are back in the walk as it was filmed; no tidying on this store.` : `«${c.what}» is back in the walk as it was filmed.`;
}

/** Another product in a cover's place: the cover's picture made again with it. */
export async function coverProduct(slug: string, id: string, n: number): Promise<string> {
  const s = await readStore(slug);
  if (!s?.out.walk) return "No walk.";
  const p = (await readCatalogue(sceneOf(slug)))?.products.find((x) => x.n === n);
  if (!p?.photo) return `Product #${n} has no photo to show.`;
  const walks = await readWalks();
  const w = walks.walks[s.out.walk];
  const c = w?.covers?.find((x) => x.id === id);
  if (!w || !c) return "No such cover.";
  const coverKey = `scenes/${sceneOf(slug)}/tidy/${id}-cover-${Date.now()}.png`;
  await putSignImage(coverKey, "image/png", await composeCover(p.photo, c.size, c.base));
  const covers = (w.covers ?? []).map((x) => (x.id === id ? { ...x, n, image: `${r2Config().publicBase}/${coverKey}` } : x));
  await writeWalks({ ...walks, walks: { ...walks.walks, [s.out.walk]: { ...w, covers } } }, walks);
  return `#${n} now stands in place of «${c.what}».`;
}

/** For the store's page: the run, and every object hidden, with its photo and what stands in its place. */
export async function tidyForPage(slug: string, walkKey: string | undefined) {
  const st = await readTidy(slug);
  const w = walkKey ? (await readWalks().catch(() => null))?.walks[walkKey] : undefined;
  return {
    run: st ? { phase: st.phase, note: st.note, at: st.at, working: working(st), looked: st.looked, moments: st.moments } : null,
    covers: (w?.covers ?? []).map((c) => ({ id: c.id, what: c.what, photo: c.photo, image: c.image, n: c.n, t: c.pins[0]?.t ?? 0, base: c.base })),
    ceiling: TIDY_CENTS,
  };
}
