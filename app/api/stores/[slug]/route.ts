/**
 * /api/stores/<slug> — one store's page (`/stores/<slug>`): its owner (the
 * store's cookie, `login`) or the operator (x-admin-token). `lib/stores/`.
 *
 *   GET                                         → { who, store, status, products, walkUrl }
 *   POST { action: "edit", edits }              (the store's details)
 *   POST { action: "upload", kind, name, … }    an upload in parts (`lib/stores/http.ts`):
 *        start { kind, name, size } → { key, uploadId, partSize, partCount }; then sign / parts /
 *        complete / abort with that key. Complete records it and the crew starts on it.
 *        kind: video (operator only) · sheet · photo · door
 *   POST { action: "music", type, size }        → { key, url, headers } (PUT the .mp3/.m4a there)
 *   POST { action: "musicDone", key }           (the walk plays it, looped)
 *   POST { action: "message", text }            (to the crew; answered on the page)
 *   POST { action: "password", password }       (a new password for the store)
 *   POST { action: "publish" | "unpublish" }    (operator: shoppers see the store, or not)
 *   POST { action: "redo", step }               (operator: run a step again)
 *   POST { action: "product", n, unit?, price?, sku?, note?, en?, fa? }  a product's details, from the store's page
 *   POST { action: "productDrop", n }           not a product: off the list and off the walk
 *   POST { action: "productSame", n, into }     the same product as #into: its tags move there, #n goes
 *   PUT ?key&uploadId&partNumber                (a part through this server, when the browser may not PUT to R2)
 */
import { NextRequest } from "next/server";
import { MAX_WALK_AUDIO_BYTES, isWalkAudioKey, isWalkAudioType, walkAudioKey } from "@/lib/splats/keys";
import { r2Config, readCatalogue, readWalks, signImageHeaders, signImagePutUrl, writeCatalogue, writeWalks } from "@/lib/splats/r2";
import { UNITS, readPrice, type Unit } from "@/lib/splats/catalogue";
import {
  EDITABLE, MIN_PASSWORD, SLUG_RE, STEPS, addToThread, addUpload, applyEdits, checkUploadName, forPage, isUploadKeyOf, redo, sceneOf, statusOf, uploadKey,
  type StepName, type UploadKind,
} from "@/lib/stores/store";
import { readStore, renameInIndex, updateStore } from "@/lib/stores/bucket";
import { hashPassword, whoIs } from "@/lib/stores/auth";
import { fail, ok, relayPart, uploadTurn, type UploadAsk } from "@/lib/stores/http";
import { kick, publish } from "@/lib/stores/crew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: UploadKind[] = ["video", "sheet", "photo", "door"];

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
  const c = await readCatalogue(sceneOf(o.s.slug)).catch(() => null);
  return ok({
    who: o.who,
    store: forPage(o.s),
    status: statusOf(o.s),
    products: c?.products ?? [],
    walkUrl: o.s.out.walk ? `/vca/walk?v=${encodeURIComponent(o.s.out.walk)}` : null,
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

  if (body.action === "upload") {
    const kind = body.kind as UploadKind;
    if (!KINDS.includes(kind)) return fail(400, "Unknown upload kind.");
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
    const next = await updateStore(s.slug, (x) => addUpload(x, kind, { key, name: name.slice(0, 120), size: Number(body.size) || 0, at: now.toISOString() }));
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
    const walks = await readWalks();
    const w = walks.walks[s.out.walk] ?? { doors: [] };
    await writeWalks({ ...walks, walks: { ...walks.walks, [s.out.walk]: { ...w, audio: key } } }, walks);
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
  return fail(400, "Unknown action.");
}

export async function PUT(req: NextRequest, { params }: { params: { slug: string } }) {
  const o = await open(req, params.slug);
  if ("error" in o) return o.error;
  const q = req.nextUrl.searchParams;
  const key = q.get("key") || "";
  if (!isUploadKeyOf(o.s.slug, key)) return fail(400, "Not this store's upload.");
  if (key.includes("/uploads/video/") && o.who !== "operator") return fail(403, "Only the operator uploads the video.");
  const n = Number(q.get("partNumber"));
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, "Part number 1–10000.");
  try {
    return await relayPart(key, q.get("uploadId") || "", n, new Uint8Array(await req.arrayBuffer()));
  } catch (e) {
    return fail(500, `R2 refused the part: ${(e as Error).message}`);
  }
}
