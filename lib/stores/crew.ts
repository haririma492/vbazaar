/**
 * THE STORE BUILDER CREW AT WORK — the loop that takes each store from its
 * uploads to a walkable shop in the bazaar, on this server, with nobody
 * pressing anything (owner, 2026-10-30).
 *
 *   loop      `kick()` wakes it (an upload, a message, «Publish», the server
 *             starting); it runs each store's next step (`nextStep`) until no
 *             store has one, then sleeps. One step at a time on the whole
 *             server: encoding takes its CPU.
 *   a step    is marked working, run, then done / failed (tried again, up to
 *             MAX_TRIES) / needs-you (a person must act; the note says what).
 *             Its progress is saved in the store's record, so a restart runs
 *             the step that was working again.
 *   money     every Claude request is priced and added to the store's
 *             spending; at $5 the AI steps stop and say so (`ai.ts`).
 *
 * The steps: `video` → `catalogue` → `photos` → `tag` → `place` → `check`
 * (store.ts says what each waits for). Areas' videos (outside, lobby,
 * hallway) go through the same Video agent (`areaVideo`).
 * Messages to the crew on a store's page are answered here too (`messages.ts`).
 * Server only.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, putSignImage, r2Config, readCatalogue, readWalks, uploadFile, webObjectExists, writeCatalogue, writeWalks } from "@/lib/splats/r2";
import { phoneKeyOf, looksFlat, MAX_ITEMS, type Walks } from "@/lib/splats/walks";
import { MAX_NUMBER, type Catalogue, type Product } from "@/lib/splats/catalogue";
import { BUDGET_CENTS, addToThread, allDone, nextStep, redo, sceneOf, setStep, type StepName, type StoreRecord } from "./store";
import { readBazaar, readIndex, readStore, updateBazaar, updateStore } from "./bucket";
import { areaDoorOf, areaScene, doorOf, joins, spotFor, startOf, takeSpot, type Bazaar } from "./bazaar";
import { cropJpeg, encode, grayFrames, jpegOf, probe, views } from "./media";
import { discoverInViews, findInViews, matchPhoto, NoKey, OverBudget, type Purse } from "./ai";
import { matchFileName, photoList, picturesByProduct, productSheet, readBook } from "./workbook";
import { FOLLOW_FPS, FOLLOW_SPAN, FOLLOW_W, HEADINGS, LOOK_FOV, LOOK_N, LOOK_PITCH, aim, follow, itemOf, keepTracks, lookPlan, type Look, type Track } from "./tagging";
import { answerAreaMessages, answerMessages } from "./messages";

/** A step that needs a person: the note says what. */
export class NeedsYou extends Error {}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
const publicUrl = (key: string) => `${r2Config().publicBase}/${key}`;

// ── The loop ────────────────────────────────────────────────────────────────

let running = false;
let again = false;

/** Wake the crew. Safe to call any number of times. */
export function kick(): void {
  again = true;
  if (!running && r2Config().configured) void loop();
}

async function loop() {
  running = true;
  try {
    while (again) {
      again = false;
      for (const area of (await readBazaar()).areas) {
        if (area.thread.some((e) => e.open)) {
          await answerAreaMessages(area.id).catch((e) => console.error("[crew] area messages", area.id, e));
          again = true;
        }
        if (area.files.video && (area.video.state === "todo" || area.video.state === "working" || (area.video.state === "failed" && area.video.tries < 3))) {
          await areaVideo(area.id);
          again = true;
        }
      }
      for (const { slug } of await readIndex()) {
        for (let guard = 0; guard < 12; guard++) {
          const s = await readStore(slug);
          if (!s) break;
          if (s.thread.some((e) => e.open)) {
            await answerMessages(slug).catch((e) => console.error("[crew] messages", slug, e));
            again = true;
            continue;
          }
          const step = nextStep(s);
          if (!step) break;
          await runStep(slug, step);
          again = true;
        }
      }
    }
  } catch (e) {
    console.error("[crew]", e);
  } finally {
    running = false;
  }
}

