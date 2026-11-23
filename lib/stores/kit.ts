// A SHELF'S KIT — the job (owner, 2026-11-15, the pastry redesign; the rules and the file names are in `kitRules.ts`).
//
//   input   the operator's uploads for each shelf bordered on the walk: its quality photo (Type III), its sections
//           (Type IV) and each section's products (their own photos), private in the masters bucket;
//   1       Publish   each photo copied to the public bucket BYTE FOR BYTE (owner: "the quality need to be preserved
//                     through process all the way to shoppers display and purchase": never re-encoded, no look on
//                     it), plus a small copy for the tray and the lists (`scripts/stitch/thumb.py`);
//   2       Place     each section found in its shelf's photo (`scripts/stitch/section.py`: SIFT + MAGSAC, free);
//                     the operator draws one by hand on the store's page only if that fails;
//   3       Match     each product photo matched to the store's website product it is (Type V, the Website
//                     Explorer's): Haiku narrows the names (`namesFor`), then compares the photos (`sameProduct`,
//                     ≥ MATCH_SURE). Matched: the site's name, price and photo. Not matched: one photo, no price yet.
//                     A fraction of a cent a product, from the store's AI budget. The operator can change any match.
//   output  `stores/<slug>/kit.json` (masters); shoppers read it through `/api/kit/<slug>` (`shopKit`).
// Started by every kit upload and by «Run again» on the store's page. One run at a time, a store queued while busy.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile, presignGet, r2Config, readCatalogue, readMastersText, readWalks, uploadMastersFile, writeMastersJson } from "@/lib/splats/r2";
import type { Product } from "@/lib/splats/catalogue";
import { readStore, updateStore } from "./bucket";
import { BUDGET_CENTS, hasShortAddress, sceneOf, type StoreRecord } from "./store";
import { walkLink } from "./productLink";
import { namesFor, OverBudget, sameProduct, type Purse } from "./ai";
import { jpegOf, run } from "./media";
import { MATCH_SURE } from "./websiteMatchRules";
import { photosOf as productPhotos } from "./googlePhotosRules";
import { emptyKit, placeSig, shotKey, splitPick, toMatch, toPlace, type Kit, type KitPhoto, type KitProduct, type ShopKit, type ShopProduct } from "./kitRules";

export const kitKey = (slug: string) => `stores/${slug}/kit.json`;
/** Where the photos shoppers see are kept: PRIVATE (masters bucket), each `<folder>/photo.<ext>` and `thumb.jpg`. */
const shownPrefix = (slug: string) => `stores/${slug}/kit-shown/`;

/**
 * A KIT PHOTO SHOWN THROUGH A LINK THAT EXPIRES (owner, 2026-11-15: "we also need to make the photos (Type III,
 * Type IV & Type V) not downloadable"), as the walk videos are (`/api/media`): a link copied out of the page stops
 * working within hours. The same link is handed out for an hour, so the browser's cache still works.
 */
const LINK_SECONDS = 6 * 60 * 60, REUSE_MS = 60 * 60 * 1000;
const signed = new Map<string, { url: string; until: number }>();
export async function signKit(key: string | undefined): Promise<string> {
  if (!key) return "";
  if (/^https?:/.test(key)) return key;
  const now = Date.now(), had = signed.get(key);
  if (had && had.until > now) return had.url;
  const url = await presignGet(key, "master", LINK_SECONDS);
  signed.set(key, { url, until: now + REUSE_MS });
  if (signed.size > 5000) for (const [k, v] of signed) if (v.until <= now) signed.delete(k);
  return url;
}
/** Every kit photo of `k` with its addresses signed (for a screen; never stored). */
export async function signedKit<K extends Kit>(k: K): Promise<K> {
  const sign = async (p: KitPhoto): Promise<KitPhoto> => ({ ...p, ...(p.url ? { url: await signKit(p.url) } : {}), ...(p.thumb ? { thumb: await signKit(p.thumb) } : {}) });
  return {
    ...k,
    shelves: await Promise.all(k.shelves.map(async (s) => ({
      ...s, ...(s.photo ? { photo: await sign(s.photo) } : {}),
      sections: await Promise.all(s.sections.map(async (x) => ({ ...x, photo: await sign(x.photo), products: await Promise.all(x.products.map(async (p) => ({ ...p, photo: await sign(p.photo) }))) }))),
    }))),
  };
}
const THUMB_PX = 720;
const TYPE: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function readKit(slug: string): Promise<Kit | null> {
  try { const t = await readMastersText(kitKey(slug)); return t ? (JSON.parse(t) as Kit) : null; } catch { return null; }
}
/** Read, change, write: the change is applied to what is stored NOW (a run and an upload may overlap). */
export async function updateKit(slug: string, change: (k: Kit) => Kit): Promise<Kit> {
  const now = (await readKit(slug)) ?? emptyKit(slug);
  const next = change(now);
  await writeMastersJson(kitKey(slug), next);
  return next;
}

