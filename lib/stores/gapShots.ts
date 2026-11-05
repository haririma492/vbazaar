// THE SHELF FINDER ON EVERY SHELF (owner, 2026-11-05: "much better, lets extend
// to all shelves, there are only 12 now"). Pure (tested in gapShots.test.ts).
//
// The Shelf finder used to look only where the Shelf Tour already stopped (one
// picture per tour clip), so a bookcase the tour never stopped at was never
// pictured and never became a shelf. Here, the products the walk DID see (the
// finder's sightings, each light's middle) but that no shelf picture holds yet
// are grouped into pictures:
//   - the seed of a picture is an unpictured product where it was seen
//     biggest (the camera closest);
//   - the picture takes every unpictured product seen within `SHOT_DT` s of
//     that moment and within `SHOT_REACH` of its direction;
//   - aimed at their middle, `SHOT_HFOV` wide, 16:9;
//   - pictures with more products first; at most `max` (each one is a paid
//     look, so the caller names the ceiling); a lone straggler is not worth a
//     picture (`SHOT_MIN`).
// Inside the store only (from `entry`).

export type Obs = { n: number; t: number; lon: number; lat: number; area: number };
export type Shot = { t: number; yaw: number; pitch: number; hfov: number; vfov: number; products: number[] };

export const SHOT_DT = 1.5, SHOT_REACH = 0.45, SHOT_MIN = 2;
export const SHOT_HFOV = (60 * Math.PI) / 180;
export const SHOT_VFOV = 2 * Math.atan(Math.tan(SHOT_HFOV / 2) * (882 / 1568));
/** A picture is never aimed further up or down than this (rad): shelves are round the horizon. */
export const PITCH_MAX = 0.4;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function gapShots(obs: Obs[], pictured: Set<number>, entry: number, max: number): Shot[] {
  const left = obs.filter((o) => !pictured.has(o.n) && o.t >= entry - 0.5 && Number.isFinite(o.lon) && Number.isFinite(o.lat));
  const done = new Set<number>();
  const shots: Shot[] = [];
  // Seeds: each product's closest view, biggest first.
  const best = new Map<number, Obs>();
  for (const o of left) if (!best.has(o.n) || o.area > best.get(o.n)!.area) best.set(o.n, o);
  for (const seed of [...best.values()].sort((a, b) => b.area - a.area)) {
    if (done.has(seed.n)) continue;
    const near = new Map<number, Obs>();
    for (const o of left) {
      if (done.has(o.n) || Math.abs(o.t - seed.t) > SHOT_DT) continue;
      if (Math.abs(wrap(o.lon - seed.lon)) > SHOT_REACH || Math.abs(o.lat - seed.lat) > SHOT_REACH) continue;
      const had = near.get(o.n);
      if (!had || Math.abs(o.t - seed.t) < Math.abs(had.t - seed.t)) near.set(o.n, o);
    }
    if (near.size < SHOT_MIN) continue;
    const ms = [...near.values()];
    for (const m of ms) done.add(m.n);
    const yaw = wrap(seed.lon + ms.reduce((s, m) => s + wrap(m.lon - seed.lon), 0) / ms.length);
    const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, ms.reduce((s, m) => s + m.lat, 0) / ms.length));
    shots.push({ t: seed.t, yaw, pitch, hfov: SHOT_HFOV, vfov: SHOT_VFOV, products: ms.map((m) => m.n).sort((a, b) => a - b) });
  }
  return shots.sort((a, b) => b.products.length - a.products.length).slice(0, Math.max(0, max)).sort((a, b) => a.t - b.t);
}