const STEP_RUN: Record<StepName, (s: StoreRecord, say: (note: string) => Promise<void>) => Promise<string>> = {
  video: stepVideo,
  catalogue: stepCatalogue,
  photos: stepPhotos,
  tag: stepTag,
  place: stepPlace,
  check: stepCheck,
};

async function runStep(slug: string, step: StepName) {
  const s = await updateStore(slug, (x) => setStep(x, step, "working", "Starting…", new Date()));
  if (!s) return;
  let lastSaid = 0;
  const say = async (note: string) => {
    if (Date.now() - lastSaid < 15_000) return;
    lastSaid = Date.now();
    await updateStore(slug, (x) => setStep(x, step, "working", note, new Date()));
  };
  try {
    const note = await STEP_RUN[step](s, say);
    await updateStore(slug, (x) => {
      let next = setStep(x, step, "done", note, new Date());
      if (step === "check" && !next.live) {
        next = addToThread(next, { at: new Date().toISOString(), from: "crew", text: "The store is ready. Walk it from the link above, then press «Publish» to open it in the bazaar. · فروشگاه آماده است؛ پس از دیدن، «انتشار» را بزنید." });
      }
      return next;
    });
  } catch (e) {
    const err = e as Error;
    console.error(`[crew] ${slug} ${step}`, err);
    const needsYou = err instanceof NeedsYou || err instanceof NoKey || err instanceof OverBudget;
    await updateStore(slug, (x) => setStep(x, step, needsYou ? "needs-you" : "failed", err.message, new Date()));
  }
}

/** The store's spending, kept in its record as each request is paid. */
function purseOf(s: StoreRecord): Purse {
  let spent = s.spentCents;
  return {
    spent: () => spent,
    limit: BUDGET_CENTS,
    add: async (cents) => {
      spent += cents;
      await updateStore(s.slug, (x) => ({ ...x, spentCents: Math.round((x.spentCents + cents) * 100) / 100 }));
    },
  };
}

// ── Video agent ─────────────────────────────────────────────────────────────

/**
 * The upload → two copies a browser can walk: the web copy (up to 5.7K,
 * sharp on a computer) and the 4K phone copy (no phone plays 8K). Both
 * H.264 with a keyframe every 10 frames so walking back is smooth.
 */
