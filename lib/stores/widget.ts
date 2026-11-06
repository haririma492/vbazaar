// THE STORE'S WIDGET, server half (rules: `widgetRules.ts`). For every store, existing and new: nothing here is
// set up per store. `/w/<slug>` is the preview the store's site frames (through `/widget.js`), `/w/<slug>/go` the
// key (counted, then on to vbazaar.app), `/api/w/<slug>` counts a view. Counts: `stores/<slug>/widget-stats.json`.
import { readCatalogue, readMastersText, readWalks, writeMastersJson } from "@/lib/splats/r2";
import { doorPhotoOf } from "@/lib/splats/walks";
import { readStore } from "./bucket";
import { sceneOf } from "./store";
import { readTour } from "./tourJob";
import { previewFor } from "./widgetPreview";
import { addHit, emptyStats, parseStats, planWidget, type WidgetPlan, type WidgetStats } from "./widgetRules";

export const statsKey = (slug: string) => `stores/${slug}/widget-stats.json`;

export async function widgetPlan(slug: string): Promise<(WidgetPlan & { name: { en: string; fa: string } }) | null> {
  const s = await readStore(slug);
  if (!s) return null;
  const [cat, walks, tour] = await Promise.all([
    readCatalogue(sceneOf(slug)).catch(() => null),
    readWalks().catch(() => null),
    readTour(slug).catch(() => null),
  ]);
  const walk = s.out.walk ?? null;
  const door = s.out.doorImage ?? (walks ? doorPhotoOf(walks, walk) : undefined) ?? null;
  const photos = (cat?.products ?? []).map((p) => p.photo).filter((u): u is string => Boolean(u));
  const freeTour = await previewFor(slug, walk).catch(() => null);
  const plan = planWidget(slug, { live: s.live, walk, tourVideo: tour?.video ?? null, freeTour, photos, door });
  return { ...plan, name: s.name };
}

export async function readStats(slug: string): Promise<WidgetStats> {
  try { const t = await readMastersText(statsKey(slug)); return t ? parseStats(JSON.parse(t)) : emptyStats(); } catch { return emptyStats(); }
}

// Hits are gathered in memory and written at most every 20 s a store: a page with many visitors must not write the
// bucket on every view. A restart loses at most those 20 s (one server runs the site).
const pending = new Map<string, Array<{ kind: "view" | "click"; at: Date; site: string }>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function hit(slug: string, kind: "view" | "click", site = ""): void {
  const list = pending.get(slug) ?? [];
  if (list.length > 5000) return; // a flood is not counted further until the next write
  list.push({ kind, at: new Date(), site });
  pending.set(slug, list);
  if (timers.has(slug)) return;
  timers.set(slug, setTimeout(() => { timers.delete(slug); void flush(slug); }, 20_000));
}

async function flush(slug: string) {
  const list = pending.get(slug) ?? [];
  pending.delete(slug);
  if (!list.length) return;
  try {
    let s = await readStats(slug);
    for (const h of list) s = addHit(s, h.kind, h.at, h.site);
    await writeMastersJson(statsKey(slug), s);
  } catch (e) { console.error("[widget] stats", slug, e); }
}
