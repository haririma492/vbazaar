/**
 * CLOUDFLARE R2, THROUGH ITS S3 API — server only.
 *
 *   R2_ACCOUNT_ID          the Cloudflare account id (the endpoint is
 *                          https://<id>.r2.cloudflarestorage.com)
 *   R2_ACCESS_KEY_ID       an R2 API token's S3 credentials
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET              the bucket the viewer reads `scenes/` from (public)
 *   R2_MASTERS_BUCKET      optional: a PRIVATE bucket for `masters/`. Without
 *                          it masters go into R2_BUCKET — and if that bucket
 *                          is public, so is the 2 GB master.
 *   NEXT_PUBLIC_SPLAT_BASE_URL  the public address of R2_BUCKET (its r2.dev
 *                          url or custom domain), no trailing slash.
 *
 * ⚠️ OWN NAMES, NOT AWS_*. The AWS_* credentials on this host are the SMS
 * sender's; R2 is a different account with a different endpoint.
 *
 * ⚠️ THE FILE NEVER PASSES THROUGH THIS SERVER. The browser PUTs each part
 * straight to R2 on a URL signed here, so a 2 GB upload costs Railway nothing.
 * That needs the bucket's CORS to allow PUT from the site and to expose ETag —
 * `corsRule` below, which the upload screen can install.
 */

import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand, CreateMultipartUploadCommand, DeleteObjectCommand, UploadPartCopyCommand,
  GetBucketCorsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, ListPartsCommand, PutBucketCorsCommand, PutObjectCommand,
  S3Client, UploadPartCommand, type CORSRule,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentTypeFor, type SignImageType, type SplatKind, type WalkAudioType } from "./keys";
import { TOUR_KEY, emptyTour, mergeTour, parseTour, type Tour } from "./tour";
import { WALKS_KEY, emptyWalks, mergeConflicts, mergeWalks, parseWalks, type Walks } from "./walks";
import { catalogueKey, checkCatalogue, type Catalogue } from "./catalogue";
import { OFFLINE_BASE, offlineDir, offlineJson, offlineKeys } from "./offline";
import { isPrivateVideoKey } from "./media";

const env = (k: string) => (process.env[k] || "").trim();

export function r2Config() {
  const account = env("R2_ACCOUNT_ID");
  const web = env("R2_BUCKET");
  // The demo without internet (`offline.ts`): the folder stands in for the buckets.
  if (offlineDir()) return { configured: true, offline: true, webBucket: web, mastersBucket: web, publicBase: OFFLINE_BASE };
  return {
    configured: Boolean(account && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && web),
    offline: false,
    webBucket: web,
    mastersBucket: env("R2_MASTERS_BUCKET") || web,
    publicBase: env("NEXT_PUBLIC_SPLAT_BASE_URL").replace(/\/+$/, ""),
  };
}

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
  return client;
}

export const bucketFor = (kind: SplatKind) => (kind === "master" ? r2Config().mastersBucket : r2Config().webBucket);

// ── The walk videos are private (`media.ts`, owner 2026-11-06) ──────────────
//
// A "web" key that is a video (`isPrivateVideoKey`) is WRITTEN to the masters
// bucket, which has no public address. It is READ from there too — or, for a
// video not yet moved (`moveVideosPrivate`), from the public bucket, so nothing
// stops playing while the move runs.

/** The bucket a key is written to. */
function writeBucket(kind: SplatKind, key: string): string {
  return kind === "master" || isPrivateVideoKey(key) ? r2Config().mastersBucket : r2Config().webBucket;
}

