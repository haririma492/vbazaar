// THE STORE'S OWN GOOGLE LISTING PHOTOS (owner, 2026-11-23: "you only need these photos, no search needed at all":
// the photos behind «See photos» on the store's Google Business listing). Places API (New): find the store's place by
// its name and street, take its photos, copy each into our bucket (`website.ts` `copyPhoto`).
// Uses NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (the same key the address box uses; Places API (New) must be on for it).
// Google's photo terms: keep the authors' attributions with the photos (returned as `by`).
// Docs: https://developers.google.com/maps/documentation/places/web-service/place-photos
import { copyPhoto } from "./website";
import { createHash } from "node:crypto";
import { r2Config } from "@/lib/splats/r2";
import { sceneOf } from "./store";
import type { GoogleRunEntry } from "./googlePhotosRules";

const TIMEOUT_MS = 20_000;
const MAX_PHOTOS = 100;
const key = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

type Place = { id?: string; displayName?: { text?: string }; formattedAddress?: string; photos?: { name?: string; authorAttributions?: { displayName?: string }[] }[] };

/** The place for the store: its name matched first, else the top result of the search by name and street. */
export async function findPlace(name: string, address: string): Promise<Place | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key(), "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.photos" },
    body: JSON.stringify({ textQuery: `${name} ${address}`.trim(), maxResultCount: 5 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { places?: Place[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Places answered ${res.status}: ${body.error?.message ?? "no reason given"}`);
  const places = body.places ?? [];
  const want = fold(name);
  return places.find((p) => want && fold(p.displayName?.text ?? "").includes(want)) ?? places[0] ?? null;
}

/** A photo's address that the browser can show, from its Places name (short-lived, so it is copied at once). */
async function photoUri(photoName: string): Promise<string> {
  const res = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1600&skipHttpRedirect=true`, {
    headers: { "x-goog-api-key": key() }, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { photoUri?: string; error?: { message?: string } };
  if (!res.ok || !body.photoUri) throw new Error(`photo answered ${res.status}: ${body.error?.message ?? "no address"}`);
  return body.photoUri;
}

/** The store's listing photos, copied into our bucket, with their authors. */
export async function listingPhotos(slug: string, name: string, address: string): Promise<GoogleRunEntry & { by: string[] }> {
  const at = new Date().toISOString();
  const place = await findPlace(name, address);
  if (!place) return { q: `${name} ${address}`, photos: [], at, found: 0, by: [] };
  const photos = (place.photos ?? []).filter((p) => p.name).slice(0, MAX_PHOTOS);
  const base = r2Config().publicBase;
  const out: string[] = [];
  const by = new Set<string>();
  for (const p of photos) {
    try {
      const uri = await photoUri(p.name!);
      const k = `scenes/catalogues/${sceneOf(slug)}/gl-${createHash("sha1").update(p.name!).digest("hex").slice(0, 16)}.jpg`;
      if (await copyPhoto(uri, k)) out.push(`${base}/${k}`);
      for (const a of p.authorAttributions ?? []) if (a.displayName) by.add(a.displayName);
    } catch (e) { console.error("[google] listing photo", (e as Error).message); }
  }
  return { q: place.displayName?.text ?? name, photos: out, at, found: photos.length, by: [...by] };
}
