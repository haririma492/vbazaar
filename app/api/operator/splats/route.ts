/**
 * /api/operator/splats — the Virtual Bazaar's Gaussian-splat files in R2, for
 * `/operator/splats`. x-admin-token. See `lib/splats/`.
 *
 *   GET                                               → { r2, objects, tour }
 *   POST { action: "start", scene, name, size }        → { key, kind, uploadId, partSize, partCount }
 *   POST { action: "sign", key, uploadId, partNumber } → { url }      (PUT the part's bytes there)
 *   POST { action: "parts", key, uploadId }            → { parts }    (what R2 already has: resume)
 *   POST { action: "complete", key, uploadId, parts }  → { url }      (public url for a scene file)
 *   POST { action: "abort", key, uploadId }
 *   POST { action: "link", key }                       → { url }      (24 h download link)
 *   POST { action: "cors" }                            (lets this site's browser PUT to the bucket)
 *   POST { action: "tour", tour, base? }               → { tour }     (merges into scenes/tour.json)
 *   POST { action: "walksSave", walks, base? }        → { walks, conflicts }  (merges into scenes/walks.json —
 *                                                       `lib/splats/walks.ts`; refused, with every problem named,
 *                                                       when a door is malformed or a video is not in the buckets)
 *   POST { action: "signImage", scene, sign, type, size } → { key, url, headers }  (a replaced sign's image:
 *                                                       PUT it to `url` with `headers`; scenes/<scene>/signs/…)
 *   POST { action: "stream" | "streamStatus", scene, sharp? }       → { job }  (the streamed copy)
 *   POST { action: "retouch" | "retouchStatus", scene, preset? }    → { job }  (the restored copy of ONE scene;
 *                                                       preset "full" (default), "gentle" or "deep" — deep also removes
 *                                                       cars and people; sets that scene's fileRestored; job.report says what was done)
 *   POST { action: "train", key, scene, title? }        → { job }  (a splat trained from the phone video at `key`
 *                                                       on a rented GPU — `lib/splats/train.ts`; one at a time)
 *   POST { action: "trainStatus" | "trainCancel" }      → { job }  (the current or last training; cancel stops the GPU)
 *
 * The bytes go from the browser straight to R2; nothing here touches them.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminTokenValid } from "@/lib/adminAuth";
import {
  MAX_SIGN_IMAGE_BYTES, MAX_WALK_AUDIO_BYTES, isSceneId, isSignImageType, isSplatKey, isWalkAudioType, partPlan, signImageKey, splatKey, walkAudioKey,
} from "@/lib/splats/keys";
import {
  abortUpload, completeUpload, downloadLink, installCors, listParts, listSplats, r2Config, readTour, signImageHeaders, signImagePutUrl,
  signPart, startUpload, writeCatalogue, writeTour, writeWalks,
} from "@/lib/splats/r2";
import { TOUR_KEY } from "@/lib/splats/tour";
import { WALKS_KEY, checkWalks, keysNamed } from "@/lib/splats/walks";
import { checkCatalogue } from "@/lib/splats/catalogue";
import { cutInfo, cutJob, startCutJob, startRestoreJob } from "@/lib/splats/cut-job";
import { startStreamJob, streamJob } from "@/lib/splats/stream-job";
import { isRetouchPreset, retouchJob, startRetouchJob } from "@/lib/splats/retouch-job";
import { trainLogUrl, trainSummary, trainer } from "@/lib/splats/train-job";
import { TrainRefused } from "@/lib/splats/train";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}
const ok = (body: object) => NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });

function guard(req: NextRequest) {
  if (!isAdminTokenValid(req.headers.get("x-admin-token") || "")) return fail(401, "Unauthorized");
  if (!r2Config().configured) {
    return fail(503, "R2 is not configured on this host: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.");
  }
  return null;
}

/** What the screen shows about the setup — never a credential. */
function r2Summary() {
  const c = r2Config();
  return {
    webBucket: c.webBucket,
    mastersBucket: c.mastersBucket,
    mastersArePrivate: c.mastersBucket !== c.webBucket,
    publicBase: c.publicBase || null,
  };
}

const publicUrl = (key: string) => {
  const base = r2Config().publicBase;
  return base ? `${base}/${key}` : null;
};

/**
 * R2's own words, with its error code. ⚠️ ANSWERED AS 500, NOT 502: Cloudflare
 * in front of the site swaps an origin's 502 for a bare page of its own, and
 * the operator saw only "HTTP 502" instead of why R2 said no.
 */