const where = new Map<string, { bucket: string; until: number }>();
async function headIn(bucket: string, key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

/** The bucket a key is read from: the private one for a video that is there, else the public one. */
export async function readBucket(kind: SplatKind, key: string): Promise<string> {
  const { webBucket, mastersBucket } = r2Config();
  if (kind === "master" || !isPrivateVideoKey(key) || webBucket === mastersBucket) return bucketFor(kind);
  const known = where.get(key);
  if (known && known.until > Date.now()) return known.bucket;
  // Found privately: remembered for good. Not found: the public copy, asked again in a minute.
  const priv = await headIn(mastersBucket, key);
  where.set(key, priv ? { bucket: mastersBucket, until: Infinity } : { bucket: webBucket, until: Date.now() + 60_000 });
  return priv ? mastersBucket : webBucket;
}
const wrote = (key: string) => { if (isPrivateVideoKey(key)) where.set(key, { bucket: r2Config().mastersBucket, until: Infinity }); };

/** A signed part URL lives this long: one 64 MiB part on a slow link, with room to spare. */
const PART_URL_SECONDS = 60 * 60;
/** A download link for a master, to hand to whoever converts it. */
const LINK_SECONDS = 24 * 60 * 60;

export async function startUpload(kind: SplatKind, key: string): Promise<string> {
  const out = await s3().send(new CreateMultipartUploadCommand({
    Bucket: writeBucket(kind, key),
    Key: key,
    ContentType: contentTypeFor(key),
    // Scene files are immutable per name: a new optimization is a new file name.
    CacheControl: kind === "web" ? "public, max-age=31536000, immutable" : undefined,
  }));
  if (!out.UploadId) throw new Error("R2 gave no upload id");
  return out.UploadId;
}

export function signPart(kind: SplatKind, key: string, uploadId: string, partNumber: number): Promise<string> {
  return getSignedUrl(
    s3(),
    new UploadPartCommand({ Bucket: writeBucket(kind, key), Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: PART_URL_SECONDS },
  );
}

/**
 * One part sent BY THIS SERVER, for when the browser's direct PUT is refused
 * (a bucket CORS rule that does not match, a proxy, an antivirus): the browser
 * posts the part's bytes to `/api/operator/splats/part` and they go on from
 * here. Slower — every byte passes through the host — but it always works.
 */
export async function uploadPartBytes(
  kind: SplatKind, key: string, uploadId: string, partNumber: number, body: Uint8Array,
): Promise<string> {
  const out = await s3().send(new UploadPartCommand({
    Bucket: writeBucket(kind, key), Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: body.length,
  }));
  if (!out.ETag) throw new Error("R2 gave no ETag for the part");
  return out.ETag;
}

/** A sign's image (`signImageKey`) or a walk's sound (`walkAudioKey`): the headers its one PUT carries — signed, so the browser must send exactly these. */
export const signImageHeaders = (type: SignImageType | WalkAudioType) => ({ "content-type": type, "cache-control": "public, max-age=31536000, immutable" });

/**
 * A REPLACED SIGN'S IMAGE (founder, 2026-10-08): a few MB at most, so one
 * signed PUT, not a multipart upload — straight from the browser to the web
 * bucket, like the scene files' parts.
 */
export function signImagePutUrl(key: string, type: SignImageType | WalkAudioType): Promise<string> {
  const h = signImageHeaders(type);
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: r2Config().webBucket, Key: key, ContentType: h["content-type"], CacheControl: h["cache-control"] }),
    { expiresIn: PART_URL_SECONDS },
  );
}

/** The same image sent BY THIS SERVER, when the browser's direct PUT is refused (`/api/operator/splats/sign-image`). */
export async function putSignImage(key: string, type: SignImageType | WalkAudioType, body: Uint8Array): Promise<void> {
  const h = signImageHeaders(type);
  await s3().send(new PutObjectCommand({
    Bucket: r2Config().webBucket, Key: key, Body: body, ContentLength: body.length, ContentType: h["content-type"], CacheControl: h["cache-control"],
  }));
}

/** The parts R2 already holds — how an interrupted upload resumes. */
export async function listParts(kind: SplatKind, key: string, uploadId: string) {
  const parts: Array<{ partNumber: number; etag: string; size: number }> = [];
  let marker: string | undefined;
  for (;;) {
    const out = await s3().send(new ListPartsCommand({
      Bucket: writeBucket(kind, key), Key: key, UploadId: uploadId, PartNumberMarker: marker,
    }));
    for (const p of out.Parts ?? []) {
      if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
    }
    if (!out.IsTruncated || !out.NextPartNumberMarker) return parts;
    marker = out.NextPartNumberMarker;
  }
}

export async function completeUpload(
  kind: SplatKind, key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>,
) {
  await s3().send(new CompleteMultipartUploadCommand({
    Bucket: writeBucket(kind, key),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    },
  }));
  wrote(key);
}

export async function abortUpload(kind: SplatKind, key: string, uploadId: string) {
  await s3().send(new AbortMultipartUploadCommand({ Bucket: writeBucket(kind, key), Key: key, UploadId: uploadId }));
}

