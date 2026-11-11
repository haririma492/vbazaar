/**
 * A FLAT VIDEO'S LENS — what lets the Store Builder crew work on an ordinary
 * (not 360°) video (owner, 2026-11-11: "lets accept non-360 flat .mp4 s as
 * well I am experiencing with flat videos with twice or 3 times PPD to
 * replace the 360 videos").
 *
 * The crew thinks in DIRECTIONS (`lon`, `lat`, radians: where a product is
 * round the camera), because a 360° walk is a sphere. A flat video is one
 * normal camera view: every pixel of it is a direction too, inside the
 * camera's field of view. So a flat walk carries its lens (`Walk.lens`: how
 * wide and tall it sees), and with it:
 *
 *   crew      looks, sightings, follows and photos stay in directions; ffmpeg
 *             cuts its views out of the flat frame (`v360In`), our own code
 *             reads a direction's pixel (`flatFrac`)
 *   shoppers  the walk page puts a flat video's lights at FRACTIONS of the
 *             frame (`ItemPin`, x from the left, y from the top), so a light
 *             is turned into fractions as it is saved (`pinsToFlat`,
 *             `sizeToFlat`) and back when the crew reads it (`pinsFromFlat`)
 *
 * ⚠️ THE FIELD OF VIEW IS ASSUMED (`FLAT_LONG_FOV` along the frame's long
 * side: a phone's main camera). It only has to be the SAME number both ways:
 * a wrong one puts no light in the wrong place, it only makes the crew's
 * views a little wider or narrower than they say. It is kept on the walk, so
 * changing the number here never moves a walk already made.
 *
 * Checked against ffmpeg (a mark at four places of a 1920×1080 frame, a view
 * aimed at `flatDir` of each: the mark in the view's middle to 0.1 px).
 *
 * Pure: `node --test` runs it.
 */

export type FlatLens = { hfov: number; vfov: number };

/** The field of view along a flat video's longer side (radians): 70°, a phone's main camera filming. */
export const FLAT_LONG_FOV = (70 * Math.PI) / 180;

/** The lens of a flat video `width`×`height` pixels. */
export function flatLens(width: number, height: number, longFov = FLAT_LONG_FOV): FlatLens {
  const w = width > 0 ? width : 16, h = height > 0 ? height : 9;
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  if (w >= h) return { hfov: r5(longFov), vfov: r5(2 * Math.atan((Math.tan(longFov / 2) * h) / w)) };
  return { hfov: r5(2 * Math.atan((Math.tan(longFov / 2) * w) / h)), vfov: r5(longFov) };
}

/** A lens as read from a file: sound, or null. */
export function parseLens(v: unknown): FlatLens | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0.05 && x <= 2.8;
  return ok(o.hfov) && ok(o.vfov) ? { hfov: o.hfov, vfov: o.vfov } : null;
}

/** Width over height of the picture this lens sees. */
export const lensAspect = (lens: FlatLens) => Math.tan(lens.hfov / 2) / Math.tan(lens.vfov / 2);

/** Where a direction is in the flat frame: x from the left, y from the top, 0…1 inside it (far outside for a direction behind the camera). */
export function flatFrac(lon: number, lat: number, lens: FlatLens): { x: number; y: number } {
  const cl = Math.cos(lat);
  const x = cl * Math.sin(lon), y = Math.sin(lat), z = cl * Math.cos(lon);
  if (z <= 1e-6) return { x: x >= 0 ? 9 : -9, y: y >= 0 ? -9 : 9 };
  return { x: 0.5 + x / z / (2 * Math.tan(lens.hfov / 2)), y: 0.5 - y / z / (2 * Math.tan(lens.vfov / 2)) };
}

/** The direction through a place in the flat frame (fractions). */
export function flatDir(x: number, y: number, lens: FlatLens): { lon: number; lat: number } {
  const u = (2 * x - 1) * Math.tan(lens.hfov / 2), v = (1 - 2 * y) * Math.tan(lens.vfov / 2);
  return { lon: Math.atan2(u, 1), lat: Math.atan2(v, Math.hypot(u, 1)) };
}