function r2Reason(e: unknown): string {
  const err = e as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = err.Code || err.name || "Error";
  const status = err.$metadata?.httpStatusCode;
  return `${code}${status ? ` (${status})` : ""}: ${err.message || "no message"}`;
}

const uploadIdOf = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length < 1024 ? v : null);

export async function GET(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  try {
    const [all, tour] = await Promise.all([listSplats(), readTour()]);
    const objects = all.filter((o) => o.key !== TOUR_KEY && o.key !== WALKS_KEY).map((o) => ({ ...o, url: o.kind === "web" ? publicUrl(o.key) : null }));
    return ok({ r2: r2Summary(), objects, tour, train: trainSummary() });
  } catch (e) {
    console.error("[operator/splats:GET]", e);
    return fail(500, `R2 refused the listing: ${r2Reason(e)}`);
  }
}

export async function POST(req: NextRequest) {
  const refused = guard(req);
  if (refused) return refused;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Body must be JSON.");
  }

  const action = body?.action;

  // Training on a rented GPU (`lib/splats/train.ts`): RunPod's words, not R2's.
  if (action === "train" || action === "trainStatus" || action === "trainCancel" || action === "trainLog") {
    try {
      if (action === "trainStatus") return ok({ job: await trainer().status() });
      if (action === "trainLog") {
        const url = await trainLogUrl();
        return url ? ok({ url }) : fail(404, "No training log: the last training never reached a GPU.");
      }
      if (action === "trainCancel") return ok({ job: await trainer().cancel() });
      const title = typeof body.title === "string" ? body.title : null;
      return ok({ job: await trainer().start(String(body.scene ?? ""), String(body.key ?? ""), title) });
    } catch (e) {
      if (e instanceof TrainRefused) return fail(e.status, e.message);
      console.error(`[operator/splats:${action}]`, e);
      return fail(500, `Training «${action}» failed: ${(e as Error).message || "no message"}`);
    }
  }

  try {
    if (action === "start") {
      const target = splatKey(String(body.scene ?? ""), String(body.name ?? ""));
      if (!target) return fail(400, "A scene id like «hallway» or «store-01», and a .ply, .spz, .sog, .ksplat, .splat or .rad file.");
      const plan = partPlan(Number(body.size));
      if (!plan) return fail(400, "That file size cannot be uploaded.");
      const uploadId = await startUpload(target.kind, target.key);
      return ok({ ...target, uploadId, ...plan });
    }

    if (action === "cors") {
      const origin = req.headers.get("origin") || req.nextUrl.origin;
      const origins = [...new Set([origin, process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "")].filter(Boolean) as string[])];
      await installCors(origins);
      return ok({ origins });
    }

    // The streamed copy (`lib/splats/stream-job.ts`): start it, or ask how it goes.
    if (action === "stream" || action === "streamStatus") {
      const scene = String(body.scene ?? "");
      if (!isSceneId(scene)) return fail(400, "A scene id.");
      return ok({ job: action === "stream" ? startStreamJob(scene, body.sharp === true) : streamJob(scene) });
    }

    // The restored copy (`lib/splats/retouch-job.ts`), for the one scene named.
    if (action === "retouch" || action === "retouchStatus") {
      const scene = String(body.scene ?? "");
      if (!isSceneId(scene)) return fail(400, "A scene id.");
      const preset = body.preset ?? "full";
      if (!isRetouchPreset(preset)) return fail(400, "Preset «full», «gentle» or «deep».");
      return ok({ job: action === "retouch" ? startRetouchJob(scene, preset, Number.isFinite(Number(body.metresPerUnit)) && Number(body.metresPerUnit) > 0.01 && Number(body.metresPerUnit) < 100 ? Number(body.metresPerUnit) : 1) : retouchJob(scene) });
    }

    // A replaced sign's image (`signImageKey`): a key in the scene's signs/
    // folder and one signed PUT for it. Only PNG, JPEG or WebP, and small.
    if (action === "signImage") {
      const scene = String(body.scene ?? "");
      const type = String(body.type ?? "");
      const size = Number(body.size);
      if (!isSignImageType(type)) return fail(400, "A PNG, JPEG or WebP image.");
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIGN_IMAGE_BYTES) {
        return fail(400, `An image of at most ${MAX_SIGN_IMAGE_BYTES / 1048576} MB.`);
      }
      const key = signImageKey(scene, String(body.sign ?? ""), type, new Date());
      if (!key) return fail(400, "A scene id and a sign id like «sign-1».");
      return ok({ key, url: await signImagePutUrl(key, type), headers: signImageHeaders(type), publicUrl: publicUrl(key) });
    }

    // A walk's background sound (`walkAudioKey`): a key in the scene's audio/
    // folder and one signed PUT for it, like a sign's image.
    if (action === "walkAudio") {
      const type = String(body.type ?? "");
      const size = Number(body.size);
      if (!isWalkAudioType(type)) return fail(400, "An .mp3 or .m4a sound.");
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_WALK_AUDIO_BYTES) {
        return fail(400, `A sound of at most ${MAX_WALK_AUDIO_BYTES / 1048576} MB.`);
      }
      const key = walkAudioKey(String(body.scene ?? ""), type, new Date());
      if (!key) return fail(400, "A scene id.");
      return ok({ key, url: await signImagePutUrl(key, type), headers: signImageHeaders(type), publicUrl: publicUrl(key) });
    }

    if (action === "tour") {
      if (!body?.tour || typeof body.tour !== "object") return fail(400, "No tour.");
      // `base`: the tour as this page last read it — the save is merged (`mergeTour`).
      const base = body.base && typeof body.base === "object" ? body.base : undefined;
      return ok({ tour: await writeTour(body.tour, base) });
    }

    // The walks (`lib/splats/walks.ts`): doors from the street walk into shops.
    if (action === "walksSave") {
      const { walks, problems } = checkWalks(body?.walks);
      if (!body?.walks || typeof body.walks !== "object") problems.unshift("No walks.");
      // Every video a walk or door names must be in the buckets: a door to a
      // file that was never uploaded (or was renamed) would lead to nothing.
      if (!problems.length) {
        const have = new Set((await listSplats()).map((o) => o.key));
        for (const k of keysNamed(walks)) if (!have.has(k)) problems.push(`«${k}» is not in the buckets.`);
      }
      if (problems.length) return fail(400, `Not saved:\n${problems.join("\n")}`);
      const base = body.base && typeof body.base === "object" ? checkWalks(body.base).walks : undefined;
      return ok(await writeWalks(walks, base));
    }

    // Cut a walk video down to the parts worth keeping (`lib/splats/cut.ts`),
    // or put its original back; the job runs here, the page asks after it.
    if (action === "cut" || action === "cutRestore" || action === "cutStatus") {
      const key = String(body.key ?? "");
      if (action === "cutStatus") return ok({ job: cutJob(key), ...(body.info ? await cutInfo(key) : {}) });
      try {
        return ok({ job: action === "cut" ? startCutJob(key, body.parts) : startRestoreJob(key) });
      } catch (e) {
        return fail(409, (e as Error).message);
      }
    }

    // A store's product list (`lib/splats/catalogue.ts`): merchant on-boarding.
    if (action === "catalogueSave") {
      const { catalogue, problems } = checkCatalogue(body?.catalogue);
      if (!catalogue) return fail(400, `Not saved:\n${problems.join("\n")}`);
      if (problems.length) return fail(400, `Not saved:\n${problems.join("\n")}`);
      return ok({ catalogue: await writeCatalogue(catalogue) });
    }

    const key = typeof body?.key === "string" ? body.key : "";
    const kind = isSplatKey(key);
    if (!kind) return fail(400, "Not a splat key.");

    if (action === "link") return ok({ url: await downloadLink(kind, key) });

    const uploadId = uploadIdOf(body.uploadId);
    if (!uploadId) return fail(400, "No upload id.");

    switch (action) {
      case "sign": {
        const n = Number(body.partNumber);
        if (!Number.isInteger(n) || n < 1 || n > 10_000) return fail(400, "Part number 1–10000.");
        return ok({ url: await signPart(kind, key, uploadId, n) });
      }
      case "parts":
        return ok({ parts: await listParts(kind, key, uploadId) });
      case "complete": {
        const parts = Array.isArray(body.parts) ? body.parts : [];
        const clean = parts
          .map((p: any) => ({ partNumber: Number(p?.partNumber), etag: String(p?.etag ?? "") }))
          .filter((p: { partNumber: number; etag: string }) => Number.isInteger(p.partNumber) && p.partNumber > 0 && p.etag);
        if (!clean.length || clean.length !== parts.length) return fail(400, "Every part needs its number and ETag.");
        await completeUpload(kind, key, uploadId, clean);
        return ok({ key, url: kind === "web" ? publicUrl(key) : null });
      }
      case "abort":
        await abortUpload(kind, key, uploadId);
        return ok({});
      default:
        return fail(400, "Unknown action.");
    }
  } catch (e) {
    console.error(`[operator/splats:${action}]`, e);
    return fail(500, `R2 refused «${action}»: ${r2Reason(e)}`);
  }
}