export type SplatObject = { key: string; kind: SplatKind; size: number; lastModified: string | null };

async function listPrefix(bucket: string, prefix: string, kind: SplatKind): Promise<SplatObject[]> {
  const out: SplatObject[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })).catch((e) => {
      // Two buckets are listed at once: say which one refused.
      (e as Error).message = `bucket «${bucket}»: ${(e as Error).message}`;
      throw e;
    });
    for (const o of page.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, kind, size: o.Size ?? 0, lastModified: o.LastModified?.toISOString() ?? null });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && out.length < 2000);
  return out;
}

export async function listSplats(): Promise<SplatObject[]> {
  if (offlineDir()) {
    return offlineKeys()
      .filter((o) => /^(scenes|masters)\//.test(o.key))
      .map((o) => ({ key: o.key, kind: o.key.startsWith("masters/") ? "master" as const : "web" as const, size: o.size, lastModified: null }));
  }
  const { webBucket, mastersBucket } = r2Config();
  const [masters, scenes, videos] = await Promise.all([
    listPrefix(mastersBucket, "masters/", "master"),
    listPrefix(webBucket, "scenes/", "web"),
    // The private walk videos: "web" files that live in the masters bucket.
    webBucket === mastersBucket ? Promise.resolve([]) : listPrefix(mastersBucket, "scenes/", "web"),
  ]);
  const moved = new Set(videos.map((o) => o.key));
  return [...scenes.filter((o) => !moved.has(o.key)), ...videos, ...masters];
}

/** A master's body as a stream (and its size), or null when it is not there — for `/api/demo`. */
export async function readMaster(key: string): Promise<{ body: ReadableStream; size: number | null } | null> {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: r2Config().mastersBucket, Key: key }));
    if (!out.Body) return null;
    return { body: out.Body.transformToWebStream() as ReadableStream, size: out.ContentLength ?? null };
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}

/** A time-limited download link — for a master, the way to hand it to the converter without a key. */
export function downloadLink(kind: SplatKind, key: string): Promise<string> {
  if (offlineDir()) return Promise.resolve(`${OFFLINE_BASE}/${key}`); // relative: the caller makes it whole
  return readBucket(kind, key).then((Bucket) => getSignedUrl(s3(), new GetObjectCommand({ Bucket, Key: key }), { expiresIn: LINK_SECONDS }));
}

/** The CORS rule the browser upload needs: PUT from these origins, and ETag readable. */
export function corsRule(origins: string[]): CORSRule {
  return {
    AllowedOrigins: origins,
    AllowedMethods: ["GET", "HEAD", "PUT"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  };
}

/**
 * Add the upload rule to each bucket, keeping whatever rules are already there.
 * Needs an R2 token with Admin rights on the bucket; an Object Read & Write
 * token is refused, and the screen then shows the rule to paste by hand.
 */
export async function installCors(origins: string[]) {
  const { webBucket, mastersBucket } = r2Config();
  for (const bucket of new Set([webBucket, mastersBucket])) {
    let rules: CORSRule[] = [];
    try {
      rules = (await s3().send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? [];
    } catch (e) {
      if ((e as { name?: string }).name !== "NoSuchCORSConfiguration") throw e;
    }
    const covered = (o: string) => rules.some((r) => r.AllowedOrigins?.includes(o) && r.AllowedMethods?.includes("PUT")
      && r.ExposeHeaders?.some((h) => h.toLowerCase() === "etag"));
    const missing = origins.filter((o) => !covered(o));
    if (missing.length) {
      await s3().send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [...rules, corsRule(missing)] } }));
    }
  }
}

/** A web-bucket object (or, with `kind` "master", a masters one) saved to a local file — the streamed-copy job's input. */
export async function downloadToFile(key: string, path: string, kind: SplatKind = "web"): Promise<number> {
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const out = await s3().send(new GetObjectCommand({ Bucket: await readBucket(kind, key), Key: key }));
  if (!out.Body) throw new Error(`«${key}» is empty`);
  await pipeline(out.Body as NodeJS.ReadableStream, createWriteStream(path));
  return out.ContentLength ?? 0;
}

