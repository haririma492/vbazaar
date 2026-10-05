// The shopping districts a Virtual Ride can join. Any two of them make a
// ride: `/vca/ride?from=<id>&to=<id>`. Adding a district is adding an entry
// here — nothing in the ride is written for a particular pair.
//
// Google 3D is only the TRANSPORT between our own scenes. A district's
// `entryScene` is OUR page (the procedural bazaar, a splat tour, a 360° walk,
// all served from R2 by our code); Google's imagery is streamed by Google's
// own API during the ride and never stored by us.

import type { LatLng, RideFraming } from "./camera";

export type RideDistrict = {
  id: string;
  name: { fa: string; en: string };
  location: LatLng;
  /** Our page for the district, or null while it has no scene yet. */
  entryScene: string | null;
  /** How the ride's camera frames this district on leaving and arriving. */
  rideArrival: RideFraming;
};

export const DISTRICTS: RideDistrict[] = [
  {
    id: "home",
    name: { fa: "بازار مجازی سرکوچه", en: "Sarekooche Virtual Bazaar" },
    // ⚠️ PLACEHOLDER: Mel Lastman Square, North York. The virtual bazaar has
    // no street address of its own yet — put the real "home" here.
    location: { lat: 43.7676, lng: -79.4142 },
    entryScene: "/vca",
    rideArrival: { altitude: 180, tilt: 65, range: 380 },
  },
  {
    id: "world-on-yonge",
    name: { fa: "ورلد آن یانگ", en: "World on Yonge" },
    // 7181–7191 Yonge St, just north of Steeles (approximate; check on the map).
    location: { lat: 43.8031, lng: -79.4196 },
    entryScene: null,
    rideArrival: { altitude: 190, heading: 200, tilt: 62, range: 320 },
  },
];

export function districtById(id: string | null | undefined): RideDistrict | null {
  return DISTRICTS.find((d) => d.id === id) ?? null;
}
