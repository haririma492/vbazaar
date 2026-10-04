#!/usr/bin/env node
/**
 * CONVERT A MASTER THAT IS ALREADY IN R2 — no laptop involved.
 *
 *   node --experimental-strip-types scripts/splats/convert-in-r2.mjs <scene> [--sh 1] [--title "Main hallway"]
 *
 * Run by `.github/workflows/splat-convert.yml` (Actions → Convert splat →
 * Run workflow). It takes the newest .ply under `masters/<scene>/`, converts it
 * to SPZ v3 with Spark's encoder (the same one `/operator/splats` runs in the
 * tab, and `convert.mjs` on a computer), uploads it as
 * `scenes/<scene>/<scene>-<date>.spz`, and adds the scene to the tour (or
 * points it at the new file, keeping its exits).
 *
 * Why it exists: converting a 2 GB master needs about 4 GB of memory, and a
 * laptop's browser tab can run out. A GitHub runner has 7 GB or more.
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and
 * optionally R2_MASTERS_BUCKET — the same names as on Railway (lib/splats/r2.ts).
 *
 * Test without R2: R2_LOCAL_DIR=<dir> reads and writes `<dir>/<bucket>/<key>`.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, createWriteStream, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { splatKey, webFileName, isSceneId } from "../../lib/splats/keys.ts";
import { TOUR_KEY, emptyTour, parseTour, upsertScene } from "../../lib/splats/tour.ts";

// ── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args.splice(i, 2)[1];
};
const sh = Number(opt("--sh", "1"));
const title = (opt("--title", "") || "").trim();
const [scene] = args;
if (!scene || !isSceneId(scene) || ![0, 1, 2, 3].includes(sh)) {
  console.error('usage: convert-in-r2.mjs <scene-id> [--sh 0-3] [--title "Shown to visitors"]');
  process.exit(1);
}

const env = (k) => (process.env[k] || "").trim();
const webBucket = env("R2_BUCKET");
const mastersBucket = env("R2_MASTERS_BUCKET") || webBucket;
const localDir = env("R2_LOCAL_DIR");
if (!webBucket) {
  console.error("R2_BUCKET is not set.");
  process.exit(1);
}

// ── Storage: R2, or a folder when testing ───────────────────────────────────
let store;
if (localDir) {
  const path = (b, k) => join(localDir, b, k);
  store = {
    async list(b, prefix) {
      const dir = path(b, prefix);
      try {
        return readdirSync(dir).map((f) => ({ key: prefix + f, size: statSync(join(dir, f)).size, modified: statSync(join(dir, f)).mtimeMs }));
      } catch {
        return [];
      }
    },
    async download(b, k, file) { writeFileSync(file, readFileSync(path(b, k))); },
    async read(b, k) { try { return readFileSync(path(b, k), "utf8"); } catch { return null; } },
    async write(b, k, body) { mkdirSync(dirname(path(b, k)), { recursive: true }); writeFileSync(path(b, k), body); },
  };
} else {
  const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
  store = {
    async list(b, prefix) {
      const out = await s3.send(new ListObjectsV2Command({ Bucket: b, Prefix: prefix }));
      return (out.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified?.getTime() ?? 0 }));
    },
    async download(b, k, file) {
      const out = await s3.send(new GetObjectCommand({ Bucket: b, Key: k }));
      await pipeline(out.Body, createWriteStream(file));
    },
    async read(b, k) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: b, Key: k }));
        return await out.Body.transformToString();
      } catch (e) {
        if (e?.name === "NoSuchKey") return null;
        throw e;
      }
    },
    async write(b, k, body, type, cache) {
      await s3.send(new PutObjectCommand({ Bucket: b, Key: k, Body: body, ContentType: type, CacheControl: cache }));
    },
  };
}

// ── 1. The newest master of this scene ──────────────────────────────────────
const masters = (await store.list(mastersBucket, `masters/${scene}/`)).filter((o) => /\.ply$/i.test(o.key));
if (!masters.length) {
  console.error(`No .ply under masters/${scene}/ in ${mastersBucket}. Upload it at /operator/splats first.`);
  process.exit(1);
}
const master = masters.sort((a, b) => b.modified - a.modified)[0];
console.log(`master: ${mastersBucket}/${master.key} (${(master.size / 1e9).toFixed(2)} GB)`);

const work = join(tmpdir(), `splat-${scene}-${Date.now()}`);
mkdirSync(work, { recursive: true });
const plyFile = join(work, "master.ply");
let t = performance.now();
await store.download(mastersBucket, master.key, plyFile);
console.log(`downloaded in ${((performance.now() - t) / 1000).toFixed(1)} s`);

// ── 2. Convert ──────────────────────────────────────────────────────────────
globalThis.self ??= globalThis; // Spark is written for the browser; this is all it needs from one.
const { transcodeSpz } = await import("@sparkjsdev/spark");
t = performance.now();
const out = await transcodeSpz({
  inputs: [{ fileBytes: new Uint8Array(readFileSync(plyFile)), pathOrUrl: master.key }],
  maxSh: sh,
  opacityThreshold: 0.02,
  version: 3, // Spark 2.3 cannot decode SPZ v4.
});
const spz = out.fileBytes;
console.log(`converted in ${((performance.now() - t) / 1000).toFixed(1)} s: ${(master.size / 1e6).toFixed(0)} MB → ${(spz.length / 1e6).toFixed(1)} MB, SH degree ${sh}`);

// ── 3. Upload the web copy ──────────────────────────────────────────────────
const webKey = splatKey(scene, webFileName(scene, new Date()))?.key;
if (!webKey) throw new Error("Could not make the web file's key.");
await store.write(webBucket, webKey, spz, "application/octet-stream", "public, max-age=31536000, immutable");
console.log(`uploaded ${webBucket}/${webKey}`);

// ── 4. Into the tour ────────────────────────────────────────────────────────
const raw = await store.read(webBucket, TOUR_KEY);
const before = raw ? parseTour(JSON.parse(raw)) : emptyTour();
const tour = upsertScene(before, scene, webKey, title ? { en: title, fa: title } : undefined);
await store.write(webBucket, TOUR_KEY, JSON.stringify(tour, null, 1), "application/json", "no-cache");
console.log(`tour: ${tour.scenes.map((s) => s.id).join(", ")} (starts in ${tour.start})`);

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### ${scene}`,
    `- master: \`${master.key}\` (${(master.size / 1e9).toFixed(2)} GB)`,
    `- web copy: \`${webKey}\` (${(spz.length / 1e6).toFixed(1)} MB, SH degree ${sh})`,
    `- open: https://sarekooche.com/vca/splat?scene=${scene}`,
    "",
  ].join("\n"), { flag: "a" });
}
