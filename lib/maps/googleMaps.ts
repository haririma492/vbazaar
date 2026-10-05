/**
 * The Maps JavaScript API, loaded once per page — the Virtual Ride's 3D city
 * and Street View (`components/virtual-bazaar/rideGoogle.ts`) and the order
 * page's address suggestions (`components/order/AddressSuggest.tsx`).
 *
 * ⚠️ ONE BROWSER KEY, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (shared with the
 * butcher and coverage maps), baked in at build time. The address box needs
 * Places API (New) enabled on it; without it the fields are typed by hand.
 */

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

let mapsLoad: Promise<any> | null = null;

export function loadMaps(): Promise<any> {
  const w = window as any;
  if (!MAPS_KEY) return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set"));
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google);
  if (mapsLoad) return mapsLoad;
  mapsLoad = new Promise((resolve, reject) => {
    w.__skRideMapsReady = () => resolve(w.google);
    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}` +
      `&v=weekly&loading=async&region=CA&callback=__skRideMapsReady`;
    s.async = true;
    s.onerror = () => {
      mapsLoad = null;
      s.remove();
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(s);
  });
  return mapsLoad;
}

export async function importLibrary(name: string): Promise<any> {
  const google = await loadMaps();
  return google.maps.importLibrary(name);
}
