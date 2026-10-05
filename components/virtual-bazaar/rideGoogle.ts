/**
 * The Virtual Ride's calls into Google, each one optional: a ride whose
 * extra API is not enabled still flies, just less well.
 *
 * ⚠️ ONE BROWSER KEY, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (shared with the
 * butcher and coverage maps), baked in at build time; loaded by
 * `lib/maps/googleMaps.ts`. On it, enable:
 *   - Maps JavaScript API — the 3D city and Street View. Required.
 *   - Places API (New)    — the address box. Without it: "use my location" only.
 *   - Routes API          — fly along the roads. Without it: a straight line,
 *                           higher up, clear of towers.
 *   - Elevation API       — ground height, for landing at eye level. Without
 *                           it: the district's stored ground height.
 */

import type { LatLng } from "@/lib/virtualRide/flight";
import { importLibrary } from "@/lib/maps/googleMaps";

export { MAPS_KEY, loadMaps, importLibrary } from "@/lib/maps/googleMaps";

const plain = (p: any): LatLng => ({
  lat: typeof p.lat === "function" ? p.lat() : p.lat,
  lng: typeof p.lng === "function" ? p.lng() : p.lng,
});

/** The driving route's polyline, or null (Routes API off, no route, …). */
export async function roadRoute(origin: LatLng, destination: LatLng): Promise<LatLng[] | null> {
  try {
    const { Route } = await importLibrary("routes");
    const { routes } = await Route.computeRoutes({
      origin,
      destination,
      travelMode: "DRIVING",
      polylineQuality: "HIGH_QUALITY",
      fields: ["path"],
    });
    const path = routes?.[0]?.path;
    return path?.length ? path.map(plain) : null;
  } catch (e) {
    console.warn("Virtual ride: no road route, flying straight", e);
    return null;
  }
}

/** Ground heights (m above sea level) at evenly spaced points along `points`, or null. */
export async function groundAlong(points: LatLng[], samples: number): Promise<number[] | null> {
  try {
    const { ElevationService } = await importLibrary("elevation");
    const { results } = await new ElevationService().getElevationAlongPath({ path: points, samples });
    const hs = (results ?? []).map((r: any) => r.elevation);
    return hs.length === samples && hs.every(Number.isFinite) ? hs : null;
  } catch (e) {
    console.warn("Virtual ride: no elevation, using the district's ground height", e);
    return null;
  }
}

/** The nearest outdoor Street View spot within `radius` metres, or null. */
export async function streetSpot(
  near: LatLng,
  radius = 80,
  quiet = false,
): Promise<{ pano: string; location: LatLng } | null> {
  try {
    const { StreetViewService } = await importLibrary("streetView");
    const { data } = await new StreetViewService().getPanorama({
      location: near,
      radius,
      // Google's StreetViewSource / StreetViewPreference values are lowercase.
      // Several sources are an intersection: Google's own outdoor imagery only —
      // no indoor tours, no visitors' photo spheres.
      sources: ["google", "outdoor"],
      preference: "nearest",
    });
    const loc = data?.location;
    return loc?.pano && loc?.latLng ? { pano: loc.pano, location: plain(loc.latLng) } : null;
  } catch (e) {
    // ZERO_RESULTS (no Street View that close) lands here too.
    if (!quiet) console.warn("Virtual ride: no Street View spot near", near, e);
    return null;
  }
}
