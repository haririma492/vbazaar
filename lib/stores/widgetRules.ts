// THE STORE'S WIDGET ON ITS OWN WEBSITE (owner, 2026-11-06: "a preview / widget is the verdict, lets build and place
// the widget code on the store page … only for operator with a flag … if we need the owner also to see it"; "this
// will apply to all stores, existing and new").
//
// A teaser of the store's place in the Virtual Bazaar, served from vbazaar.app and placed on the store's own site
// with two lines of code (`snippet`). It is a PREVIEW, never the store: a short silent loop of the Shelf Tour (or the
// store's product photos), the Virtual Bazaar's name, and one key that opens the real visit ON vbazaar.app. The walk,
// both tours and the basket are only ever on vbazaar.app (owner: "our moat and our business is the virtual store and
// that need to be protected with our brand by all means and we do not give it away for free").
//
// Pure: imports nothing, so `node --test` runs it.

export const WIDGET_ORIGIN = "https://vbazaar.app";

/** The two lines the store puts on its site: our script makes the frame; the link is there without scripts. */
export function snippet(slug: string, origin = WIDGET_ORIGIN): string {
  return [
    `<div data-vbazaar-store="${slug}"><a href="${origin}/w/${slug}/go" target="_blank" rel="noopener">Walk into our store in the Virtual Bazaar · vbazaar.app</a></div>`,
    `<script src="${origin}/widget.js" async></script>`,
  ].join("\n");
}

export type WidgetFacts = {
  live: boolean;
  walk: string | null;
  tourVideo: string | null;
  photos: string[];
  door: string | null;
};

export type WidgetPlan = {
  /** What plays: the Shelf Tour's silent loop, else the product photos in turn, else the store's name on a card. */
  preview: { kind: "video"; src: string } | { kind: "photos"; srcs: string[] } | { kind: "card" };
  /** Where the key goes (on vbazaar.app), and what it says. */
  go: string;
  say: { en: string; fa: string };
  soon: boolean;
};

export const PREVIEW_SECONDS = 20;
export const MAX_PREVIEW_PHOTOS = 12;

/**
 * What the widget shows. A store not published yet shows the preview with «Coming soon», and its key opens the
 * bazaar's front door, never a half-made store. A published one opens its Free Tour (the walk), or its Shelf Tour
 * when that is all it has.
 */
export function planWidget(slug: string, f: WidgetFacts): WidgetPlan {
  const photos = [...new Set([...(f.door ? [f.door] : []), ...f.photos.filter((u) => /^https:\/\//.test(u) || u.startsWith("/"))])].slice(0, MAX_PREVIEW_PHOTOS);
  const preview: WidgetPlan["preview"] = f.tourVideo ? { kind: "video", src: f.tourVideo } : photos.length ? { kind: "photos", srcs: photos } : { kind: "card" };
  if (!f.live || (!f.walk && !f.tourVideo)) return { preview, go: "/", soon: true, say: { en: "Coming soon to the Virtual Bazaar", fa: "به‌زودی در بازار مجازی" } };
  const go = f.walk ? `/vca/walk?v=${encodeURIComponent(f.walk)}` : `/vca/tour?s=${encodeURIComponent(slug)}`;
  return { preview, go, soon: false, say: { en: "Walk into our store", fa: "وارد فروشگاه ما شوید" } };
}

// ── Counting (views and clicks per store, per day) ───────────────────────────

export type WidgetStats = { views: number; clicks: number; days: Record<string, { views: number; clicks: number }>; sites: Record<string, number>; firstAt: string | null };
export const emptyStats = (): WidgetStats => ({ views: 0, clicks: 0, days: {}, sites: {}, firstAt: null });
const KEEP_DAYS = 90;
const MAX_SITES = 30;

/** The site the widget sits on, as a host name (from the frame's referrer); "" when unknown. */
export function siteOf(referrer: string | null | undefined): string {
  const v = String(referrer || "").trim();
  if (!v) return "";
  try { return new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "").slice(0, 80); } catch { return ""; }
}

/** One view or click added; the oldest days and the least-seen sites are let go. */
export function addHit(s: WidgetStats, kind: "view" | "click", at: Date, site = ""): WidgetStats {
  const day = at.toISOString().slice(0, 10);
  const d = { ...(s.days[day] ?? { views: 0, clicks: 0 }) };
  if (kind === "view") d.views++; else d.clicks++;
  const days = Object.fromEntries(Object.entries({ ...s.days, [day]: d }).sort(([a], [b]) => b.localeCompare(a)).slice(0, KEEP_DAYS));
  let sites = s.sites;
  if (site && kind === "view") {
    sites = { ...s.sites, [site]: (s.sites[site] ?? 0) + 1 };
    sites = Object.fromEntries(Object.entries(sites).sort(([, a], [, b]) => b - a).slice(0, MAX_SITES));
  }
  return { views: s.views + (kind === "view" ? 1 : 0), clicks: s.clicks + (kind === "click" ? 1 : 0), days, sites, firstAt: s.firstAt ?? at.toISOString() };
}

export function parseStats(raw: unknown): WidgetStats {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<WidgetStats>;
  return { views: Number(o.views) || 0, clicks: Number(o.clicks) || 0, days: o.days && typeof o.days === "object" ? o.days : {}, sites: o.sites && typeof o.sites === "object" ? o.sites : {}, firstAt: typeof o.firstAt === "string" ? o.firstAt : null };
}

/** May the store's owner see the widget card on their page? Only when the operator has switched it on. */
export const ownerSeesWidget = (s: { widgetForOwner?: boolean }) => s.widgetForOwner === true;