async function makeWalk(masterKey: string, scene: string, say: (note: string) => Promise<void>): Promise<{ key: string; seconds: number }> {
  const dir = mkdtempSync(join(tmpdir(), "walk-"));
  try {
    const src = join(dir, "src.mp4");
    await say("Downloading the upload…");
    await downloadToFile(masterKey, src, "master");
    const info = await probe(src);
    if (!info.width || !info.seconds) throw new NeedsYou("The video could not be read. Export it again from Insta360 Studio as 360 Video (.mp4) and upload it.");
    if (looksFlat(info.width, info.height)) {
      throw new NeedsYou(`This video is ${info.width}×${info.height}, not a 360° walk (2:1). In Insta360 Studio choose Export → 360 Video, not Reframe. · این ویدیو ۳۶۰ نیست.`);
    }
    const key = `scenes/${scene}/walk-${stamp()}.mp4`;
    const web = join(dir, "web.mp4"), phone = join(dir, "phone.mp4");
    await encode(src, web, 5760, 18, info.seconds, (p) => void say(`Making the web copy… ${p}%`));
    await encode(src, phone, 3840, 21, info.seconds, (p) => void say(`Making the phone copy… ${p}%`));
    rmSync(src, { force: true });
    await say("Saving the copies…");
    await uploadFile(key, web, "video/mp4");
    await uploadFile(phoneKeyOf(key), phone, "video/mp4");
    return { key, seconds: info.seconds };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function stepVideo(s: StoreRecord, say: (note: string) => Promise<void>): Promise<string> {
  const { key, seconds } = await makeWalk(s.files.video!.key, sceneOf(s.slug), say);
  const walks = await readWalks();
  const next: Walks = { ...walks, walks: { ...walks.walks, [key]: { title: { en: s.name.en, fa: s.name.fa }, doors: [] } } };
  await writeWalks(next, walks);
  await updateStore(s.slug, (x) => ({ ...x, out: { ...x.out, walk: key } }));
  return `The walk is ready: ${Math.round(seconds)} s, web and phone copies.`;
}

/** An area's walk (outside, lobby, hallway), then the joins between areas. */
async function areaVideo(id: string) {
  const say = async (note: string) => {
    await updateBazaar((b) => ({ ...b, areas: b.areas.map((a) => (a.id === id ? { ...a, video: { ...a.video, state: "working", note, at: new Date().toISOString() } } : a)) }));
  };
  const b = await readBazaar();
  const area = b.areas.find((a) => a.id === id);
  if (!area?.files.video) return;
  try {
    await say("Starting…");
    const { key, seconds } = await makeWalk(area.files.video.key, areaScene(id), say);
    const after = await updateBazaar((x) => ({
      ...x, areas: x.areas.map((a) => (a.id === id ? { ...a, walk: key, video: { state: "done", tries: 0, note: `The walk is ready: ${Math.round(seconds)} s.`, at: new Date().toISOString() } } : a)),
    }));
    await writeJoins(after);
    // Doors on this area belong to its old video's timeline: its stores are placed again.
    const onIt = new Set(after.spots.filter((sp) => sp.area === id && sp.store).map((sp) => sp.store!));
    for (const { slug } of await readIndex()) if (onIt.has(slug) || !after.spots.some((sp) => sp.store === slug)) await updateStore(slug, (x) => redo(x, ["place", "check"]));
  } catch (e) {
    const err = e as Error;
    await updateBazaar((x) => ({
      ...x, areas: x.areas.map((a) => (a.id === id ? { ...a, video: { state: err instanceof NeedsYou ? "needs-you" : "failed", tries: a.video.tries + 1, note: err.message, at: new Date().toISOString() } } : a)),
    }));
  }
}

/**
 * The areas joined (`Walk.next`, `joins`), the doors from one area into
 * another (spots with `toArea`), and where shoppers start (the first place's
 * first area with a walk).
 */
export async function writeJoins(b: Bazaar) {
  const walks = await readWalks();
  const next: Walks = { ...walks, walks: { ...walks.walks } };
  const areaWalks = new Set(b.areas.map((a) => a.walk).filter(Boolean) as string[]);
  for (const [k, w] of Object.entries(next.walks)) {
    if (!areaWalks.has(k)) continue;
    next.walks[k] = { ...w, next: undefined, doors: w.doors.filter((d) => !d.id.startsWith("area-")) };
  }
  for (const a of b.areas) if (a.walk && !next.walks[a.walk]) next.walks[a.walk] = { title: { en: a.name.en, fa: a.name.fa }, doors: [] };
  for (const j of joins(b)) next.walks[j.from] = { ...(next.walks[j.from] ?? { doors: [] }), next: j.to };
  for (const sp of b.spots) {
    if (!sp.toArea) continue;
    const from = b.areas.find((a) => a.id === sp.area), to = b.areas.find((a) => a.id === sp.toArea);
    const door = to ? areaDoorOf(sp, to) : null;
    if (!from?.walk || !door) continue;
    const w = next.walks[from.walk] ?? { doors: [] };
    next.walks[from.walk] = { ...w, doors: [...w.doors.filter((d) => d.id !== door.id), door] };
  }
  const first = b.places.map((p) => startOf(b, p.id)).find(Boolean)?.walk ?? b.areas.find((a) => a.walk)?.walk;
  if (first) next.start = first;
  await writeWalks(next, walks);
}

// ── Catalogue agent ─────────────────────────────────────────────────────────

async function readUpload(key: string): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "up-"));
  try {
    const p = join(dir, "f");
    await downloadToFile(key, p, "master");
    return new Uint8Array(readFileSync(p));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A product photo put where shoppers' browsers read it; its address. */
async function publishPhoto(slug: string, n: number, bytes: Uint8Array): Promise<string> {
  const key = `scenes/catalogues/${sceneOf(slug)}/p${n}-${stamp()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  await putSignImage(key, "image/jpeg", await jpegOf(bytes, 1200));
  return publicUrl(key);
}

async function stepCatalogue(s: StoreRecord, say: (note: string) => Promise<void>): Promise<string> {
  if (!s.files.sheet) return productsFromVideo(s, say);
  await say("Reading the workbook…");
  const book = readBook(await readUpload(s.files.sheet!.key));
  const sheet = productSheet(book);
  if (!sheet) {
    throw new NeedsYou(`No product list found in «${s.files.sheet!.name}». A sheet needs a header row with the product's title (title_en or title_fa) and, best, its number, unit and unit price. · فهرست محصولات پیدا نشد.`);
  }
  const products = sheet.products.map((p) => ({ ...p }));
  const pics = picturesByProduct(book, sheet, photoList(book, products, sheet.sheet));
  let fromSheet = 0;
  for (const [pic, m] of pics) {
    const p = products.find((x) => x.n === m.n);
    if (!p || p.photo) continue;
    p.photo = await publishPhoto(s.slug, p.n, pic.bytes);
    fromSheet++;
  }
  const c: Catalogue = { store: sceneOf(s.slug), products };
  await writeCatalogue(c);
  const problems = sheet.problems.length ? ` ${sheet.problems.length} rows need a look: ${sheet.problems.slice(0, 5).join(" ")}` : "";
  return `${products.length} products from sheet «${sheet.sheet}»${fromSheet ? `, ${fromSheet} with the photo from the workbook` : ""}.${problems}`;
}

