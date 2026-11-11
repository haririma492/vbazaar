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
// ⚠️ CHANGED BY THE OWNER, 2026-11-11: "instead of the texts and the yellow key … add the wheel so viewers can adjust
// the speed and look around and listen to the music the widget has to perform exactly like the free tour"; "there
// should not be an active link everywhere on the window, the active link should only be on the top left logo (the
// arch)"; "for all stores the widget should work the same". A store with a walk now plays the Free Tour itself in
// the frame (`components/stores/WidgetWalk.tsx`, `Walk360` `embed`). What stays on vbazaar.app: the product cards,
// the basket and the Shelf Tour. The plan below is what a store with NO walk yet shows, and where the arch leads.
//

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
  /** The Free Tour's sneak preview (`widgetPreview.ts`): the walk's first seconds as a forward view, with its music. */
  freeTour?: { src: string; sound: boolean } | null;
  photos: string[];
  door: string | null;
};

export type WidgetPlan = {
  /** What plays: the Shelf Tour's silent loop, else the product photos in turn, else the store's name on a card. */
  preview: { kind: "video"; src: string; sound?: boolean } | { kind: "photos"; srcs: string[] } | { kind: "card" };
  /** Where the key goes (on vbazaar.app), and what it says. */
  go: string;
  say: { en: string; fa: string };
  soon: boolean;
};

export const PREVIEW_SECONDS = 20;
export const MAX_PREVIEW_PHOTOS = 12;

/**
 * What the widget shows: the Free Tour's sneak preview (with its music) when it is made, else the Shelf Tour's
 * silent loop, else the door and product photos. A store not published yet shows the preview with «Coming soon», and its key opens the
 * bazaar's front door, never a half-made store. A published one opens its Free Tour (the walk), or its Shelf Tour
 * when that is all it has.
 */
export function planWidget(slug: string, f: WidgetFacts): WidgetPlan {
  const photos = [...new Set([...(f.door ? [f.door] : []), ...f.photos.filter((u) => /^https:\/\//.test(u) || u.startsWith("/"))])].slice(0, MAX_PREVIEW_PHOTOS);
  // The Free Tour's preview first (owner, 2026-11-06), then the Shelf Tour's silent loop, then the photos.
  const preview: WidgetPlan["preview"] = f.freeTour ? { kind: "video", src: f.freeTour.src, sound: f.freeTour.sound }
    : f.tourVideo ? { kind: "video", src: f.tourVideo } : photos.length ? { kind: "photos", srcs: photos } : { kind: "card" };
  if (!f.live || (!f.walk && !f.tourVideo)) return { preview, go: "/", soon: true, say: { en: "Coming soon to the Virtual Bazaar", fa: "به‌زودی در بازار مجازی" } };
  const go = f.walk ? `/walk/${slug}` : `/vca/tour?s=${encodeURIComponent(slug)}`;
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

// ── The widget's settings, kept on OUR side (owner, 2026-11-11: "make sure that we can change everything from our
// side (vbazaar) and not having to change anything on the widget code, the customer only place the code once").
// The two lines on the store's site never change: `/widget.js` (served fresh every time) asks `/api/w/<slug>` for
// these before it draws anything. An attribute on the store's own <div> is only what is used if that answer fails.

export type WidgetSettings = {
  /** Shown at all (off: nothing is drawn on the store's site). */
  on: boolean;
  /** "top": under the site's header, wherever the code was pasted. "here": inside the store's own <div>. */
  place: "top" | "here";
  /** Its widest, in pixels (always 4:3; narrower on a small screen). */
  width: number;
  lang: "fa" | "en";
};
export const WIDGET_DEFAULTS: WidgetSettings = { on: true, place: "top", width: 480, lang: "fa" };
export const WIDGET_WIDTHS = { min: 240, max: 1200 };

/** Whatever was stored or sent, made safe: unknown values fall back to the defaults, the width is kept in range. */
export function widgetSettings(raw: unknown): WidgetSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const w = Math.round(Number(o.width));
  return {
    on: o.on !== false,
    place: o.place === "here" ? "here" : "top",
    width: Number.isFinite(w) && w > 0 ? Math.min(WIDGET_WIDTHS.max, Math.max(WIDGET_WIDTHS.min, w)) : WIDGET_DEFAULTS.width,
    lang: o.lang === "en" ? "en" : "fa",
  };
}

/** May the store's owner see the widget card on their page? Only when the operator has switched it on. */
export const ownerSeesWidget = (s: { widgetForOwner?: boolean }) => s.widgetForOwner === true;

// ── Where the sneak preview looks: away from the camera operator (owner, 2026-11-06: "this sneak preview is pre lock
// agent so it shows me when recording … fix it"). The Lock agent does not change the video; it records where the
// operator is (`Walk.hide`, a zone that moves through the walk). The preview is a FIXED forward view, so it is aimed
// opposite that zone and checked every half second: the zone must stay out of the frame, with a margin. If it would
// come in, the view narrows (down to 70°), then the clip is cut short where it would (never under 8 s).

export type Zone = { yaw: number; width: number };
const TAU = Math.PI * 2;
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
export const PREVIEW_FOV = 100 * (Math.PI / 180);
const MIN_FOV = 70 * (Math.PI / 180);
const MARGIN = 8 * (Math.PI / 180);
export const MIN_PREVIEW_SECONDS = 8;

/** The direction (radians, the video's frame), view width and length of a preview that never shows the operator. */
export function previewAim(zoneAt: ((t: number) => Zone) | null, seconds = PREVIEW_SECONDS): { yaw: number; hfov: number; seconds: number } {
  if (!zoneAt) return { yaw: 0, hfov: PREVIEW_FOV, seconds };
  const ts: number[] = [];
  for (let t = 0; t <= seconds + 1e-9; t += 0.5) ts.push(Math.round(t * 10) / 10);
  // Opposite the operator, averaged round the circle over the clip.
  let x = 0, y = 0;
  for (const t of ts) { const z = zoneAt(t); x += Math.cos(z.yaw + Math.PI); y += Math.sin(z.yaw + Math.PI); }
  const yaw = wrap(Math.atan2(y, x));
  const clear = (t: number, hfov: number) => { const z = zoneAt(t); return Math.abs(wrap(z.yaw - yaw)) >= hfov / 2 + z.width / 2 + MARGIN; };
  for (let hfov = PREVIEW_FOV; hfov >= MIN_FOV - 1e-9; hfov -= 5 * (Math.PI / 180)) {
    const bad = ts.find((t) => !clear(t, hfov));
    if (bad === undefined) return { yaw, hfov, seconds };
    if (hfov - 5 * (Math.PI / 180) < MIN_FOV - 1e-9 && bad >= MIN_PREVIEW_SECONDS + 0.5) return { yaw, hfov, seconds: bad - 0.5 };
  }
  return { yaw, hfov: MIN_FOV, seconds: 0 }; // no clear view: no preview (the widget falls back)
}