/** Whether the web bucket holds `key` (a video: the private bucket, or the public one before the move). */
export async function webObjectExists(key: string): Promise<boolean> {
  return headIn(await readBucket("web", key), key);
}

/** A local file put into the web bucket at `key` (one request: R2 takes up to ~5 GB that way). */
export async function uploadFile(key: string, path: string, contentType = "application/octet-stream"): Promise<void> {
  const { createReadStream, statSync } = await import("node:fs");
  await s3().send(new PutObjectCommand({
    Bucket: writeBucket("web", key),
    Key: key,
    Body: createReadStream(path),
    ContentLength: statSync(path).size,
    ContentType: contentType,
    // A new copy gets a new name: this one never changes.
    CacheControl: "public, max-age=31536000, immutable",
  }));
  wrote(key);
}

/**
 * One web-bucket object copied to another key, inside R2 (nothing passes
 * through this server; up to 5 GB) — a cut walk's original kept, and put back.
 */
export async function copyWebObject(from: string, to: string, contentType?: string): Promise<void> {
  const src = await readBucket("web", from);
  await s3().send(new CopyObjectCommand({
    Bucket: writeBucket("web", to), Key: to, CopySource: `${src}/${from.split("/").map(encodeURIComponent).join("/")}`,
    ...(contentType ? { MetadataDirective: "REPLACE", ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" } : {}),
  }));
  wrote(to);
}

/** The tour (`lib/splats/tour.ts`) as the bucket holds it; an empty one before the first save. */
export async function readTour(): Promise<Tour> {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: r2Config().webBucket, Key: TOUR_KEY }));
    return parseTour(JSON.parse((await out.Body?.transformToString()) || "{}"));
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return emptyTour();
    throw e;
  }
}

/**
 * ⚠️ NO-CACHE, unlike the scene files: the tour changes in place (an exit
 * added, a scene re-uploaded) under the same name, and the viewer must see it.
 */
export async function writeTour(tour: Tour, base?: Tour): Promise<Tour> {
  // ⚠️ MERGED, NOT OVERWRITTEN (`mergeTour`): what this page changed since it
  // read the tour goes in; what another page saved meanwhile stays.
  const stored = await readTour();
  const clean = base ? mergeTour(parseTour(base), parseTour(tour), stored) : parseTour(tour);
  // Every tour that is replaced is kept (the private bucket, `tour-history/`):
  // a route that took a whole walk to record can always be brought back.
  if (stored.scenes.length) {
    try {
      await s3().send(new PutObjectCommand({
        Bucket: r2Config().mastersBucket,
        Key: `tour-history/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        Body: JSON.stringify(stored, null, 1),
        ContentType: "application/json",
      }));
    } catch {
      /* a missing backup never stops a save */
    }
  }
  await s3().send(new PutObjectCommand({
    Bucket: r2Config().webBucket,
    Key: TOUR_KEY,
    Body: JSON.stringify(clean, null, 1),
    ContentType: "application/json",
    CacheControl: "no-cache",
  }));
  return clean;
}

// ── The walks: doors from the 360° street walk into shops (`lib/splats/walks.ts`) ──

/** The walks as the bucket holds them; none before the first save. */
/** A store's product list (`lib/splats/catalogue.ts`), or null when none was uploaded. Read with the S3 API: it is rewritten in place. */
export async function readCatalogue(store: string): Promise<Catalogue | null> {
  if (offlineDir()) {
    const raw = offlineJson(catalogueKey(store));
    return raw ? checkCatalogue(raw).catalogue : null;
  }
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: r2Config().webBucket, Key: catalogueKey(store) }));
    return checkCatalogue(JSON.parse((await out.Body?.transformToString()) || "{}")).catalogue;
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}

/** Saved whole (the operator's page holds the whole list); the one replaced is kept in the private bucket. */
export async function writeCatalogue(c: Catalogue): Promise<Catalogue> {
  const before = await readCatalogue(c.store);
  if (before) {
    try {
      await s3().send(new PutObjectCommand({
        Bucket: r2Config().mastersBucket,
        Key: `catalogues-history/${c.store}/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        Body: JSON.stringify(before),
        ContentType: "application/json",
      }));
    } catch {
      /* a missing backup never stops a save */
    }
  }
  const out: Catalogue = { ...c, updated: new Date().toISOString() };
  await s3().send(new PutObjectCommand({
    Bucket: r2Config().webBucket,
    Key: catalogueKey(c.store),
    Body: JSON.stringify(out),
    ContentType: "application/json",
    CacheControl: "no-cache",
  }));
  return out;
}