// ── The run ──
const state: { busy: string | null; queue: Set<string>; note: Record<string, string> } = { busy: null, queue: new Set(), note: {} };
export const kitWorking = (slug: string) => state.busy === slug || state.queue.has(slug);
export const kitNote = (slug: string) => state.note[slug] ?? "";

/** Start (or queue) the store's kit run. Safe to call any number of times. */
export function startKit(slug: string): void {
  state.queue.add(slug);
  if (!state.busy && r2Config().configured) void drain();
}
async function drain() {
  while (state.queue.size) {
    const slug = [...state.queue][0];
    state.queue.delete(slug);
    state.busy = slug;
    try { state.note[slug] = await runKit(slug, (n) => { state.note[slug] = n; }); }
    catch (e) { console.error("[kit]", slug, e); state.note[slug] = `Stopped: ${(e as Error).message.slice(0, 200)}`; }
    state.busy = null;
  }
}

function purse(slug: string, spentAtStart: number): Purse {
  let spent = spentAtStart;
  return {
    spent: () => spent, limit: BUDGET_CENTS,
    add: async (cents) => { spent += cents; await updateStore(slug, (x) => ({ ...x, spentCents: Math.round((x.spentCents + cents) * 100) / 100 })); },
  };
}

/** Every photo in the kit, with where it is (to write its public copy back). */
const photosOf = (k: Kit): KitPhoto[] => k.shelves.flatMap((s) => [...(s.photo ? [s.photo] : []), ...s.sections.flatMap((x) => [x.photo, ...x.products.map((p) => p.photo)])]);
function withPhoto(k: Kit, key: string, extra: Partial<KitPhoto>): Kit {
  const f = (p: KitPhoto) => (p.key === key ? { ...p, ...extra } : p);
  return { ...k, shelves: k.shelves.map((s) => ({ ...s, ...(s.photo ? { photo: f(s.photo) } : {}), sections: s.sections.map((x) => ({ ...x, photo: f(x.photo), products: x.products.map((p) => ({ ...p, photo: f(p.photo) })) })) })) };
}

