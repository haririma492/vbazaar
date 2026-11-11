/**
 * /api/stores/<slug> — one store's page (`/stores/<slug>`): its owner (the
 * store's cookie, `login`) or the operator (x-admin-token). `lib/stores/`.
 *
 *   GET                                         → { who, store, status, products, walkUrl }
 *   POST { action: "edit", edits }              (the store's details)
 *   POST { action: "upload", kind, name, … }    an upload in parts (`lib/stores/http.ts`):
 *        start { kind, name, size } → { key, uploadId, partSize, partCount }; then sign / parts /
 *        complete / abort with that key. Complete records it and the crew starts on it.
 *        kind: video (operator only) · sheet · photo · door · logo
 *   POST { action: "music", type, size }        → { key, url, headers } (PUT the .mp3/.m4a there)
 *   POST { action: "musicDone", key, slot }     (music 1–3: slot 0–2; played in order, then from 1)
 *   POST { action: "musicClear", slot }         (that track taken out)
 *   POST { action: "musicRadio", channel }      (tune in to Nikoo.tv channel 4; null = the uploaded tracks)
 *   POST { action: "message", text }            (to the crew; answered on the page)
 *   POST { action: "password", password }       (a new password for the store)
 *   POST { action: "publish" | "unpublish" }    (operator: shoppers see the store, or not)
 *   POST { action: "redo", step }               (operator: run a step again)
 *   POST { action: "product", n, unit?, price?, sku?, note?, en?, fa? }  a product's details, from the store's page
 *   POST { action: "productDrop", n }           not a product: off the list and off the walk
 *   POST { action: "productSame", n, into }     the same product as #into: its tags move there, #n goes
 *   POST { action: "widget" }                   the store's widget: { snippet, stats, plan, forOwner } (operator; the owner when switched on)
 *   POST { action: "instagram" }              (the Reel, the walk link, one link per lit product)
 *   POST { action: "reelMake" }               (the vertical Instagram Reel made again, in the background)
 *   POST { action: "widgetRemake" }            (operator: the Free Tour preview made again now; returns how it was aimed)
 *   POST { action: "widgetOwner", on }          (operator: the owner sees the widget card, or not)
 *   POST { action: "tidy" }                     the Tidy agent (operator; spends from the store's budget, at most $2): clutter hidden behind products
 *   POST { action: "tidyState" }                → { run, covers, ceiling }: the run, and every object hidden (its photo, what stands there)
 *   POST { action: "tidyDrop", id }             «Bring it back» (operator): that cover off, and the spot left alone by later runs; id "all": every cover off
 *   POST { action: "tidyProduct", id, n }       product #n stands in that cover's place instead (operator)
 *   PUT ?key&uploadId&partNumber                (a part through this server, when the browser may not PUT to R2)
 */
import { mediaPath } from "@/lib/splats/media";
import { NextRequest } from "next/server";
import { MAX_WALK_AUDIO_BYTES, isWalkAudioKey, isWalkAudioType, walkAudioKey } from "@/lib/splats/keys";
import { presignDownload, presignGet, r2Config, readCatalogue, readMastersText, readWalks, signImageHeaders, signImagePutUrl, writeCatalogue, writeWalks } from "@/lib/splats/r2";
import { UNITS, formatCents, readPrice, type Unit } from "@/lib/splats/catalogue";
import { MAX_TRACKS, musicOf, setRadio, setTrack } from "@/lib/splats/walks";
import { soundOnly } from "@/lib/stores/music";
import {
  EDITABLE, MIN_PASSWORD, SLUG_RE, STEPS, addToThread, addUpload, applyEdits, checkUploadName, forPage, isUploadKeyOf, redo, sceneOf, statusOf, uploadKey,
  type StepName, type UploadKind,
  hasShortAddress,
} from "@/lib/stores/store";
import { readStore, renameInIndex, updateStore } from "@/lib/stores/bucket";
import { hashPassword, whoIs } from "@/lib/stores/auth";
import { fail, ok, relayPart, uploadTurn, type UploadAsk } from "@/lib/stores/http";
import { kick, prepareDoorPhoto, prepareLogo, publish, queuePhotos, storePhotosState } from "@/lib/stores/crew";
import { planStoreRoute, readRoute } from "@/lib/stores/routeJob";
import { buildTour, readTour } from "@/lib/stores/tourJob";
import { buildShelfFilm } from "@/lib/stores/shelfFilm";
import { findShelves } from "@/lib/stores/shelfFinder";
import { buildShelves, readShelves } from "@/lib/stores/levelsJob";
import { buildStoreMap, readStoreMap } from "@/lib/stores/mapJob";
import { readJob } from "@/lib/stores/jobState";
import { cutJob, cutParts, startCutJob } from "@/lib/splats/cut-job";
import { nameFromTitles, readTitleList, readTitles } from "@/lib/stores/titles";
import { readShelfPhotos, readShelfTitles } from "@/lib/stores/shelfTitles";
import { readRefresh, startRefreshAll } from "@/lib/stores/refreshAll";
import { recordOwner } from "@/lib/stores/ownerVisits";
import { readStats, widgetPlan } from "@/lib/stores/widget";
import { readPreview, remakePreview } from "@/lib/stores/widgetPreview";
import { readReel, startReel } from "@/lib/stores/reel";
import { productLink, storeWalkPath, walkLink } from "@/lib/stores/productLink";
import { ownerSeesWidget, snippet } from "@/lib/stores/widgetRules";
import { demoClear, demoCount, demoFill } from "@/lib/stores/demoFill";
import { coverProduct, dropCover, startTidy, tidyForPage } from "@/lib/stores/tidy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: UploadKind[] = ["video", "sheet", "photo", "door", "logo", "raw", "shelf"];