// ── Photo matcher ───────────────────────────────────────────────────────────

/** Below this, Claude's guess is not taken: the photo is listed for a person. */
const PHOTO_SURE = 0.7;

async function stepPhotos(s: StoreRecord, say: (note: string) => Promise<void>): Promise<string> {
  const c = await readCatalogue(sceneOf(s.slug));
  if (!c?.products.length) return "No products to match photos to.";
  if (!s.files.sheet) return "No sheet: each product's photo was cut from the video.";
  const book = readBook(await readUpload(s.files.sheet!.key));
  const sheet = productSheet(book);
  const list = sheet ? photoList(book, c.products, sheet.sheet) : [];
  const purse = purseOf(s);
  const products = c.products.map((p) => ({ ...p }));
  let byName = 0, byLook = 0;
  const unmatched: string[] = [];
  for (const [i, f] of s.files.photos.entries()) {
    await say(`Photo ${i + 1} of ${s.files.photos.length}…`);
    const bytes = await readUpload(f.key);
    let n = matchFileName(f.name, products, list)?.n ?? null;
    if (n !== null) byName++;
    else {
      try {
        const guess = await matchPhoto(purse, products, await jpegOf(bytes, 768), f.name);
        if (guess.n !== null && guess.confidence >= PHOTO_SURE) { n = guess.n; byLook++; }
      } catch (e) {
        if (e instanceof OverBudget || e instanceof NoKey) { unmatched.push(...s.files.photos.slice(i).map((x) => x.name)); break; }
        throw e;
      }
    }
    const p = n === null ? undefined : products.find((x) => x.n === n);
    if (!p) { unmatched.push(f.name); continue; }
    // An uploaded photo is newer than one in the workbook: it wins.
    p.photo = await publishPhoto(s.slug, p.n, bytes);
  }
  await writeCatalogue({ ...c, products });
  await updateStore(s.slug, (x) => ({ ...x, out: { ...x.out, matched: byName + byLook, unmatched } }));
  if (!s.files.photos.length) return "No separate photos were uploaded; the workbook's are used.";
  return `${byName + byLook} of ${s.files.photos.length} photos joined to their product (${byName} by name or list, ${byLook} by looking)${unmatched.length ? `; not placed: ${unmatched.slice(0, 8).join(", ")}${unmatched.length > 8 ? "…" : ""}` : ""}.`;
}

