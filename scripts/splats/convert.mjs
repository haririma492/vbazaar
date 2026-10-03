#!/usr/bin/env node
/**
 * A SPLATICA .PLY → A WEB .SPZ, on a computer instead of in the browser.
 *
 *   node scripts/splats/convert.mjs hallway.ply                  # → hallway.spz beside it
 *   node scripts/splats/convert.mjs hallway.ply out.spz --sh 2   # keep more view-dependent colour
 *
 * The same encoder `/operator/splats` runs in the tab (Spark's `transcodeSpz`),
 * for when the tab runs out of memory on a ~2 GB master (it needs about twice
 * the file's size). Then upload the .spz on that screen under the same scene id.
 *
 *   --sh <0-3>        spherical-harmonic degree kept (default 1). Each degree
 *                     is more view-dependent shine and a bigger file.
 *   --opacity <0-1>   drop splats fainter than this (default 0.02).
 *
 * ⚠️ WRITES SPZ v3. Spark 2.3 cannot decode v4 (splat-transform's default).
 *
 * To also THIN a scene (fewer splats, for phones), use PlayCanvas's
 * splat-transform first, then this:
 *   npx @playcanvas/splat-transform -g cpu in.ply -N -d 50% thinned.ply
 *   node scripts/splats/convert.mjs thinned.ply
 *
 * The .ply and .spz never go into git (.gitignore).
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = Number(args.splice(i, 2)[1]);
  return Number.isFinite(v) ? v : fallback;
};
const sh = flag("--sh", 1);
const opacity = flag("--opacity", 0.02);
const [input, output = input?.replace(/\.ply$/i, "") + ".spz"] = args;
if (!input || !/\.ply$/i.test(input) || ![0, 1, 2, 3].includes(sh)) {
  console.error("usage: node scripts/splats/convert.mjs <in.ply> [out.spz] [--sh 0-3] [--opacity 0-1]");
  process.exit(1);
}

// Spark is written for the browser; this is all it needs from one.
globalThis.self ??= globalThis;
const { transcodeSpz } = await import("@sparkjsdev/spark");

const size = statSync(input).size;
console.log(`reading ${input} (${(size / 1e6).toFixed(0)} MB)…`);
const t = performance.now();
const out = await transcodeSpz({
  inputs: [{ fileBytes: new Uint8Array(readFileSync(input)), pathOrUrl: input }],
  maxSh: sh,
  opacityThreshold: opacity,
  version: 3,
});
writeFileSync(output, out.fileBytes);
const secs = ((performance.now() - t) / 1000).toFixed(1);
console.log(`${output}: ${(out.fileBytes.length / 1e6).toFixed(1)} MB (${((out.fileBytes.length / size) * 100).toFixed(1)}% of the .ply) in ${secs} s, SH degree ${sh}`);
