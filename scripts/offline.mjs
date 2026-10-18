#!/usr/bin/env node
/**
 * RUN THE DEMO WITHOUT INTERNET (the folder filled by `npm run offline:pack`):
 *
 *   npm run offline                 → serves ./offline at http://localhost:3000/demo
 *   npm run offline -- D:\demo      → another folder
 *
 * Builds the app once in offline mode (NEXT_PUBLIC_OFFLINE: «Add to basket»
 * keeps the line on this device, as sarekooche.com cannot be reached) — the
 * build needs no internet — then serves it with OFFLINE_DIR set, so every
 * read that went to the buckets reads the folder (`lib/splats/offline.ts`).
 */

import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] || "offline");
if (!existsSync(join(dir, "scenes", "walks.json"))) {
  console.error(`✗ ${dir} has no walks: fill it first, with internet:  npm run offline:pack`);
  process.exit(1);
}
const next = join("node_modules", "next", "dist", "bin", "next");
const env = { ...process.env, OFFLINE_DIR: dir, NEXT_PUBLIC_OFFLINE: "1", NEXT_TELEMETRY_DISABLED: "1" };

// Build once in offline mode (again only if the last build was not an offline one).
const mark = join(".next", "OFFLINE_BUILD");
if (!existsSync(mark) || readFileSync(mark, "utf8") !== "1") {
  console.log("Building the offline demo (a few minutes, once) …");
  const b = spawnSync(process.execPath, [next, "build"], { stdio: "inherit", env });
  if (b.status !== 0) process.exit(b.status ?? 1);
  writeFileSync(mark, "1");
}

const port = process.env.PORT || "3000";
console.log(`\nThe demo, without internet:  http://localhost:${port}/demo   (Ctrl+C to stop)\n`);
spawn(process.execPath, [next, "start", "-p", port], { stdio: "inherit", env }).on("exit", (c) => process.exit(c ?? 0));
