/**
 * /api/stores/areas — the bazaar's areas (outside, lobby, hallway…) and the
 * hallway's door spots, for `/stores/areas`. x-admin-token. `lib/stores/bazaar.ts`.
 *
 *   GET                                        → { bazaar, stores: [{ slug, name, live }], walks: { [areaId]: url } }
 *   POST { action: "put", id, en, fa }         an area added or renamed
 *   POST { action: "move", id, by: -1 | 1 }    walking order (the walks are joined again)
 *   POST { action: "hallway", id }             the area stores' doors go on
 *   POST { action: "upload", id, ask, … }      the area's 360° walk, in parts (`lib/stores/http.ts`)
 *   POST { action: "message", id, text }       to the crew, answered on the screen
 *   POST { action: "music", id, type, size } → { key, url, headers };  { action: "musicDone", id, key }
 *   POST { action: "spotAdd", t, yaw, pitch, size }  a free door spot on the hallway
 *   POST { action: "spotRemove", id }
 *   POST { action: "moveStore", store, to }    a store into another spot (swapping with the one there)
 *   PUT ?id&key&uploadId&partNumber            a part through this server
 */
import { NextRequest } from "next/server";
import { MAX_WALK_AUDIO_BYTES, isWalkAudioKey, isWalkAudioType, walkAudioKey } from "@/lib/splats/keys";
import { r2Config, readWalks, signImageHeaders, signImagePutUrl, writeWalks } from "@/lib/splats/r2";
import { AREA_RE, areaScene, moveArea, moveStore, putArea } from "@/lib/stores/bazaar";
import { checkUploadName, isUploadKeyOf, redo, uploadKey } from "@/lib/stores/store";
import { readBazaar, readIndex, updateBazaar, updateStore } from "@/lib/stores/bucket";
import { isOperator } from "@/lib/stores/auth";
import { fail, ok, relayPart, uploadTurn, type UploadAsk } from "@/lib/stores/http";
import { kick, writeJoins } from "@/lib/stores/crew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An area's uploads are kept like a store's, under `stores/area-<id>/uploads/`. */
const uploadSlug = (id: string) => areaScene(id);

function guard(req: NextRequest) {
  if (!isOperator(req)) return fail(401, "Unauthorized");
  if (!r2Config().configured) return fail(503, "R2 is not configured on this host.");
  return null;
}

export async function GET(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  kick();
  const bazaar = await readBazaar();
  const stores = (await readIndex()).map((e) => ({ slug: e.slug, name: e.name }));
  const walks = Object.fromEntries(bazaar.areas.filter((a) => a.walk).map((a) => [a.id, `/vca/walk?v=${encodeURIComponent(a.walk!)}`]));
  return ok({ bazaar, stores, walks });
}

/** Every placed store puts its door up again (the spots or the hallway changed). */
async function replaceDoors(slugs?: string[]) {
  for (const { slug } of await readIndex()) if (!slugs || slugs.includes(slug)) await updateStore(slug, (x) => redo(x, ["place"]));
  kick();
}

