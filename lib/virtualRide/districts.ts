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
  /**
   * The place itself — its entrance. The ride lands on the nearest street
   * spot Google has Street View for, and the rider stands facing this.
   */
  location: LatLng;
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
    // 7181–7191 Yonge St, just north of Steeles, east side (approximate).
    location: { lat: 43.8031, lng: -79.4196 },
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