// ── Tagger ──────────────────────────────────────────────────────────────────

async function stepTag(s: StoreRecord, say: (note: string) => Promise<void>): Promise<string> {
  const walkKey = s.out.walk;
  if (!walkKey) throw new Error("The walk is not made yet.");
  if (s.out.found === walkKey) return "The tags were pinned while the products were found in the video.";
  const c = await readCatalogue(sceneOf(s.slug));
  if (!c?.products.length) return "No products to tag.";
  const dir = mkdtempSync(join(tmpdir(), "tag-"));
  try {
    const src = join(dir, "phone.mp4");
    await say("Downloading the walk…");
    await downloadToFile(phoneKeyOf(walkKey), src, "web");
    const { seconds } = await probe(src);
    const plan = lookPlan(seconds);
    const purse = purseOf(s);
    const sightings: Array<{ look: Look; n: number; box: [number, number, number, number]; confidence: number }> = [];
    let stopped = "";
    for (const [i, moment] of plan.entries()) {
      await say(`Looking for products: moment ${i + 1} of ${plan.length}, ${sightings.length} seen so far…`);
      const jpegs = await views(src, moment.t, HEADINGS, LOOK_PITCH, LOOK_FOV, LOOK_N);
      try {
        const found = await findInViews(purse, c.products, moment.looks.map((l, k) => ({ id: l.id, jpeg: jpegs[k] })));
        for (const f of found) sightings.push({ look: moment.looks.find((l) => l.id === f.view)!, n: f.n, box: f.box, confidence: f.confidence });
      } catch (e) {
        if (e instanceof OverBudget) { stopped = ` Stopped at ${Math.round(moment.t)} s of ${Math.round(seconds)}: the $5 budget is used up.`; break; }
        throw e;
      }
    }
    // Follow each sighting both ways through the frames round its moment.
    const tracks: Track[] = [];
    const moments = [...new Set(sightings.map((x) => x.look.t))];
    for (const [i, t] of moments.entries()) {
      await say(`Pinning tags to the products: ${i + 1} of ${moments.length}…`);
      const start = Math.max(0, t - FOLLOW_SPAN);
      const { frames, W, H } = await grayFrames(src, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
      if (!frames.length) continue;
      const grey = frames.map((f) => Float32Array.from(f));
      const i0 = Math.min(grey.length - 1, Math.round((t - start) * FOLLOW_FPS));
      for (const x of sightings.filter((y) => y.look.t === t && y.confidence >= 0.6)) {
        tracks.push({ n: x.n, confidence: x.confidence, pins: follow(grey, W, H, start, i0, aim(x.look, x.box)) });
      }
    }
    const kept = keepTracks(tracks).slice(0, MAX_ITEMS);
    const byN = new Map(c.products.map((p) => [p.n, p]));
    const count = new Map<number, number>();
    const items = kept.map((t) => {
      const k = count.get(t.n) ?? 0;
      count.set(t.n, k + 1);
      return itemOf(t, byN.get(t.n)!, k);
    });
    const walks = await readWalks();
    const walk = walks.walks[walkKey] ?? { doors: [] };
    // Tags someone put by hand stay; the crew's own are replaced.
    const hand = (walk.items ?? []).filter((it) => !it.id.startsWith("auto-"));
    const specials = new Map((walk.items ?? []).filter((it) => it.special && it.n).map((it) => [it.n!, it.special!]));
    const merged = [...hand, ...items.map((it) => (specials.has(it.n!) ? { ...it, special: specials.get(it.n!) } : it))].slice(0, MAX_ITEMS);
    await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...walk, items: merged } } }, walks);
    const tagged = new Set(items.map((it) => it.n!));
    const notFound = c.products.map((p) => p.n).filter((n) => !tagged.has(n));
    await updateStore(s.slug, (x) => ({ ...x, out: { ...x.out, tagged: items.length, notFound } }));
    return `${items.length} tags pinned on ${tagged.size} of ${c.products.length} products${notFound.length ? `; not found in the video: #${notFound.slice(0, 20).join(", #")}${notFound.length > 20 ? "…" : ""}` : ""}.${stopped}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Product finder (no sheet) ───────────────────────────────────────────────

