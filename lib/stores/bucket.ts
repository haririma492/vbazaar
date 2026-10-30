/**
 * The stores in the bucket (masters, private): one record per store
 * (`storeKey`) and the index the operator's list reads (`STORES_INDEX_KEY`).
 *
 * ⚠️ ONE WRITER AT A TIME. The page's routes and the crew both change a
 * record; every change goes through `updateStore`, which reads, changes and
 * writes under a lock per store, so neither overwrites the other. (One
 * server runs the site; a second would need R2's conditional writes.)
 * Server only.
 */

import { readMastersText, writeMastersJson } from "@/lib/splats/r2";
import { BAZAAR_KEY, parseBazaar, type Bazaar } from "./bazaar";
import { STORES_INDEX_KEY, parseStore, storeKey, type StoreRecord } from "./store";

export type IndexEntry = { slug: string; name: { en: string; fa: string }; createdAt: string };

const locks = new Map<string, Promise<unknown>>();

function locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(name, run.catch(() => undefined));
  return run;
}

export async function readStore(slug: string): Promise<StoreRecord | null> {
  const text = await readMastersText(storeKey(slug));
  if (!text) return null;
  try {
    return parseStore(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Read, change and write one store under its lock. `fn` returns the new record (or null to leave it). */
export function updateStore(slug: string, fn: (s: StoreRecord) => StoreRecord | null | Promise<StoreRecord | null>): Promise<StoreRecord | null> {
  return locked(`store:${slug}`, async () => {
    const s = await readStore(slug);
    if (!s) return null;
    const next = await fn(s);
    if (!next) return s;
    await writeMastersJson(storeKey(slug), next);
    return next;
  });
}

export async function readIndex(): Promise<IndexEntry[]> {
  const text = await readMastersText(STORES_INDEX_KEY);
  try {
    const raw = JSON.parse(text || "[]");
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.slug === "string") : [];
  } catch {
    return [];
  }
}

/** A new store: its record, then its line in the index. False when the address is taken. */
export function createStore(s: StoreRecord): Promise<boolean> {
  return locked("index", async () => {
    const index = await readIndex();
    if (index.some((e) => e.slug === s.slug) || (await readStore(s.slug))) return false;
    await writeMastersJson(storeKey(s.slug), s);
    await writeMastersJson(STORES_INDEX_KEY, [...index, { slug: s.slug, name: s.name, createdAt: s.createdAt }]);
    return true;
  });
}

/** The index's name kept in step with the record's. */
export function renameInIndex(slug: string, name: { en: string; fa: string }): Promise<void> {
  return locked("index", async () => {
    const index = await readIndex();
    const i = index.findIndex((e) => e.slug === slug);
    if (i < 0 || (index[i].name.en === name.en && index[i].name.fa === name.fa)) return;
    index[i] = { ...index[i], name };
    await writeMastersJson(STORES_INDEX_KEY, index);
  });
}

// ── The bazaar's areas and hallway spots (`bazaar.ts`) ──────────────────────

export async function readBazaar(): Promise<Bazaar> {
  const text = await readMastersText(BAZAAR_KEY);
  try {
    return parseBazaar(text ? JSON.parse(text) : null);
  } catch {
    return parseBazaar(null);
  }
}

export function updateBazaar(fn: (b: Bazaar) => Bazaar | Promise<Bazaar>): Promise<Bazaar> {
  return locked("bazaar", async () => {
    const next = await fn(await readBazaar());
    await writeMastersJson(BAZAAR_KEY, next);
    return next;
  });
}
