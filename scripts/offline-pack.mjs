#!/usr/bin/env node
/**
 * FILL THE OFFLINE FOLDER for the demo without internet (founder, 2026-10-18:
 * "where I am going to demo there is no internet, how can I run a local
 * version of olgoo.com/demo"). Run it once WITH internet:
 *
 *   npm run offline:pack                 → into ./offline
 *   npm run offline:pack -- D:\demo      → into another folder
 *
 * It takes only what /demo opens — the start walk, the stores on /demo's keys,
 * every shop a door leads into, a store's other aisles, each walk's sound —
 * plus the walks file, the stores' product lists, the intro video and the 3D
 * store, all from olgoo.com's PUBLIC addresses (no bucket key). A file already
 * there whole is skipped, so running it again only fetches what changed or is
 * missing. Then `npm run offline` (scripts/offline.mjs) serves it.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// vbazaar.app and olgoo.com serve the same bucket (`/api/splats/config` gives the same base), and the
// stores made on vbazaar.app (nuttime) exist only there, so it is the default now.
const SITE = (process.env.SITE || "https://vbazaar.app").replace(/\/+$/, "");
const OUT = resolve(process.argv[2] || "offline");
/** The stores on /demo's keys besides the start walk (app/demo/DemoScreen.tsx). */
const DEMO_WALKS = [
  "scenes/chinastoreyoutube/Billstra-119-Hamburg-20539-Qm7OVO4braI-.mp4",
  "scenes/minesouta2/axman-4k-h264.mp4",
];
/**
 * The store pages /demo opens (its keys link to `/<slug>`). A store's kit is read from the
 * public `/api/kit/<slug>`: its photos are signed links that run out in 6 h, so each one is
 * taken into the folder and the saved kit points at the folder (`/api/offline/<key>`).
 */
const DEMO_STORES = ["nuttime"];
/** The R2 hosts a kit's links point at (signed private ones and the public `r2.dev` ones). */
const R2_HOST = /\.r2\.cloudflarestorage\.com$|\.r2\.dev$/;
const RAD_KEY = "scenes/demo/world-on-yonge-lod.rad";
const INTRO_KEY = "scenes/demo/vca-intro.mp4";

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
const fileOf = (key) => join(OUT, ...key.split("/"));

async function json(path) {
  const r = await fetch(`${SITE}${path}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`${path}: ${j.error || `HTTP ${r.status}`}`);
  return j;
}

function save(key, value) {
  mkdirSync(dirname(fileOf(key)), { recursive: true });
  writeFileSync(fileOf(key), JSON.stringify(value, null, 1));
  console.log(`  ✓ ${key}`);
}

/** A file to `key`, from `url` (redirects followed); skipped when already there whole. */
async function download(key, url) {
  const to = fileOf(key);
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`${key}: HTTP ${r.status}`);
  const size = Number(r.headers.get("content-length") || 0);
  if (existsSync(to) && size && statSync(to).size === size) {
    await r.body.cancel();
    console.log(`  = ${key} (${mb(size)}, already here)`);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  const part = `${to}.part`;
  let got = 0, shown = 0;
  const counted = Readable.fromWeb(r.body);
  counted.on("data", (c) => {
    got += c.length;
    if (got - shown > 64 * 1048576) {
      shown = got;
      process.stdout.write(`\r  … ${key}: ${mb(got)}${size ? ` of ${mb(size)}` : ""}   `);
    }
  });
  await pipeline(counted, createWriteStream(part));
  renameSync(part, to);
  process.stdout.write(`\r  ✓ ${key} (${mb(got)})${" ".repeat(20)}\n`);
}

/**
 * A JSON value with every R2 link in it taken into the folder (`take`) and replaced by the
 * folder's own address, `/api/offline/<key>`: the same object, read offline. Other links stay.
 */
async function localize(value, take) {
  if (typeof value === "string") {
    if (!/^https:\/\//.test(value)) return value;
    const u = new URL(value);
    if (!R2_HOST.test(u.hostname)) return value;
    const key = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    await take(key, value);
    return `/api/offline/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await localize(v, take));
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await localize(v, take);
    return out;
  }
  return value;
}