/**
 * NO SHEET, NO PHOTOS (owner, 2026-11-01): the store's products are found in
 * its walk. At each look (`lookPlan`) Claude lists the products for sale in
 * the views round the camera, naming one seen before by its # (`ai.ts`,
 * `discoverInViews`). Each product's clearest sighting is cut out as its
 * photo; its sightings are followed through the frames and pinned as tags, as
 * the Tagger does. The list is the store's product list: names from Claude,
 * «Price in store», sold by the piece, until the owner fills them in on the
 * store's page. A list the owner has already filled in is kept: a new video
 * only re-pins it (the Tagger).
 */
async function productsFromVideo(s: StoreRecord, say: (note: string) => Promise<void>): Promise<string> {
  const walkKey = s.out.walk;
  if (!walkKey) throw new Error("The walk is not made yet.");
  const existing = await readCatalogue(sceneOf(s.slug));
  if (existing?.products.length) return `Keeping the product list (${existing.products.length} products); the Tagger pins them on the new video.`;
  const dir = mkdtempSync(join(tmpdir(), "find-"));
  try {
    const src = join(dir, "phone.mp4");
    await say("Downloading the walk…");
    await downloadToFile(phoneKeyOf(walkKey), src, "web");
    const { seconds } = await probe(src);
    const plan = lookPlan(seconds);
    const purse = purseOf(s);
    const products: Array<{ n: number; en: string; fa: string; best: { jpeg: Uint8Array; box: [number, number, number, number]; score: number } }> = [];
    const sightings: Array<{ look: Look; n: number; box: [number, number, number, number]; confidence: number }> = [];
    let stopped = "";
    for (const [i, moment] of plan.entries()) {
      await say(`Finding products: moment ${i + 1} of ${plan.length}, ${products.length} found so far…`);
      const jpegs = await views(src, moment.t, HEADINGS, LOOK_PITCH, LOOK_FOV, LOOK_N);
      let seen;
      try {
        seen = await discoverInViews(purse, products.map((p) => ({ n: p.n, en: p.en })), moment.looks.map((l, k) => ({ id: l.id, jpeg: jpegs[k] })));
      } catch (e) {
        if (e instanceof OverBudget) { stopped = ` Stopped at ${Math.round(moment.t)} s of ${Math.round(seconds)}: the $5 budget is used up.`; break; }
        throw e;
      }
      for (const f of seen) {
        if (f.confidence < 0.6) continue;
        const k = moment.looks.findIndex((l) => l.id === f.view);
        const score = ((f.box[2] - f.box[0]) * (f.box[3] - f.box[1])) * f.confidence;
        let p = f.same !== null ? products.find((x) => x.n === f.same) : undefined;
        if (!p) {
          if (products.length >= MAX_NUMBER) continue;
          p = { n: products.length + 1, en: f.en, fa: f.fa, best: { jpeg: jpegs[k], box: f.box, score } };
          products.push(p);
        } else if (score > p.best.score) {
          p.best = { jpeg: jpegs[k], box: f.box, score };
          if (!p.fa && f.fa) p.fa = f.fa;
        }
        sightings.push({ look: moment.looks[k], n: p.n, box: f.box, confidence: f.confidence });
      }
    }
    if (!products.length) throw new NeedsYou(`No products were found in the video.${stopped} Film the shelves closer and slower, or upload the product sheet. · محصولی در ویدیو پیدا نشد.`);
    await say(`Cutting out ${products.length} product photos…`);
    const listed: Product[] = [];
    for (const p of products) {
      let photo: string | undefined;
      try { photo = await publishPhoto(s.slug, p.n, await cropJpeg(p.best.jpeg, p.best.box)); } catch (e) { console.error("[crew] crop", s.slug, p.n, e); }
      listed.push({ n: p.n, en: p.en, ...(p.fa ? { fa: p.fa } : {}), unit: "piece", priceCents: null, by: "video", ...(photo ? { photo } : {}) });
    }
    await writeCatalogue({ store: sceneOf(s.slug), products: listed });
    // Pinned as the Tagger pins: each sighting followed both ways through the frames.
    const tracks: Track[] = [];
    const moments = [...new Set(sightings.map((x) => x.look.t))];
    for (const [i, t] of moments.entries()) {
      await say(`Pinning tags to the products: ${i + 1} of ${moments.length}…`);
      const start = Math.max(0, t - FOLLOW_SPAN);
      const { frames, W, H } = await grayFrames(src, FOLLOW_FPS, FOLLOW_W, start, FOLLOW_SPAN * 2 + 0.2);
      if (!frames.length) continue;
      const grey = frames.map((f) => Float32Array.from(f));
      const i0 = Math.min(grey.length - 1, Math.round((t - start) * FOLLOW_FPS));
      for (const x of sightings.filter((y) => y.look.t === t)) tracks.push({ n: x.n, confidence: x.confidence, pins: follow(grey, W, H, start, i0, aim(x.look, x.box)) });
    }
    const byN = new Map(listed.map((p) => [p.n, p]));
    const count = new Map<number, number>();
    const items = keepTracks(tracks).slice(0, MAX_ITEMS).map((t) => {
      const k = count.get(t.n) ?? 0;
      count.set(t.n, k + 1);
      return itemOf(t, byN.get(t.n)!, k);
    });
    const walks = await readWalks();
    const walk = walks.walks[walkKey] ?? { doors: [] };
    const hand = (walk.items ?? []).filter((it) => !it.id.startsWith("auto-"));
    await writeWalks({ ...walks, walks: { ...walks.walks, [walkKey]: { ...walk, items: [...hand, ...items].slice(0, MAX_ITEMS) } } }, walks);
    const tagged = new Set(items.map((it) => it.n!));
    await updateStore(s.slug, (x) => ({ ...x, out: { ...x.out, found: walkKey, tagged: items.length, notFound: listed.map((p) => p.n).filter((n) => !tagged.has(n)) } }));
    return `${products.length} products found in the video, ${items.length} tags pinned. Give each its price on this page («Products»).${stopped}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Placer ──────────────────────────────────────────────────────────────────

async function stepPlace(s: StoreRecord, say: (note: string) => Promise<void>): Promise<string> {
  const b = await readBazaar();
  const spot = spotFor(b, s.slug);
  if (!spot) throw new NeedsYou("No free door spot for this store: on /stores/areas, upload an area's walk (the hallway, or outside if the store opens onto the street) and mark its door spots. · جای خالی برای در فروشگاه نیست.");
  const area = b.areas.find((a) => a.id === spot.area);
  if (!area?.walk) throw new NeedsYou(`The walk of «${area?.name.en ?? spot.area}», where this store's door spot is, is not up yet: upload it on /stores/areas. · ویدیوی این بخش هنوز بارگذاری نشده است.`);
  await updateBazaar((x) => takeSpot(x, spot.id, s.slug));
  let image = s.out.doorImage;
  if (s.files.door && !image?.includes(s.files.door.key.split("/").pop()!.slice(0, 15))) {
    await say("Preparing the door photo…");
    const key = `scenes/${sceneOf(s.slug)}/door-${s.files.door.key.split("/").pop()!.slice(0, 15)}.jpg`;
    await putSignImage(key, "image/jpeg", await jpegOf(await readUpload(s.files.door.key), 1600));
    image = publicUrl(key);
  }
  await updateStore(s.slug, (x) => ({ ...x, out: { ...x.out, spot: spot.id, ...(image ? { doorImage: image } : {}) } }));
  const walks = await readWalks();
  const id = `store-${s.slug}`;
  const next: Walks = { ...walks, walks: { ...walks.walks } };
  // The door leaves every other area (the store may have moved from the hallway to outside).
  for (const a of b.areas) {
    const w = a.walk ? next.walks[a.walk] : undefined;
    if (a.walk && w && a.walk !== area.walk && w.doors.some((d) => d.id === id)) next.walks[a.walk] = { ...w, doors: w.doors.filter((d) => d.id !== id) };
  }
  const here = next.walks[area.walk] ?? { doors: [] };
  const others = here.doors.filter((d) => d.id !== id);
  // ⚠️ SHOPPERS SEE A NEW STORE ONLY AFTER «PUBLISH»: until then its spot is kept and no door is up.
  const doors = s.live && s.out.walk ? [...others, doorOf(spot, { slug: s.slug, name: s.name, walk: s.out.walk, image, website: s.website })] : others;
  next.walks[area.walk] = { ...here, doors };
  await writeWalks(next, walks);
  return s.live ? `The door is up on «${area.name.en}», in spot «${spot.id}».` : `Spot «${spot.id}» on «${area.name.en}» is kept for this store; its door goes up on «Publish».`;
}

// ── Checker ─────────────────────────────────────────────────────────────────

async function stepCheck(s0: StoreRecord): Promise<string> {
  const s = (await readStore(s0.slug)) ?? s0;
  const problems: string[] = [];
  const walk = s.out.walk ?? null;
  const web = walk ? await webObjectExists(walk) : false;
  const phone = walk ? await webObjectExists(phoneKeyOf(walk)) : false;
  if (!web) problems.push("The walk's web copy is missing.");
  if (!phone) problems.push("The walk's phone copy is missing: phones could not walk it.");
  const c = await readCatalogue(sceneOf(s.slug));
  const products = c?.products.length ?? 0;
  if (!products) problems.push("The product list is empty.");
  const noPrice = (c?.products ?? []).filter((p) => p.priceCents === null).map((p) => p.n);
  if (noPrice.length) problems.push(`No price on #${noPrice.slice(0, 15).join(", #")}${noPrice.length > 15 ? "…" : ""} (shown as «Price in store»).`);
  if (!s.files.door) problems.push("No door photo: the hallway shows the store's name on a card instead of its real door.");
  if (s.out.notFound?.length) problems.push(`${s.out.notFound.length} products were not found in the video; tag them on the walk («Products»), or film them.`);
  await updateStore(s.slug, (x) => ({
    ...x,
    report: {
      at: new Date().toISOString(), products, photosMatched: s.out.matched ?? 0, photosUnmatched: s.out.unmatched ?? [],
      tagged: s.out.tagged ?? 0, notFound: s.out.notFound ?? [], walk, phone, problems,
    },
  }));
  if (!web || !products) throw new NeedsYou(problems.join(" "));
  return `Checked: ${products} products, ${s.out.tagged ?? 0} tags, AI spent $${(s.spentCents / 100).toFixed(2)}.${problems.length ? ` ${problems.length} things to look at.` : ""}`;
}

/** «Publish»: shoppers may now see the store; its door goes up. */
export async function publish(slug: string): Promise<StoreRecord | null> {
  const s = await updateStore(slug, (x) => (allDone(x) || x.out.walk ? redo({ ...x, live: true }, ["place"]) : null));
  kick();
  return s;
}
