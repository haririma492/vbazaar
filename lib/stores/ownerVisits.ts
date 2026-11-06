/**
 * HOW OFTEN A STORE'S OWNER COMES (owner, 2026-11-06: "we need to count store owners using their password and
 * visiting their page", then "lets add that statistics to vbazaar.app/stores"). Per store, in
 * `stores/<slug>/owner-visits.json` (masters bucket): sign-ins with the store's password, and visits to the
 * store's page by its owner (the operator is never counted).
 *
 * ⚠️ A VISIT IS A SITTING, NOT A REQUEST. The store's page asks the server again every 8 s, so a visit counts once,
 * then not again until 30 min pass with no request (`VISIT_GAP_MS`). A sign-in always counts. Each visit is one
 * record (`sessions`, newest first) with when it began and how long the owner stayed, stored about once a minute.
 */
import { readMastersText, writeMastersJson } from "@/lib/splats/r2";
const key = (slug: string) => `stores/${slug}/owner-visits.json`;

import { VISIT_GAP_MS, addEvent, empty, type OwnerEvent, type OwnerVisits } from "./ownerVisitsRules";
export { VISIT_GAP_MS, type OwnerVisits } from "./ownerVisitsRules";
/** The last moment each store's owner was seen, in this server (so a poll every 8 s costs no read). */
const seen = new Map<string, number>();
/** When this server last stored a visit's end: once a minute at most (the stay is to the minute). */
const written = new Map<string, number>();
const WRITE_EVERY_MS = 60_000;
const queue = new Map<string, Promise<void>>();

export async function readOwnerVisits(slug: string): Promise<OwnerVisits> {
  try { const t = await readMastersText(key(slug)); return t ? { ...empty(), ...(JSON.parse(t) as OwnerVisits) } : empty(); } catch { return empty(); }
}

/** Record one; never throws (counting must never stop an owner opening their page). One write at a time per store. */
export function recordOwner(slug: string, kind: OwnerEvent["kind"], now = new Date()): void {
  const last = seen.get(slug) ?? 0;
  seen.set(slug, now.getTime());
  // The page asks every 8 s: inside a sitting this server already knows about, the stay is stored once a minute.
  if (kind === "visit" && now.getTime() - last < VISIT_GAP_MS && now.getTime() - (written.get(slug) ?? 0) < WRITE_EVERY_MS) return;
  written.set(slug, now.getTime());
  const run = (queue.get(slug) ?? Promise.resolve()).then(async () => {
    // After a restart the memory is empty: the stored last visit still decides (in `addEvent`).
    const next = addEvent(await readOwnerVisits(slug), kind, now, kind === "visit" ? last : 0);
    if (next) await writeMastersJson(key(slug), next);
  }).catch((e) => console.error("[owner-visits]", slug, e));
  queue.set(slug, run);
}
