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
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  GetBucketCorsCommand, GetObjectCommand, ListObjectsV2Command, ListPartsCommand, PutBucketCorsCommand, PutObjectCommand,
  S3Client, UploadPartCommand, type CORSRule,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentTypeFor, type SplatKind } from "./keys";
import { TOUR_KEY, emptyTour, parseTour, type Tour } from "./tour";

const env = (k: string) => (process.env[k] || "").trim();

export function r2Config() {
  const account = env("R2_ACCOUNT_ID");
  const web = env("R2_BUCKET");
  return {
    configured: Boolean(account && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && web),
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

/** A signed part URL lives this long: one 64 MiB part on a slow link, with room to spare. */
const PART_URL_SECONDS = 60 * 60;
/** A download link for a master, to hand to whoever converts it. */
const LINK_SECONDS = 24 * 60 * 60;

export async function startUpload(kind: SplatKind, key: string): Promise<string> {
  const out = await s3().send(new CreateMultipartUploadCommand({
    Bucket: bucketFor(kind),
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
    new UploadPartCommand({ Bucket: bucketFor(kind), Key: key, UploadId: uploadId, PartNumber: partNumber }),
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
    Bucket: bucketFor(kind), Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: body.length,
  }));
  if (!out.ETag) throw new Error("R2 gave no ETag for the part");
  return out.ETag;
}

/** The parts R2 already holds — how an interrupted upload resumes. */
export async function listParts(kind: SplatKind, key: string, uploadId: string) {
  const parts: Array<{ partNumber: number; etag: string; size: number }> = [];
  let marker: string | undefined;
  for (;;) {
    const out = await s3().send(new ListPartsCommand({
      Bucket: bucketFor(kind), Key: key, UploadId: uploadId, PartNumberMarker: marker,
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
    Bucket: bucketFor(kind),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
    },
  }));
}

export async function abortUpload(kind: SplatKind, key: string, uploadId: string) {
  await s3().send(new AbortMultipartUploadCommand({ Bucket: bucketFor(kind), Key: key, UploadId: uploadId }));
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
  const { webBucket, mastersBucket } = r2Config();
  const [masters, scenes] = await Promise.all([
    listPrefix(mastersBucket, "masters/", "master"),
    listPrefix(webBucket, "scenes/", "web"),
  ]);
  return [...scenes, ...masters];
}

/** A time-limited download link — for a master, the way to hand it to the converter without a key. */
export function downloadLink(kind: SplatKind, key: string): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucketFor(kind), Key: key }), { expiresIn: LINK_SECONDS });
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
export async function writeTour(tour: Tour): Promise<Tour> {
  const clean = parseTour(tour);
  await s3().send(new PutObjectCommand({
    Bucket: r2Config().webBucket,
    Key: TOUR_KEY,
    Body: JSON.stringify(clean, null, 1),
    ContentType: "application/json",
    CacheControl: "no-cache",
  }));
  return clean;
}