export async function POST(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> & UploadAsk;
  const id = String(body.id ?? "");
  const now = new Date();
  const area = id ? (await readBazaar()).areas.find((a) => a.id === id) : undefined;
  const needArea = () => (area ? null : fail(404, "No such area."));

  switch (body.action) {
    case "put": {
      if (!AREA_RE.test(id)) return fail(400, "An area's id is lowercase letters, digits and hyphens (outside, lobby, hallway-2).");
      const en = String(body.en ?? "").trim().slice(0, 80), fa = String(body.fa ?? "").trim().slice(0, 80);
      if (!en) return fail(400, "Give the area an English name.");
      return ok({ bazaar: await updateBazaar((b) => putArea(b, id, { en, fa })) });
    }
    case "move": {
      const b = await updateBazaar((x) => moveArea(x, id, Number(body.by) < 0 ? -1 : 1));
      await writeJoins(b);
      return ok({ bazaar: b });
    }
    case "hallway": {
      if (needArea()) return needArea()!;
      const b = await updateBazaar((x) => ({ ...x, hallway: id }));
      await replaceDoors();
      return ok({ bazaar: b });
    }
    case "upload": {
      if (needArea()) return needArea()!;
      const name = String(body.name ?? "");
      let key = String(body.key ?? "");
      if (body.ask === "start" || !key) {
        const no = checkUploadName("video", name);
        if (no) return fail(400, no);
        key = uploadKey(uploadSlug(id), "video", name, now);
      } else if (!isUploadKeyOf(uploadSlug(id), key)) return fail(400, "Not this area's upload.");
      const turn = await uploadTurn(key, { ...body, action: String(body.ask ?? "") });
      if (turn) return turn;
      const b = await updateBazaar((x) => ({
        ...x,
        areas: x.areas.map((a) => (a.id === id ? { ...a, files: { video: { key, name: name.slice(0, 120), size: Number(body.size) || 0, at: now.toISOString() } }, video: { state: "todo", tries: 0, note: "", at: null } } : a)),
      }));
      kick();
      return ok({ bazaar: b });
    }
    case "message": {
      if (needArea()) return needArea()!;
      const text = String(body.text ?? "").trim();
      if (!text) return fail(400, "Write the message first.");
      const b = await updateBazaar((x) => ({
        ...x, areas: x.areas.map((a) => (a.id === id ? { ...a, thread: [...a.thread, { at: now.toISOString(), from: "operator" as const, text: text.slice(0, 4000), open: true }].slice(-200) } : a)),
      }));
      kick();
      return ok({ bazaar: b });
    }
    case "music": {
      if (needArea()) return needArea()!;
      const type = String(body.type ?? "");
      if (!isWalkAudioType(type)) return fail(400, "Music is an .mp3 or .m4a file.");
      if (!(Number(body.size) > 0 && Number(body.size) <= MAX_WALK_AUDIO_BYTES)) return fail(400, "That file is empty or bigger than 40 MB.");
      if (!area!.walk) return fail(409, "The area's walk is not made yet.");
      const key = walkAudioKey(areaScene(id), type, now);
      if (!key) return fail(400, "Music is an .mp3 or .m4a file.");
      return ok({ key, url: await signImagePutUrl(key, type), headers: signImageHeaders(type) });
    }
    case "musicDone": {
      if (needArea()) return needArea()!;
      const key = String(body.key ?? "");
      if (!isWalkAudioKey(key) || !key.startsWith(`scenes/${areaScene(id)}/audio/`) || !area!.walk) return fail(400, "Not this area's music.");
      const walks = await readWalks();
      const w = walks.walks[area!.walk] ?? { doors: [] };
      await writeWalks({ ...walks, walks: { ...walks.walks, [area!.walk]: { ...w, audio: key } } }, walks);
      return ok();
    }
    case "spotAdd": {
      const t = Number(body.t), yaw = Number(body.yaw), pitch = Number(body.pitch ?? -0.05), size = Number(body.size ?? 0.52);
      if (![t, yaw, pitch, size].every(Number.isFinite) || t < 0 || Math.abs(pitch) > 1.5 || size <= 0.02 || size >= 2.5) return fail(400, "A spot needs a moment (s), a direction and a size.");
      const b = await updateBazaar((x) => {
        let n = x.spots.length + 1;
        while (x.spots.some((s) => s.id === `spot-${n}`)) n++;
        return { ...x, spots: [...x.spots, { id: `spot-${n}`, t, yaw, pitch, size }].sort((a, b2) => a.t - b2.t) };
      });
      await replaceDoors();
      return ok({ bazaar: b });
    }
    case "spotRemove": {
      const sid = String(body.id ?? "");
      const held = (await readBazaar()).spots.find((s) => s.id === sid)?.store;
      const b = await updateBazaar((x) => ({ ...x, spots: x.spots.filter((s) => s.id !== sid) }));
      if (held) await replaceDoors([held]);
      return ok({ bazaar: b });
    }
    case "moveStore": {
      const store = String(body.store ?? ""), to = String(body.to ?? "");
      const before = await readBazaar();
      const swapped = before.spots.find((s) => s.id === to)?.store;
      const b = await updateBazaar((x) => moveStore(x, store, to));
      await replaceDoors([store, ...(swapped ? [swapped] : [])]);
      return ok({ bazaar: b });
    }
  }
  return fail(400, "Unknown action.");
}

export async function PUT(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  const q = req.nextUrl.searchParams;
  const id = q.get("id") || "", key = q.get("key") || "";
  if (!AREA_RE.test(id) || !isUploadKeyOf(uploadSlug(id), key)) return fail(400, "Not this area's upload.");
  const n = Number(q.get("partNumber"));
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, "Part number 1–10000.");
  try {
    return await relayPart(key, q.get("uploadId") || "", n, new Uint8Array(await req.arrayBuffer()));
  } catch (e) {
    return fail(500, `R2 refused the part: ${(e as Error).message}`);
  }
}