export async function runKit(slug: string, say: (note: string) => void = () => undefined): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kit-"));
  const local = new Map<string, string>(); // a photo's key → its file here
  const fetchLocal = async (p: KitPhoto) => {
    let f = local.get(p.key);
    if (!f) { f = join(dir, `${local.size}-${p.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60) || "photo.jpg"}`); await downloadToFile(p.key, f, "master"); local.set(p.key, f); }
    return f;
  };
  const parts: string[] = [];
  try {
    // 1 · Publish: the original as it is, and a small copy.
    let kit = (await readKit(slug)) ?? emptyKit(slug);
    // An https address is the old public copy (none was made before this changed, 2026-11-15): made private again.
    const todo = photosOf(kit).filter((p) => !p.url || /^https?:/.test(p.url));
    for (const [i, p] of todo.entries()) {
      say(`Putting the photos up for shoppers: ${i + 1} of ${todo.length}…`);
      try {
        const f = await fetchLocal(p);
        const ext = (p.name.split(".").pop() ?? "jpg").toLowerCase();
        const stamp = Date.now().toString(36);
        const folder = `${shownPrefix(slug)}${stamp}-${p.key.split("/").pop()!.replace(/\.[^.]+$/, "").slice(-60)}`;
        const thumbFile = `${f}.thumb.jpg`;
        const size = JSON.parse((await run("python3", [join(process.cwd(), "scripts/stitch/thumb.py"), f, thumbFile, String(THUMB_PX)])).toString()) as { w: number; h: number };
        // PRIVATE (owner, 2026-11-15: "make the photos … not downloadable"): the masters bucket, shown through links
        // signed for a few hours (`signKit`), never a permanent address.
        await uploadMastersFile(`${folder}/photo.${TYPE[ext] ? ext : "jpg"}`, f, TYPE[ext] ?? "image/jpeg");
        await uploadMastersFile(`${folder}/thumb.jpg`, thumbFile, "image/jpeg");
        kit = await updateKit(slug, (k) => withPhoto(k, p.key, { url: `${folder}/photo.${TYPE[ext] ? ext : "jpg"}`, thumb: `${folder}/thumb.jpg`, w: size.w, h: size.h }));
      } catch (e) { console.error("[kit] publish", slug, p.key, e); parts.push(`«${p.name}» could not be put up: ${(e as Error).message.slice(0, 120)}.`); }
    }
    if (todo.length) parts.push(`${todo.length} photo${todo.length > 1 ? "s" : ""} put up for shoppers, exactly as uploaded.`);

    // 2 · Place each section in its shelf's photo.
    const places = toPlace(kit);
    const shelves = [...new Set(places.map((x) => x.shelf.id))];
    let found = 0, missed = 0;
    for (const id of shelves) {
      const group = places.filter((x) => x.shelf.id === id);
      const shelf = group[0].shelf;
      say(`Finding the sections in ${shelf.n ? `shelf ${shelf.n}` : "the shelf"}'s photo…`);
      try {
        const shelfFile = await fetchLocal(shelf.photo!);
        const files = [] as string[];
        for (const x of group) files.push(await fetchLocal(x.section.photo));
        const out = join(dir, `places-${id}.json`);
        await run("python3", [join(process.cwd(), "scripts/stitch/section.py"), "--shelf", shelfFile, "--out", out, ...files]);
        const answers = JSON.parse(readFileSync(out, "utf8")) as Array<{ found: boolean; quad: number[] | null; note: string }>;
        kit = await updateKit(slug, (k) => ({
          ...k, shelves: k.shelves.map((s) => (s.id !== id ? s : {
            ...s, sections: s.sections.map((x) => {
              const j = group.findIndex((g) => g.section.id === x.id);
              if (j < 0 || x.place?.by === "hand") return x;
              const a = answers[j];
              return { ...x, place: { quad: a?.found ? a.quad : null, by: "auto" as const, note: a?.note ?? "not looked at", sig: placeSig(s, x) } };
            }),
          })),
        }));
        for (const a of answers) if (a.found) found++; else missed++;
      } catch (e) {
        console.error("[kit] place", slug, id, e);
        parts.push(/No module named/.test((e as Error).message) ? "The section finder is not installed on this server (python3 with OpenCV)." : `Sections not placed: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    if (found || missed) parts.push(`${found} section${found === 1 ? "" : "s"} found in the shelf's photo${missed ? `; ${missed} not found: draw ${missed > 1 ? "them" : "it"} by hand` : ""}.`);

    // 3 · Match each product photo to the website.
    const s = await readStore(slug);
    const c = await readCatalogue(sceneOf(slug)).catch(() => null);
    const site = (c?.products ?? []).filter((p) => p.web && (p.en || p.fa));
    const waiting = toMatch(kit);
    if (waiting.length && !site.length) parts.push(`${waiting.length} product photo${waiting.length > 1 ? "s wait" : " waits"} for the store's website products (run the Website Explorer, then «Run again»).`);
    else if (waiting.length && s) {
      const wallet = purse(slug, s.spentCents);
      const names = site.map((p) => [p.en, p.fa].filter(Boolean).join(" · ").slice(0, 120));
      const sitePhoto = new Map<string, Uint8Array | null>();
      const photoOf = async (p: Product) => {
        if (!p.photo) return null;
        if (sitePhoto.has(p.photo)) return sitePhoto.get(p.photo)!;
        let b: Uint8Array | null = null;
        try { const r = await fetch(p.photo, { signal: AbortSignal.timeout(20_000) }); if (r.ok) b = await jpegOf(new Uint8Array(await r.arrayBuffer()), 320); } catch { /* none */ }
        sitePhoto.set(p.photo, b);
        return b;
      };
      let matched = 0, none = 0;
      for (const [i, prod] of waiting.entries()) {
        say(`Matching the product photos to the website: ${i + 1} of ${waiting.length}…`);
        try {
          const small = join(dir, `m-${i}.jpg`);
          await run("python3", [join(process.cwd(), "scripts/stitch/thumb.py"), await fetchLocal(prod.photo), small, "640"]);
          const mine = new Uint8Array(readFileSync(small));
          // Many products on the site: Haiku narrows the names first; a short list goes straight to the photos.
          let pool = site.map((_, k) => k), looks = "";
          if (site.length > 10) { const r = await namesFor(wallet, mine, names); pool = r.picks.map((k) => k - 1); looks = r.looks; }
          let pick: { web: string | null; confidence: number; why: string } = { web: null, confidence: 0, why: "no website name could be it" };
          if (pool.length) {
            const cands = pool.slice(0, 10).map((k) => site[k]);
            const jpegs = await Promise.all(cands.map(photoOf));
            const r = await sameProduct(wallet, { jpeg: mine, looks }, cands.map((p, k) => ({ jpeg: jpegs[k], name: p.en || p.fa || "", price: p.priceCents === null ? "" : `$${(p.priceCents / 100).toFixed(2)}` })));
            const chosen = r.choice !== null && r.confidence >= MATCH_SURE ? cands[r.choice - 1] : null;
            pick = { web: chosen?.web ?? null, confidence: r.confidence, why: r.why };
          }
          if (pick.web) matched++; else none++;
          kit = await updateKit(slug, (k) => ({
            ...k, shelves: k.shelves.map((sh) => ({ ...sh, sections: sh.sections.map((x) => ({ ...x, products: x.products.map((p) => (p.id === prod.id && !p.match ? { ...p, match: { ...pick, by: "auto" as const, at: new Date().toISOString() } } : p)) })) })),
          }));
        } catch (e) {
          if (e instanceof OverBudget) { parts.push("Matching stopped: the store's AI budget is used up."); break; }
          console.error("[kit] match", slug, prod.id, e);
        }
      }
      parts.push(`${matched} of ${matched + none} product photo${matched + none === 1 ? "" : "s"} matched to the website${none ? `; ${none} not: choose them by hand, or they show with no price yet` : ""}.`);
    }
    return parts.join(" ") || "Everything is up to date.";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── What shoppers get ──
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faNum = (n: number) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** The store's kit as shoppers see it: public photos only, prices read from the store's list NOW. */
export async function shopKit(s: StoreRecord): Promise<ShopKit | null> {
  const stored = await readKit(s.slug);
  if (!stored) return null;
  const kit = await signedKit(stored);
  const [walks, c] = await Promise.all([s.out.walk ? readWalks().catch(() => null) : null, readCatalogue(sceneOf(s.slug)).catch(() => null)]);
  const walk = s.out.walk ? walks?.walks[s.out.walk] : undefined;
  const byWeb = new Map<string, Product>((c?.products ?? []).filter((p) => p.web).map((p) => [p.web!, p] as [string, Product]));
  const shelves = kit.shelves.flatMap((sh) => {
    const z = walk?.zooms?.find((x) => x.id === sh.id);
    const sections = sh.sections.filter((x) => x.photo.url).map((x) => ({
      id: x.id, i: x.i, ...(x.name ? { name: { en: x.name.en, fa: x.name.fa ?? x.name.en } } : {}), url: x.photo.url!, thumb: x.photo.thumb ?? x.photo.url!, w: x.photo.w ?? 0, h: x.photo.h ?? 0, quad: x.place?.quad ?? null,
      products: (() => {
        // Every product photo the operator uploaded is shown (owner, 2026-11-17: "Why later shelves do not show products in
        // the basket section I have uploaded all Type Vs": hiding the uploads not tied to a website product by hand, done the
        // same day on a misreading, emptied 13 of nuttime's 23 sections).
        const own = (w: string) => x.products.find((p) => p.photo.url && p.match?.web === w);
        // A picked website product counts as listed, whichever of its photos was picked.
        const listed = new Set((x.items ?? []).map((w) => splitPick(w).web));
        // `shot`: the website photo the operator picked (0 = the main one), shown first; the product's others follow.
        const card = (p: KitProduct | undefined, site: Product | undefined, id: string, shot = 0): ShopProduct => {
          const all = site ? productPhotos(site) : [];
          const sitePhotos = shot && all[shot] ? [all[shot], ...all.filter((_, i) => i !== shot)] : all;
          // The operator's own photo from their computer (owner, 2026-11-16) comes first; the website's follow.
          const first = p?.photo.url ?? sitePhotos[0] ?? "";
          return {
            id, photo: first, thumb: p ? p.photo.thumb ?? p.photo.url! : first, more: (p ? sitePhotos : sitePhotos.slice(1)).slice(0, 8),
            en: site?.en ?? "", fa: site?.fa ?? "", priceCents: site?.priceCents ?? null, unit: site?.unit ?? "piece", ...(site?.note ? { note: site.note.slice(0, 300) } : {}),
          };
        };
        return [
          // The website products the operator assigned to the section, in the order chosen (owner, 2026-11-16), each
          // with the operator's own photo of it when one was uploaded.
          ...(x.items ?? []).flatMap((pick): ShopProduct[] => {
            const { web, shot } = splitPick(pick);
            const site = byWeb.get(web);
            if (!site) return [];
            const p = shot ? undefined : own(web);
            return [card(p, site, p ? p.id : `${x.id}-w${site.n}${shot ? `-p${shot}` : ""}`, shot)];
          }),
          // Then the product photos uploaded from the operator's computer that are not one of those.
          ...x.products.filter((p) => p.photo.url && !(p.match?.web && listed.has(p.match.web)))
            .map((p) => card(p, p.match?.web ? byWeb.get(p.match.web) : undefined, p.id)),
        ];
      })(),
    }));
    if (!sections.length && !sh.photo?.url) return [];
    const n = z?.n ?? sh.n;
    return [{
      id: sh.id, ...(n !== undefined ? { n } : {}),
      label: z ? { en: z.label.en, fa: z.label.fa ?? z.label.en } : { en: n ? `Shelf ${n}` : "Shelf", fa: n ? `قفسه ${faNum(n)}` : "قفسه" },
      photo: sh.photo?.url ? { url: sh.photo.url, thumb: sh.photo.thumb ?? sh.photo.url, w: sh.photo.w ?? 0, h: sh.photo.h ?? 0 } : null,
      sections, outline: z?.outline ?? [], ...(z?.trayAt !== undefined ? { trayAt: z.trayAt } : {}), ...(z?.trayEnd !== undefined ? { trayEnd: z.trayEnd } : {}),
    }];
  });
  // In walking order: when each shelf is first in view, then its number.
  shelves.sort((a, b) => (a.outline[0]?.t ?? 1e9) - (b.outline[0]?.t ?? 1e9) || (a.n ?? 1e9) - (b.n ?? 1e9));
  const { musicOf, radiosOf } = await import("@/lib/splats/walks");
  return {
    store: s.slug, walk: s.out.walk ?? null, link: s.out.walk ? walkLink(s.out.walk, undefined, s.slug) : null, title: walk?.title ? { en: walk.title.en, fa: walk.title.fa ?? walk.title.en } : null, merchant: s.name.en || s.name.fa || s.slug, shelves,
    site: s.website ?? null, name: { en: s.name.en || s.name.fa || s.slug, fa: s.name.fa || s.name.en || s.slug },
    logo: walk?.logo ?? null, sound: { keys: musicOf(walk), radio: walk?.radio ?? null, radios: radiosOf(walk) },
  };
}

/** What the store's page shows the operator: every shelf on the walk and its kit, the website products to choose from. */
export async function kitForPage(s: StoreRecord) {
  const [kit, walks, c] = await Promise.all([readKit(s.slug), s.out.walk ? readWalks().catch(() => null) : null, readCatalogue(sceneOf(s.slug)).catch(() => null)]);
  const zooms = (s.out.walk ? walks?.walks[s.out.walk]?.zooms : undefined) ?? [];
  const marked = zooms.filter((z) => z.outline?.length && !z.auto).sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9));
  const k = await signedKit(kit ?? emptyKit(s.slug));
  const site = (c?.products ?? []).filter((p) => p.web).map((p) => ({ web: p.web!, en: p.en ?? "", fa: p.fa ?? "", priceCents: p.priceCents, unit: p.unit, photo: p.photo ?? null }));
  // EVERY website photo, one pick each (owner, 2026-11-23: "let all website photos be available so operator … can add them
  // to any shelf"): the product's photos from the website and from Google, in the order the product keeps them.
  const sitePhotos = (c?.products ?? []).filter((p) => p.web).flatMap((p) => {
    const shots = productPhotos(p);
    return shots.map((url, i) => ({ web: shotKey(p.web!, i), en: p.en ?? "", fa: p.fa ?? "", priceCents: p.priceCents, unit: p.unit, photo: url, shot: i, shots: shots.length }));
  });
  const ids = [...new Set([...marked.map((z) => z.id), ...k.shelves.map((x) => x.id)])];
  // Why there are none yet, said plainly: the explorer may have read the site and not finished putting it on the list.
  let siteNote = "";
  if (!site.length) {
    const { readWebsite } = await import("./website");
    const run = await readWebsite(s.slug).catch(() => null);
    siteNote = !run ? "No website products yet: run the Website Explorer on the store's page first."
      : run.running ? `The Website Explorer has read ${run.products.length} products and is still putting them on the store's list (${run.note}). They appear here when it finishes.`
      : run.products.length ? `The Website Explorer read ${run.products.length} products but they are not on the store's list: open the Website Explorer and press «Put on the store's page».`
      : `The Website Explorer found no products on the site (${run.note}).`;
  }
  // The walk's video for marking when the tray takes each shelf (its phone copy, lighter; a signed link, as players get).
  let walkVideo: string | null = null;
  const walkFlat = Boolean(s.out.walk && walks?.walks[s.out.walk]?.projection === "flat");
  if (s.out.walk) {
    const { phoneKeyOf } = await import("@/lib/splats/walks");
    const { webObjectExists } = await import("@/lib/splats/r2");
    const { mediaPath } = await import("@/lib/splats/media");
    const phone = phoneKeyOf(s.out.walk);
    walkVideo = mediaPath((await webObjectExists(phone).catch(() => false)) ? phone : s.out.walk);
  }
  return {
    working: kitWorking(s.slug), note: kitNote(s.slug), site, sitePhotos, siteNote, walkVideo, walkFlat,
    shelves: ids.map((id) => {
      const z = zooms.find((x) => x.id === id);
      const sh = k.shelves.find((x) => x.id === id);
      const o = z?.outline ?? [];
      return { id, name: z?.name ? { en: z.name.en, fa: z.name.fa ?? "" } : null, trayAt: z?.trayAt ?? null, trayEnd: z?.trayEnd ?? null, border: o.length ? [o[0].t, o[o.length - 1].t] : null, n: z?.n ?? sh?.n ?? null, label: z ? { en: z.label.en, fa: z.label.fa ?? z.label.en } : { en: sh?.n ? `Shelf ${sh.n}` : "Shelf", fa: sh?.n ? `قفسه ${faNum(sh.n)}` : "قفسه" }, onWalk: Boolean(z?.outline?.length), photo: sh?.photo ?? null, sections: sh?.sections ?? [] };
    }),
  };
}


/** At server start: a store whose kit has photos not yet put up, sections not yet placed or products not yet matched
 *  (a run a restart cut off) is run again. */
export async function resumeKits(): Promise<void> {
  const { readIndex } = await import("./bucket");
  for (const e of await readIndex()) {
    const k = await readKit(e.slug).catch(() => null);
    if (!k) continue;
    if (photosOf(k).some((p) => !p.url || /^https?:/.test(p.url)) || toPlace(k).length || toMatch(k).length) startKit(e.slug);
  }
}