/** Whether a direction is inside the frame, at least `margin` (a fraction of it) from its edge. */
export function inFlat(lon: number, lat: number, lens: FlatLens, margin = 0): boolean {
  const p = flatFrac(lon, lat, lens);
  return p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin;
}

/** ffmpeg's v360 input for a walk: the panorama, or the flat frame with its lens. */
export function v360In(lens?: FlatLens | null): string {
  if (!lens) return "input=e";
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(3);
  return `input=flat:ih_fov=${deg(lens.hfov)}:iv_fov=${deg(lens.vfov)}`;
}

type Pin = { t: number; x: number; y: number };
type Size = { w: number; h: number };
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** A light's pins as the walk page wants them on a flat video: fractions of the frame. */
export const pinsToFlat = (pins: Pin[], lens: FlatLens): Pin[] => pins.map((p) => {
  const f = flatFrac(p.x, p.y, lens);
  return { t: p.t, x: r4(f.x), y: r4(f.y) };
});

/** A flat walk's pins as the crew wants them: directions. */
export const pinsFromFlat = (pins: Pin[], lens: FlatLens): Pin[] => pins.map((p) => {
  const d = flatDir(p.x, p.y, lens);
  return { t: p.t, x: r4(d.lon), y: r4(d.lat) };
});

/** A product's outline (radians across and up, round the direction `at`) as fractions of the frame. */
export function sizeToFlat(size: Size, at: { lon: number; lat: number }, lens: FlatLens): Size {
  const half = size.w / 2 / Math.max(0.2, Math.cos(at.lat));
  const l = flatFrac(at.lon - half, at.lat, lens), r = flatFrac(at.lon + half, at.lat, lens);
  const t = flatFrac(at.lon, at.lat + size.h / 2, lens), b = flatFrac(at.lon, at.lat - size.h / 2, lens);
  const clamp = (v: number) => r4(Math.min(1, Math.max(0.002, Math.abs(v))));
  return { w: clamp(r.x - l.x), h: clamp(b.y - t.y) };
}

/** The other way: an outline in fractions round the place `at` (fractions), in radians. */
export function sizeFromFlat(size: Size, at: { x: number; y: number }, lens: FlatLens): Size {
  const l = flatDir(at.x - size.w / 2, at.y, lens), r = flatDir(at.x + size.w / 2, at.y, lens);
  const t = flatDir(at.x, at.y - size.h / 2, lens), b = flatDir(at.x, at.y + size.h / 2, lens);
  const r3 = (v: number) => Math.round(Math.min(1.5, Math.max(0.01, Math.abs(v))) * 1000) / 1000;
  return { w: r3((r.lon - l.lon) * Math.cos((l.lat + r.lat) / 2)), h: r3(t.lat - b.lat) };
}

/**
 * The views the crew looks through on a flat video: square views `fov` wide,
 * in a grid that covers the whole frame edge to edge (each a heading and a
 * pitch inside the lens). Narrow views keep the video's own sharpness: the
 * reason for filming flat.
 */
export function flatLooks(lens: FlatLens, fov: number): Array<{ heading: number; pitch: number; id: string }> {
  const along = (span: number) => {
    const n = Math.max(1, Math.ceil((span - fov * 0.15) / (fov * 0.85)));
    const reach = Math.max(0, (span - fov) / 2);
    return n === 1 ? [0] : Array.from({ length: n }, (_, i) => -reach + (2 * reach * i) / (n - 1));
  };
  const out: Array<{ heading: number; pitch: number; id: string }> = [];
  const rows = along(lens.vfov).reverse(), cols = along(lens.hfov);
  for (const [r, pitch] of rows.entries()) for (const [c, heading] of cols.entries()) out.push({ heading, pitch, id: `r${r + 1}c${c + 1}` });
  return out;
}

/** What an agent made for 360° walks says of a flat one. */
export const flatNotYet = (what: string) => `This store's video is flat (not 360°): ${what} is made for 360° walks only, for now. The walk, its lights, the product photos and the basket work.`;