/** The start walk, as the walk page picks it (lib/splats/walks.ts `startOf`). */
function startOf(w) {
  if (w.start) return w.start;
  const inside = new Set(Object.values(w.walks).flatMap((walk) => walk.doors.map((d) => d.to)));
  return Object.entries(w.walks)
    .filter(([k, walk]) => /^scenes\//.test(k) && walk.doors.length && !inside.has(k))
    .sort((a, b) => b[1].doors.length - a[1].doors.length)[0]?.[0] ?? null;
}
const storeOf = (key) => { const s = key.split("/")[1] ?? ""; return s.replace(/-shelf-[a-z0-9-]*$/, "") || s; };

async function main() {
  console.log(`Filling ${OUT} from ${SITE} …`);
  const said = (await json("/api/splats/config")).base;
  if (!said) throw new Error("olgoo.com did not say where its videos are");
  const base = new URL(said, `${SITE}/`).href.replace(/\/+$/, "");
  const { walks } = await json("/api/splats/walks");
  save("scenes/walks.json", walks);

  // One file that cannot be had is said and skipped; the rest still come.
  const missed = [];
  const take = (key, url) => download(key, url).catch((e) => { missed.push(key); console.log(`\n  ✗ ${e.message}`); });

  // The stores on /demo's keys: their kit (photos taken into the folder), and the walk each one opens.
  const kitWalks = [];
  for (const slug of DEMO_STORES) {
    const kit = await json(`/api/kit/${slug}`).then((j) => j.kit).catch((e) => { console.log(`  ✗ ${slug}: ${e.message}`); return null; });
    if (!kit) { missed.push(`stores/${slug}`); continue; }
    console.log(`${slug}: its kit and photos …`);
    const local = await localize(kit, take);
    save(`stores/${slug}/offline-kit.json`, { ok: true, kit: local });
    // The store's record, as the store page reads it (`readStore`): its slug, name and walk. No password.
    save(`stores/${slug}/store.json`, { slug, name: kit.title, passwordHash: "offline", out: { walk: kit.walk } });
    if (kit.walk) kitWalks.push(kit.walk);
  }

  // What /demo can reach: its walks, every door's shop, a store's other aisles.
  const todo = [startOf(walks), ...DEMO_WALKS, ...kitWalks].filter(Boolean);
  const keys = new Set();
  const stores = new Set();
  while (todo.length) {
    const key = todo.pop();
    if (keys.has(key)) continue;
    keys.add(key);
    const walk = walks.walks[key];
    for (const d of walk?.doors ?? []) if (d.to) todo.push(d.to);
    if (key.startsWith("scenes/")) {
      const store = storeOf(key);
      if (!stores.has(store)) {
        stores.add(store);
        const { aisles } = await json(`/api/splats/store?store=${encodeURIComponent(store)}`).catch(() => ({ aisles: [] }));
        for (const a of aisles ?? []) todo.push(a.key);
      }
    }
  }

  for (const store of stores) {
    const { catalogue } = await json(`/api/splats/catalogue?store=${encodeURIComponent(store)}`).catch(() => ({ catalogue: null }));
    if (catalogue) save(`scenes/catalogues/${store}.json`, catalogue);
  }

  for (const key of keys) {
    const walk = walks.walks[key];
    const rev = walk?.rev ? `?r=${walk.rev}` : "";
    if (key.startsWith("masters/")) await take(key, `${SITE}/api/splats/walks/video?key=${encodeURIComponent(key)}`);
    // The walk videos are private (lib/splats/media.ts): fetched through the site's own route, which signs a link.
    else if (/\.(mp4|mov|m4v|webm)$/i.test(key)) await take(key, `${SITE}/api/media/${key}${rev}`);
    else await take(key, `${base}/${key}${rev}`);
    if (walk?.audio) await take(walk.audio, `${base}/${walk.audio}`);
  }

  console.log("The intro video …");
  await take(INTRO_KEY, `${SITE}/api/demo/intro`);

  console.log("The 3D store …");
  for (let i = 0; i < 60; i++) {
    const s = await fetch(`${SITE}/api/demo/store-3d`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ state: "failed", error: "unreachable" }));
    if (s.state === "done" && s.url) { await take(RAD_KEY, new URL(s.url, `${SITE}/`).href); break; }
    if (s.state === "failed") { console.log(`  ✗ not taken: ${s.error}`); break; }
    if (i === 0) console.log("  (olgoo.com is preparing it — about a minute)");
    await new Promise((ok) => setTimeout(ok, 5000));
  }

  if (missed.length) console.log(`\n⚠️ Not taken (run again with internet, or they will be missing at the demo):\n  ${missed.join("\n  ")}`);
  console.log(`\nDone: ${keys.size - missed.length} of ${keys.size} walk files, ${stores.size} store(s). Now, without internet:  npm run offline`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\nCheck the internet connection and run it again: what is already here is kept.`);
  process.exit(1);
});