async function open(req: NextRequest, slug: string) {
  if (!SLUG_RE.test(slug)) return { error: fail(404, "No such store.") };
  if (!r2Config().configured) return { error: fail(503, "R2 is not configured on this host.") };
  const who = whoIs(req, slug);
  if (!who) return { error: fail(401, "Sign in with the store's password. · با رمز فروشگاه وارد شوید.") };
  const s = await readStore(slug);
  if (!s) return { error: fail(404, "No such store.") };
  return { who, s };
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const o = await open(req, params.slug);
  if ("error" in o) return o.error;
  kick();
  // The owner opening (or keeping open) their page: counted once a sitting (`lib/stores/ownerVisits.ts`). Never the operator.
  if (o.who === "owner") recordOwner(o.s.slug, "visit");
  const c = await readCatalogue(sceneOf(o.s.slug)).catch(() => null);
  const walk = o.s.out.walk ? (await readWalks().catch(() => null))?.walks[o.s.out.walk] : undefined;
  const base = r2Config().publicBase;
  return ok({
    music: musicOf(walk).map((key) => ({ key, url: base ? `${base}/${key}` : null })),
    radio: walk?.radio ?? null,
    who: o.who,
    store: forPage(o.s),
    status: statusOf(o.s),
    products: c?.products ?? [],
    // A published store's walk has its short address; the editor always opens the video by its key.
    walkUrl: o.s.out.walk ? (hasShortAddress(o.s) ? storeWalkPath(o.s.slug) : `/vca/walk?v=${encodeURIComponent(o.s.out.walk)}`) : null,
    editUrl: o.s.out.walk ? `/vca/walk?v=${encodeURIComponent(o.s.out.walk)}&edit=1` : null,
  });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const o = await open(req, params.slug);
  if ("error" in o) return o.error;
  const { who, s } = o;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> & UploadAsk;
  const now = new Date();

  if (body.action === "edit") {
    const edits = (body.edits ?? {}) as Record<string, string>;
    let problems: string[] = [];
    const next = await updateStore(s.slug, (x) => {
      const r = applyEdits(x, Object.fromEntries(EDITABLE.filter((f) => typeof edits[f] === "string").map((f) => [f, edits[f]])));
      problems = r.problems;
      return problems.length ? null : r.store;
    });
    if (problems.length) return fail(400, problems.join(" · "));
    if (next) await renameInIndex(next.slug, next.name);
    if (next?.live) await updateStore(s.slug, (x) => redo(x, ["place"]));
    kick();
    return ok({ store: next ? forPage(next) : null });
  }

  if (body.action === "widget") {
    if (who !== "operator" && !ownerSeesWidget(s)) return fail(403, "The operator only.");
    const [stats, plan, preview] = await Promise.all([readStats(s.slug), widgetPlan(s.slug), readPreview(s.slug)]);
    return ok({ snippet: snippet(s.slug), stats, plan, forOwner: ownerSeesWidget(s), preview: who === "operator" ? preview : undefined });
  }
  // INSTAGRAM (owner, 2026-11-06: the Instagram pathway): the store's vertical Reel, the walk's link for the bio, and
  // one link per lit product (opens the walk facing it, its card open). The owner's too: it is their marketing.
  if (body.action === "instagram") {
    if (!s.out.walk) return ok({ reel: null, walkLink: null, products: [] });
    const [reel, walks, c] = await Promise.all([readReel(s.slug), readWalks().catch(() => null), readCatalogue(sceneOf(s.slug)).catch(() => null)]);
    const lit = new Set((walks?.walks[s.out.walk]?.items ?? []).filter((it) => it.n && it.pins.length).map((it) => it.n as number));
    const products = (c?.products ?? []).filter((p) => lit.has(p.n)).map((p) => ({
      n: p.n, name: p.en || p.fa || `#${p.n}`, fa: p.fa ?? null, photo: p.photo ?? null, link: productLink(s.out.walk!, p.n, undefined, hasShortAddress(s) ? s.slug : undefined),
    }));
    const download = reel?.key ? await presignDownload(reel.key, `${s.slug}-reel.mp4`).catch(() => null) : null;
    return ok({ reel: reel ? { ...reel, download } : null, walkLink: walkLink(s.out.walk, undefined, hasShortAddress(s) ? s.slug : undefined), products });
  }
  if (body.action === "reelMake") {
    if (!s.out.walk) return fail(409, "The store's walk is not made yet.");
    if (!startReel(s.slug, s.out.walk)) return fail(409, "Another store's Reel is being made right now; try again in a minute.");
    return ok({ started: true });
  }
  if (body.action === "widgetRemake") {
    if (who !== "operator") return fail(403, "The operator only.");
    return ok({ preview: await remakePreview(s.slug, s.out.walk ?? null) });
  }
  // «Show on the tours page» (owner, 2026-11-10): the store on vbazaar.app/tours with its short address, published or not.
  if (body.action === "toursShow") {
    if (who !== "operator") return fail(403, "The operator only.");
    if (body.on === true && !s.out.walk) return fail(400, "This store has no walk yet.");
    const next = await updateStore(s.slug, (x) => ({ ...x, onTours: body.on === true }));
    return ok({ onTours: next?.onTours === true, store: next ? forPage(next) : null });
  }
  if (body.action === "widgetOwner") {
    if (who !== "operator") return fail(403, "The operator only.");
    const next = await updateStore(s.slug, (x) => ({ ...x, widgetForOwner: body.on === true }));
    return ok({ forOwner: next ? ownerSeesWidget(next) : false });
  }

  if (body.action === "upload") {
    const kind = body.kind as UploadKind;
    if (!KINDS.includes(kind)) return fail(400, "Unknown upload kind.");
    if (kind === "raw" && who !== "operator") return fail(403, "The operator only.");
    if (kind === "video" && who !== "operator") return fail(403, "Only the bazaar's operator uploads the store's video. · ویدیو را اپراتور بارگذاری می‌کند.");
    const name = String(body.name ?? "");
    let key = String(body.key ?? "");
    if (body.ask === "start" || !key) {
      const refused = checkUploadName(kind, name);
      if (refused) return fail(400, refused);
      key = uploadKey(s.slug, kind, name, now);
    } else if (!isUploadKeyOf(s.slug, key)) return fail(400, "Not this store's upload.");
    const turn = await uploadTurn(key, { ...body, action: String(body.ask ?? "") });
    if (turn) return turn;
    // Completed: recorded, and the crew starts on what it touches.
    let next = await updateStore(s.slug, (x) => addUpload(x, kind, { key, name: name.slice(0, 120), size: Number(body.size) || 0, at: now.toISOString() }));
    // The logo goes straight onto the store's walk (both tours show it at the top left).
    if (kind === "logo" && next) { await prepareLogo(next).catch((e) => console.error("[logo]", s.slug, e)); next = (await readStore(s.slug)) ?? next; }
    kick();
    return ok({ store: next ? forPage(next) : null });
  }

  if (body.action === "music") {
    const type = String(body.type ?? "");
    if (!isWalkAudioType(type)) return fail(400, "Music is an .mp3 or .m4a file.");
    if (!(Number(body.size) > 0 && Number(body.size) <= MAX_WALK_AUDIO_BYTES)) return fail(400, "That file is empty or bigger than 40 MB.");
    if (!s.out.walk) return fail(409, "The walk is not made yet: music can be added once the video is ready.");
    const key = walkAudioKey(sceneOf(s.slug), type, now);
    if (!key) return fail(400, "Music is an .mp3 or .m4a file.");
    return ok({ key, url: await signImagePutUrl(key, type), headers: signImageHeaders(type) });
  }
  if (body.action === "musicDone") {
    const key = String(body.key ?? "");
    if (!isWalkAudioKey(key) || !key.startsWith(`scenes/${sceneOf(s.slug)}/audio/`) || !s.out.walk) return fail(400, "Not this store's music.");
    const slot = body.slot === undefined ? 0 : Number(body.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_TRACKS) return fail(400, `Music 1 to ${MAX_TRACKS}.`);
    // Sound only (embedded cover pictures left out: they crashed Chrome and Edge, 2026-11-06).
    const clean = await soundOnly(key, sceneOf(s.slug)).catch((e) => { console.error("[music]", key, e); return key; });
    const walks = await readWalks();
    const base = walks.walks[s.out.walk] ? walks : { ...walks, walks: { ...walks.walks, [s.out.walk]: { doors: [] } } };
    await writeWalks(setTrack(base, s.out.walk, slot, clean), walks);
    return ok();
  }
  if (body.action === "musicClean") {
    // Operator: every track of the walk rewritten with its sound only (free).
    if (who !== "operator") return fail(403, "The operator only.");
    if (!s.out.walk) return fail(409, "No walk.");
    const walks = await readWalks();
    const tracks = musicOf(walks.walks[s.out.walk]);
    const clean = [] as string[];
    for (const k of tracks) clean.push(await soundOnly(k, sceneOf(s.slug)));
    let w2 = walks;
    clean.forEach((k, i) => { w2 = setTrack(w2, s.out.walk!, i, k); });
    await writeWalks(w2, walks);
    return ok({ before: tracks, after: clean });
  }
  if (body.action === "musicRadio") {
    const ch = body.channel === null ? null : body.channel === 4 ? 4 : undefined;
    if (!s.out.walk || ch === undefined) return fail(400, "Nikoo.tv channel 4, or null for the store's own tracks.");
    const walks = await readWalks();
    await writeWalks(setRadio(walks, s.out.walk, ch), walks);
    return ok();
  }
  if (body.action === "musicClear") {
    const slot = Number(body.slot);
    if (!s.out.walk || !Number.isInteger(slot) || slot < 0 || slot >= MAX_TRACKS) return fail(400, `Music 1 to ${MAX_TRACKS}.`);
    const walks = await readWalks();
    if (walks.walks[s.out.walk]) await writeWalks(setTrack(walks, s.out.walk, slot, null), walks);
    return ok();
  }

  // ── The products, as the owner fills them in (owner, 2026-11-01: unit, price, item #, description) ──
  if (body.action === "product" || body.action === "productDrop" || body.action === "productSame") {
    const c = await readCatalogue(sceneOf(s.slug));
    const n = Number(body.n);
    const p = c?.products.find((x) => x.n === n);
    if (!c || !p) return fail(404, "No such product.");
    if (body.action === "product") {
      const next = { ...p };
      if (body.unit !== undefined) {
        if (!UNITS.includes(body.unit as Unit)) return fail(400, "Sold by: piece, set, pack, box, kg, g or lb.");
        next.unit = body.unit as Unit;
      }
      if (body.price !== undefined) {
        if (body.price === null || String(body.price).trim() === "") next.priceCents = null;
        else {
          const cents = readPrice(body.price);
          if (cents === null) return fail(400, `«${String(body.price)}» is not a price (e.g. 12.99).`);
          next.priceCents = cents;
        }
      }
      for (const f of ["sku", "note", "en", "fa"] as const) {
        if (body[f] === undefined) continue;
        const v = String(body[f] ?? "").trim().slice(0, f === "note" ? 600 : f === "sku" ? 40 : 120);
        if (v) next[f] = v;
        else delete next[f];
      }
      if (!next.en && !next.fa && next.by !== "video") return fail(400, "A product needs a name.");
      // What its owner (or the operator) saved by hand is no longer a demo name and price.
      delete next.demo;
      // A product found in the video keeps what the crew saw, to find it again in a new video (never shown).
      if (next.by === "video" && !next.seen && (p.en || p.fa)) next.seen = p.en || p.fa;
      const saved = await writeCatalogue({ ...c, products: c.products.map((x) => (x.n === n ? next : x)) });
      await updateStore(s.slug, (x) => redo(x, ["check"]));
      kick();
      return ok({ product: saved.products.find((x) => x.n === n) ?? next });
    }
    const into = Number(body.into);
    if (body.action === "productSame" && (!c.products.some((x) => x.n === into) || into === n)) return fail(400, "Choose the product it is the same as.");
    await writeCatalogue({ ...c, products: c.products.filter((x) => x.n !== n) });
    if (s.out.walk) {
      const walks = await readWalks();
      const w = walks.walks[s.out.walk];
      if (w?.items?.some((it) => it.n === n)) {
        const items = body.action === "productDrop"
          ? w.items.filter((it) => it.n !== n)
          : w.items.map((it) => (it.n === n ? { ...it, n: into, id: `${it.id}-as-${into}` } : it));
        await writeWalks({ ...walks, walks: { ...walks.walks, [s.out.walk]: { ...w, items } } }, walks);
      }
    }
    await updateStore(s.slug, (x) => redo(x, ["check"]));
    kick();
    return ok();
  }

  if (body.action === "message") {
    const text = String(body.text ?? "").trim();
    if (!text) return fail(400, "Write the message first.");
    const next = await updateStore(s.slug, (x) => addToThread(x, { at: now.toISOString(), from: who, text, open: true }));
    kick();
    return ok({ store: next ? forPage(next) : null });
  }

  if (body.action === "password") {
    const password = String(body.password ?? "").trim();
    if (password.length < MIN_PASSWORD) return fail(400, `At least ${MIN_PASSWORD} characters. · دست‌کم ${MIN_PASSWORD} حرف.`);
    await updateStore(s.slug, (x) => ({ ...x, passwordHash: hashPassword(password), updatedAt: now.toISOString() }));
    return ok();
  }

  if (who !== "operator") return fail(403, "Only the bazaar's operator can do that.");

  if (body.action === "publish") {
    if (!s.out.walk) return fail(409, "The store's walk is not made yet.");
    const next = await publish(s.slug);
    return ok({ store: next ? forPage(next) : null });
  }
  if (body.action === "unpublish") {
    const next = await updateStore(s.slug, (x) => redo({ ...x, live: false }, ["place"]));
    kick();
    return ok({ store: next ? forPage(next) : null });
  }
  if (body.action === "redo") {
    const step = String(body.step ?? "") as StepName;
    if (!STEPS.includes(step)) return fail(400, "Unknown step.");
    // Tagging again a walk whose products were found in it: the Tagger runs this time (re-pins, re-cuts photos).
    const next = await updateStore(s.slug, (x) => {
      // The Lock agent touches only the walk's locks: nothing after it needs doing again.
      const r = redo(x, step === "lock" ? ["lock"] : STEPS.slice(STEPS.indexOf(step)));
      return step === "tag" ? { ...r, out: { ...r.out, found: undefined } } : r;
    });
    kick();
    return ok({ store: next ? forPage(next) : null });
  }
  if (body.action === "doorPhoto") {
    // Operator: the door photo made public and set as the walk's opening photo (free).
    if (who !== "operator") return fail(403, "The operator only.");
    return ok({ image: (await prepareDoorPhoto(s)) ?? null });
  }
  if (body.action === "titlesName") {
    // Operator: the unnamed products take their titles read in full (free; owners' names untouched).
    if (who !== "operator") return fail(403, "The operator only.");
    return ok({ named: await nameFromTitles(s.slug) });
  }
  // DEMO NAMES AND PRICES (owner, 2026-11-10; `lib/stores/demoFill.ts`): every lit product with neither a name nor a
  // price takes a made-up one that fits the store's kind. Without `apply` it only counts. Free; the operator's.
  if (body.action === "demoFill" || body.action === "demoClear") {
    if (who !== "operator") return fail(403, "The operator only.");
    const c = await readCatalogue(sceneOf(s.slug));
    if (!c) return ok({ filled: 0, skipped: 0, lit: 0, demo: 0, kind: "", say: "" });
    if (body.action === "demoClear") {
      const r = demoClear(c.products);
      if (r.cleared) { await writeCatalogue({ ...c, products: r.products }); await updateStore(s.slug, (x) => redo(x, ["check"])); kick(); }
      return ok({ cleared: r.cleared });
    }
    const items = s.out.walk ? (await readWalks().catch(() => null))?.walks[s.out.walk]?.items ?? [] : [];
    // Shown to shoppers: a light on the walk, or a place in the Shelf Tour.
    const lit = new Set<number>(items.filter((it) => it.n && it.pins.length).map((it) => it.n as number));
    for (const clip of (await readTour(s.slug).catch(() => null))?.clips ?? []) for (const n of clip.products) lit.add(n);
    const r = demoFill(c.products, lit, { slug: s.slug, category: s.category, nameEn: s.name.en, nameFa: s.name.fa });
    if (body.apply === true && r.filled) { await writeCatalogue({ ...c, products: r.products }); await updateStore(s.slug, (x) => redo(x, ["check"])); kick(); }
    const sample = r.products.filter((p, i) => p.demo && !c.products[i].demo).slice(0, 4).map((p) => `${p.en || p.fa} · ${formatCents(p.priceCents ?? 0)}`);
    return ok({ filled: r.filled, skipped: r.skipped, lit: lit.size, demo: demoCount(body.apply === true ? r.products : c.products), kind: r.kind, say: r.say, sample, applied: body.apply === true });
  }
  if (body.action === "refreshAll") {
    // Operator: every agent in order (`refreshAll.ts`), in the background. Spends a little, asked on the card.
    if (who !== "operator") return fail(403, "The operator only.");
    return ok({ note: startRefreshAll(s.slug) });
  }
  if (body.action === "refreshState") {
    return ok({ run: await readRefresh(s.slug) });
  }
  if (body.action === "shelfTitlesRead") {
    // Operator: read every spine in the shelf photos not read yet (spends from the store's budget). Background.
    if (who !== "operator") return fail(403, "The operator only.");
    void readShelfPhotos(s.slug).then((note) => console.log("[spines]", s.slug, note)).catch((e) => console.error("[spines]", s.slug, e));
    return ok({ started: true });
  }
  if (body.action === "titlesRead") {
    // Operator: the title reader on up to «limit» products not read yet (spends from the store's budget). Background.
    if (who !== "operator") return fail(403, "The operator only.");
    const limit = Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : undefined;
    void readTitles(s.slug, limit, { escalate: body.escalate === true }).then((note) => console.log("[titles]", s.slug, note)).catch((e) => console.error("[titles]", s.slug, e));
    return ok({ started: true, limit: limit ?? "all" });
  }
  if (body.action === "tourBuild") {
    // Operator: the Shelf tour builder (free: ffmpeg on the sightings already found). Background.
    if (who !== "operator") return fail(403, "The operator only.");
    // The film by shelf and level when the Shelf finder has looked at the shelves; else the camera's-path tour.
    void (async () => {
      const filmed = await buildShelfFilm(s.slug);
      console.log("[tour]", s.slug, filmed);
      if (/^No shelf pictures/.test(filmed)) console.log("[tour]", s.slug, await buildTour(s.slug));
    })().catch((e) => console.error("[tour]", s.slug, e));
    return ok({ started: true });
  }
  if (body.action === "shelfFind") {
    // Operator, on the owner's yes (it spends from the store's AI budget): the Shelf finder. Background.
    if (who !== "operator") return fail(403, "The operator only.");
    // «mode: "gaps"»: only where the walk saw products no shelf picture holds yet, at most «max» pictures (~$0.07 each).
    const mode = body.mode === "gaps" ? "gaps" : "tour";
    const max = Number(body.max) > 0 ? Math.min(80, Math.floor(Number(body.max))) : undefined;
    void findShelves(s.slug, { mode, max }).then((note) => console.log("[shelf-find]", s.slug, note)).catch((e) => console.error("[shelf-find]", s.slug, e));
    return ok({ started: true });
  }
  if (body.action === "shelfFindState") {
    const job = await readJob("shelfFind");
    return ok({ working: Boolean(job?.busy && job.key === s.out.walk && Date.now() - Date.parse(job.at) < 3 * 3600_000), note: job?.note ?? "" });
  }
  if (body.action === "tour") {
    const r = await readTour(s.slug);
    const job = await readJob("tour");
    const working = Boolean(job?.busy && job.key === s.out.walk && Date.now() - Date.parse(job.at) < 3 * 3600_000);
    return ok({
      tour: r ? { made: r.made, seconds: r.seconds, shelves: r.clips.length, products: r.items.length, video: r.video, walk: r.walk } : null,
      working, note: working ? job?.note ?? "" : "", page: `/vca/tour?s=${s.slug}`,
    });
  }
  if (body.action === "shelvesBuild") {
    // Operator: the Shelf Tour by shelf and level (free: ffmpeg on the Shelf finder's boxes). Background.
    if (who !== "operator") return fail(403, "The operator only.");
    void buildShelves(s.slug).then((note) => console.log("[shelves]", s.slug, note)).catch((e) => console.error("[shelves]", s.slug, e));
    return ok({ started: true });
  }
  if (body.action === "shelves") {
    const m = await readShelves(s.slug);
    const job = await readJob("shelves");
    const working = Boolean(job?.busy && job.key === s.slug && Date.now() - Date.parse(job.at) < 3 * 3600_000);
    return ok({
      shelves: m ? { made: m.made, shelves: m.shelves.length, levels: m.shelves.reduce((x, sh) => x + sh.levels.length, 0) } : null,
      working, note: working ? job?.note ?? "" : "", page: `/vca/tour?s=${s.slug}`,
    });
  }
  if (body.action === "mapBuild") {
    // Operator: the store map (free: the camera's motion, the sightings, our own code; no AI). Background.
    if (who !== "operator") return fail(403, "The operator only.");
    void buildStoreMap(s.slug).then((note) => console.log("[map]", s.slug, note)).catch((e) => console.error("[map]", s.slug, e));
    return ok({ started: true });
  }
  if (body.action === "map") {
    // The store map (owner or operator): shelves, products, the camera's path, the tour's order, what to review.
    const m = await readStoreMap(s.slug);
    const job = await readJob("map");
    const working = Boolean(job?.busy && job.key === s.slug && Date.now() - Date.parse(job.at) < 3 * 3600_000);
    return ok({ map: m, working, note: working ? job?.note ?? "" : "" });
  }
  if (body.action === "sightingsDump") {
    // Operator: the store's sightings as kept (read only), for checking the planners.
    if (who !== "operator") return fail(403, "The operator only.");
    const read = async (k: string) => { const t = await readMastersText(k).catch(() => null); return t ? JSON.parse(t) : null; };
    return ok({ shelf: await read(`stores/${s.slug}/shelf-sightings.json`), finder: await read(`stores/${s.slug}/sightings.json`) });
  }
  if (body.action === "rawLinks") {
    // Operator: the store's raw .insv upload(s), each with a private link good for 6 h (the agents' test of
    // the camera's gyro and picture, owner 2026-11-05). Reads only; nothing changes.
    if (who !== "operator") return fail(403, "The operator only.");
    const raw = s.files.raw ?? [];
    return ok({ raw: await Promise.all(raw.map(async (f) => ({ ...f, url: await presignGet(f.key, "master", 6 * 3600) }))) });
  }
  if (body.action === "titles") {
    // The titles read so far (owner or operator).
    // …and the titles read off the shelf photos (`shelfTitles.ts`), with how many photos are read.
    const shelf = await readShelfTitles(s.slug);
    const job = await readJob("shelfTitles");
    const reading = Boolean(job?.busy && job.key === s.slug && Date.now() - Date.parse(job.at) < 3 * 3600_000);
    return ok({
      titles: await readTitleList(s.slug),
      shelf: { rows: shelf?.rows ?? [], done: shelf?.done.length ?? 0, photos: (s.files.shelf ?? []).length, updated: shelf?.updated ?? null, reading, note: reading ? job?.note ?? "" : "" },
    });
  }
  if (body.action === "photosRecut") {
    // Operator: the product photos cut again, framed on each product (free, no AI). Runs in the background.
    if (who !== "operator") return fail(403, "The operator only.");
    await queuePhotos([s.slug]);
    return ok({ started: true });
  }
  if (body.action === "photos") {
    // The Photo improver on this store (owner or operator).
    return ok({ photos: await storePhotosState(s.slug) });
  }
  if (body.action === "routePlan") {
    // Operator: the Route optimizer plans this store's walk (free, nothing cut; the proposal and its preview are kept).
    if (who !== "operator") return fail(403, "The operator only.");
    void planStoreRoute(s.slug).then((note) => console.log("[route]", s.slug, note)).catch((e) => console.error("[route]", s.slug, e));
    return ok({ started: true });
  }
  if (body.action === "route") {
    const r = await readRoute(s.slug);
    const job = await readJob("route");
    const working = Boolean(job?.busy && job.key === s.out.walk && Date.now() - Date.parse(job.at) < 3 * 3600_000);
    // ⚠️ APPLIED (owner, 2026-11-05: "why after 20 hours still … says waiting for me"): once the walk is cut to
    // this proposal, nothing waits for the owner. Known by the walk's cut record matching the proposal's parts.
    let applied = false, cutting = false;
    if (r && r.walk === s.out.walk) {
      const done = await cutParts(r.walk).catch(() => []);
      applied = done.length === r.parts.length && done.every((p, i) => Math.abs(p.from - r.parts[i].from) < 0.05 && Math.abs(p.to - r.parts[i].to) < 0.05);
      const cj = cutJob(r.walk);
      cutting = Boolean(cj && cj.state !== "done" && cj.state !== "failed");
    }
    return ok({
      route: r && r.walk === s.out.walk ? { ...r, applied, cutting, previewUrl: r.preview ? mediaPath(r.preview) : null } : null,
      working, note: working ? job?.note ?? "" : "",
    });
  }
  if (body.action === "tidy") {
    // Operator, on the owner's yes (it spends from the store's AI budget, at most $2): the Tidy agent. Background.
    if (who !== "operator") return fail(403, "The operator only.");
    const why = await startTidy(s.slug);
    return why ? fail(409, why) : ok({ started: true });
  }
  if (body.action === "tidyState") {
    return ok(await tidyForPage(s.slug, s.out.walk));
  }
  if (body.action === "tidyDrop") {
    // The owner sees the Tidy agent's result; changing it is the operator's (owner, 2026-11-06).
    if (who !== "operator") return fail(403, "The operator only.");
    if (typeof body.id !== "string" || !body.id) return fail(400, "Which cover?");
    return ok({ note: await dropCover(s.slug, body.id) });
  }
  if (body.action === "tidyProduct") {
    if (who !== "operator") return fail(403, "The operator only.");
    const n = Number(body.n);
    if (typeof body.id !== "string" || !body.id || !Number.isInteger(n) || n < 1) return fail(400, "Which cover, and which product number?");
    return ok({ note: await coverProduct(s.slug, body.id, n) });
  }
  if (body.action === "routeApply") {
    // Operator, on the owner's yes: the proposal is cut (the walk editor's cut: lights and doors move, the original kept).
    if (who !== "operator") return fail(403, "The operator only.");
    const r = await readRoute(s.slug);
    if (!r || r.walk !== s.out.walk) return fail(409, "No route proposal for this walk: plan it first.");
    return ok({ job: startCutJob(r.walk, r.parts) });
  }
  return fail(400, "Unknown action.");
}

export async function PUT(req: NextRequest, { params }: { params: { slug: string } }) {
  const o = await open(req, params.slug);
  if ("error" in o) return o.error;
  const q = req.nextUrl.searchParams;
  const key = q.get("key") || "";
  if (!isUploadKeyOf(o.s.slug, key)) return fail(400, "Not this store's upload.");
  if ((key.includes("/uploads/video/") || key.includes("/uploads/raw/")) && o.who !== "operator") return fail(403, "Only the operator uploads the video.");
  const n = Number(q.get("partNumber"));
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, "Part number 1–10000.");
  try {
    return await relayPart(key, q.get("uploadId") || "", n, new Uint8Array(await req.arrayBuffer()));
  } catch (e) {
    return fail(500, `R2 refused the part: ${(e as Error).message}`);
  }
}
