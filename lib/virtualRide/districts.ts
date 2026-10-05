// The shopping districts a Virtual Ride can take someone to, from the
// address they type. Adding a district is adding an entry here — nothing in
// the ride is written for a particular place. `/vca/ride?to=<id>` preselects.
//
// Google 3D is only the TRANSPORT to our own scenes. A district's
// `entryScene` is OUR page (the procedural bazaar, a splat tour, a 360° walk,
// all served from R2 by our code); Google's imagery is streamed by Google's
// own API during the ride and never stored by us.

import type { LatLng } from "./flight";

export type RideDistrict = {
  id: string;
  name: { fa: string; en: string };
  /** The place itself — its entrance. */
  location: LatLng;
  /**
   * Where the ride lands: a Google Street View spot on the street outside,
   * and the way to face there (as in a Google Maps Street View link:
   * `@lat,lng,…,<heading>h`). Unset: the Street View spot nearest
   * `location`, facing it — a guess that can land on the wrong side of a
   * street, or inside a building.
   */
  street?: { lat: number; lng: number; heading: number };
  /** Ground height there in metres above sea level, used when Google's Elevation API is unavailable. */
  groundAltitude: number;
  /** Our page for the district, or null while it has no scene yet. */
  entryScene: string | null;
  /**
   * true: the ride lands at eye level outside and goes straight into
   * `entryScene` at its start. false: it lands in Street View to walk on,
   * with an «Enter» link to `entryScene` if there is one.
   */
  enterOnArrival: boolean;
};

export const DISTRICTS: RideDistrict[] = [
  {
    id: "world-on-yonge",
    name: { fa: "ورلد آن یانگ", en: "World on Yonge" },
    // The towers on the east side of Yonge, just north of Steeles.
    location: { lat: 43.80288, lng: -79.42093 },
    // On Yonge in front of 7171 Yonge St, facing the «World on Yonge» sign
    // (the operator's Street View, 2026-10-05: @43.8027855,-79.4212847, 69.91h).
    street: { lat: 43.8027855, lng: -79.4212847, heading: 69.91 },
    groundAltitude: 190,
    // The splat tour's hallway was filmed here (operator, 2026-10-05): the
    // ride lands outside and the tour opens at its start scene.
    entryScene: "/vca/splat",
    enterOnArrival: true,
  },
];

export function districtById(id: string | null | undefined): RideDistrict | null {
  return DISTRICTS.find((d) => d.id === id) ?? null;
}