export async function readWalks(): Promise<Walks> {
  if (offlineDir()) return parseWalks(offlineJson(WALKS_KEY) ?? {});
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: r2Config().webBucket, Key: WALKS_KEY }));
    return parseWalks(JSON.parse((await out.Body?.transformToString()) || "{}"));
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return emptyWalks();
    throw e;
  }
}

/**
 * Saved like the tour: MERGED with what is stored (`mergeWalks`, `base` being
 * the walks the page last read), the replaced file kept in the private
 * bucket (`walks-history/`), and NO-CACHE (rewritten in place). `walks` must
 * already be checked (`checkWalks`). `conflicts`: doors both this page and
 * someone else changed — this page's version was kept.
 */
export async function writeWalks(walks: Walks, base?: Walks): Promise<{ walks: Walks; conflicts: string[] }> {
  const stored = await readWalks();
  const mine = parseWalks(walks);
  const clean = base ? mergeWalks(parseWalks(base), mine, stored) : mine;
  const conflicts = base ? mergeConflicts(parseWalks(base), mine, stored) : [];
  if (Object.keys(stored.walks).length || stored.start) {
    try {
      await s3().send(new PutObjectCommand({
        Bucket: r2Config().mastersBucket,
        Key: `walks-history/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        Body: JSON.stringify(stored, null, 1),
        ContentType: "application/json",
      }));
    } catch {
      /* a missing backup never stops a save */
    }
  }
  await s3().send(new PutObjectCommand({
    Bucket: r2Config().webBucket,
    Key: WALKS_KEY,
    Body: JSON.stringify(clean, null, 1),
    ContentType: "application/json",
    CacheControl: "no-cache",
  }));
  return { walks: clean, conflicts };
}

// ── Training on a rented GPU (`lib/splats/train.ts`) ─────────────────────────

/**
 * A GET link for any key this tool knows (masters/ and training/ in the
 * masters bucket, the rest in the web bucket) — what the GPU machine
 * downloads the phone video from. It never gets a key.
 */
export function presignGetAny(key: string, seconds: number): Promise<string> {
  if (offlineDir()) return Promise.resolve(`${OFFLINE_BASE}/${key}`); // relative: the caller makes it whole
  const bucket = /^(masters|training)\//.test(key) ? Promise.resolve(r2Config().mastersBucket) : readBucket("web", key);
  return bucket.then((Bucket) => getSignedUrl(s3(), new GetObjectCommand({ Bucket, Key: key }), { expiresIn: seconds }));
}

/** A GET link for a key in the web or the masters bucket, as `downloadToFile` reads it. */
export function presignGet(key: string, kind: SplatKind, seconds: number): Promise<string> {
  if (offlineDir()) return Promise.resolve(`${OFFLINE_BASE}/${key}`);
  return readBucket(kind, key).then((Bucket) => getSignedUrl(s3(), new GetObjectCommand({ Bucket, Key: key }), { expiresIn: seconds }));
}

/**
 * A PUT link into the masters bucket (private) — where the GPU machine writes
 * its status, log, cameras and the trained .ply. Signed WITHOUT a content
 * type, so a plain `curl -T` matches it.
 */
export function presignPutMasters(key: string, seconds: number): Promise<string> {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: r2Config().mastersBucket, Key: key }), { expiresIn: seconds });
}

/** A masters-bucket object as text; null when it is not there (yet). */
export async function readMastersText(key: string): Promise<string | null> {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: r2Config().mastersBucket, Key: key }));
    return (await out.Body?.transformToString()) ?? null;
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}

export async function writeMastersJson(key: string, value: unknown): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: r2Config().mastersBucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json", CacheControl: "no-store",
  }));
}

// ── Moving the walk videos into the private bucket (`media.ts`) ─────────────

export type VideoMove = {
  state: "idle" | "running" | "done" | "failed";
  /** Videos still in the public bucket when this run started. */
  total: number; moved: number; bytes: number; failed: Array<{ key: string; error: string }>;
  current: string | null; started: string | null; finished: string | null; deletePublic: boolean;
};
let move: VideoMove = { state: "idle", total: 0, moved: 0, bytes: 0, failed: [], current: null, started: null, finished: null, deletePublic: false };
export const videoMoveStatus = () => move;

/** One object copied between buckets inside R2 (nothing passes through this server); in 1 GiB parts past 5 GB. */
async function copyAcross(srcBucket: string, dstBucket: string, key: string, size: number, contentType?: string) {
  const CopySource = `${srcBucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const GiB = 1024 ** 3;
  if (size <= 4 * GiB) {
    await s3().send(new CopyObjectCommand({ Bucket: dstBucket, Key: key, CopySource }));
    return;
  }
  const { UploadId } = await s3().send(new CreateMultipartUploadCommand({ Bucket: dstBucket, Key: key, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  if (!UploadId) throw new Error("R2 gave no upload id");
  try {
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    for (let i = 0, start = 0; start < size; i++, start += GiB) {
      const end = Math.min(size, start + GiB) - 1;
      const out = await s3().send(new UploadPartCopyCommand({ Bucket: dstBucket, Key: key, UploadId, PartNumber: i + 1, CopySource, CopySourceRange: `bytes=${start}-${end}` }));
      if (!out.CopyPartResult?.ETag) throw new Error(`no ETag for part ${i + 1}`);
      parts.push({ PartNumber: i + 1, ETag: out.CopyPartResult.ETag });
    }
    await s3().send(new CompleteMultipartUploadCommand({ Bucket: dstBucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
  } catch (e) {
    await s3().send(new AbortMultipartUploadCommand({ Bucket: dstBucket, Key: key, UploadId })).catch(() => {});
    throw e;
  }
}

/**
 * Every video under `scenes/` in the public bucket copied to the private one,
 * the copy's size checked, and — only with `deletePublic` — the public copy
 * then deleted. Resumable: a video already moved is skipped (and, with
 * `deletePublic`, its public copy removed once the private one is checked).
 * One run at a time, in the background.
 */
export function startVideoMove(deletePublic: boolean): VideoMove {
  if (move.state === "running") return move;
  const { webBucket, mastersBucket } = r2Config();
  if (webBucket === mastersBucket) {
    move = { ...move, state: "failed", failed: [{ key: "", error: "R2_MASTERS_BUCKET is not set: there is no private bucket to move the videos into." }] };
    return move;
  }
  move = { state: "running", total: 0, moved: 0, bytes: 0, failed: [], current: null, started: new Date().toISOString(), finished: null, deletePublic };
  void (async () => {
    try {
      const pub = (await listAll(webBucket, "scenes/")).filter((o) => isPrivateVideoKey(o.key));
      move.total = pub.length;
      for (const o of pub) {
        move.current = o.key;
        try {
          const head = await s3().send(new HeadObjectCommand({ Bucket: mastersBucket, Key: o.key })).catch(() => null);
          if (!head || head.ContentLength !== o.size) {
            const src = await s3().send(new HeadObjectCommand({ Bucket: webBucket, Key: o.key }));
            await copyAcross(webBucket, mastersBucket, o.key, o.size, src.ContentType);
            const check = await s3().send(new HeadObjectCommand({ Bucket: mastersBucket, Key: o.key }));
            if (check.ContentLength !== o.size) throw new Error(`the private copy is ${check.ContentLength} bytes, the public one ${o.size}`);
          }
          where.set(o.key, { bucket: mastersBucket, until: Infinity });
          if (deletePublic) await s3().send(new DeleteObjectCommand({ Bucket: webBucket, Key: o.key }));
          move.moved++;
          move.bytes += o.size;
        } catch (e) {
          move.failed.push({ key: o.key, error: (e as Error).message || String(e) });
        }
      }
      move.state = move.failed.length && !move.moved ? "failed" : "done";
    } catch (e) {
      move.failed.push({ key: "", error: (e as Error).message || String(e) });
      move.state = "failed";
    } finally {
      move.current = null;
      move.finished = new Date().toISOString();
    }
  })();
  return move;
}

/** Every object under a prefix, however many (`listPrefix` stops at 2,000 for the screen). */
async function listAll(bucket: string, prefix: string): Promise<Array<{ key: string; size: number }>> {
  const out: Array<{ key: string; size: number }> = [];
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}
