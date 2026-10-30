// The Tagger's rules, the bazaar's spots and joins, and the walk's new door
// photo and onward walk.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { panoPixel } from "../splats/projection.ts";
import { checkWalks } from "../splats/walks.ts";
import { FOLLOW_FPS, LOOK_EVERY, LOOK_N, LOOK_PITCH, aim, follow, itemOf, keepTracks, lookPlan, type Track } from "./tagging.ts";
import { doorOf, emptyBazaar, joins, moveArea, moveStore, spotFor, takeSpot, type Bazaar } from "./bazaar.ts";

const deg = Math.PI / 180;

test("the tagger looks all round every few seconds", () => {
  const plan = lookPlan(20);
  assert.equal(plan[0].t, 1);
  assert.ok(plan.every((m, i) => i === 0 || Math.abs(m.t - plan[i - 1].t - LOOK_EVERY) < 1e-9));
  assert.equal(plan[0].looks.length, 6);
  assert.equal(new Set(plan.flatMap((m) => m.looks.map((l) => l.id))).size, plan.length * 6, "every view has its own id");
});

test("a box's middle is aimed the way ffmpeg cut the view: the view's centre is its heading, right is + yaw", () => {
  const look = { t: 1, heading: 60 * deg, id: "a" };
  const c = aim(look, [400, 400, 600, 600]);
  assert.ok(Math.abs(c.lon - 60 * deg) < 1e-6 && Math.abs(c.lat - LOOK_PITCH) < 1e-6);
  assert.ok(aim(look, [800, 450, 900, 550]).lon > 60 * deg, "right of centre is further right");
  assert.ok(aim(look, [450, 50, 550, 150]).lat > LOOK_PITCH, "up is up");
  void LOOK_N;
});

/** Noise panoramas with a bright «product» drifting right as the camera walks past it. */
function walkFrames(n: number, W: number, H: number, at: (i: number) => { lon: number; lat: number }): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const f = new Float32Array(W * H);
    let s = 11;
    for (let k = 0; k < f.length; k++) { s = (s * 1103515245 + 12345) & 0x7fffffff; f[k] = 40 + (s % 30); }
    const p = panoPixel(at(i).lon, at(i).lat, "equirect", W, H);
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) {
      const v = Math.abs(x) < 4 && Math.abs(y) < 6 ? 250 : (x * 2 + y) % 3 === 0 ? 200 : 110;
      f[Math.round(p.y + y) * W + ((Math.round(p.x + x) % W) + W) % W] = v;
    }
    frames.push(f);
  }
  return frames;
}

test("a sighting is followed both ways through the frames, and the tag stays on the product", () => {
  const W = 1024, H = 512;
  const truth = (i: number) => ({ lon: (30 + 1.5 * i) * deg, lat: -4 * deg });
  const frames = walkFrames(21, W, H, truth);
  // Frames from 0 s, the sighting in frame 10 (2 s).
  const pins = follow(frames, W, H, 0, 10, truth(10));
  assert.ok(pins.length >= 15, `followed ${pins.length} of 21 frames`);
  assert.equal(pins[0].t < 2 && pins[pins.length - 1].t > 2, true, "before and after the sighting");
  for (const p of pins) {
    const i = Math.round(p.t * FOLLOW_FPS);
    assert.ok(Math.abs(p.x - truth(i).lon) < 1.5 * deg, `at ${p.t}s ${p.x / deg}° vs ${truth(i).lon / deg}°`);
  }
});

test("per product: sightings of one spot merge into the longest, a second spot is kept, a lost one is dropped", () => {
  const pins = (t0: number, n: number, x: number) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * 0.2, x: x + i * 0.01, y: 0 }));
  const tracks: Track[] = [
    { n: 7, confidence: 0.9, pins: pins(1, 20, 0.5) },
    { n: 7, confidence: 0.8, pins: pins(2, 8, 0.55) }, // the same spot, seen again
    { n: 7, confidence: 0.9, pins: pins(30, 10, -1.2) }, // the same product elsewhere
    { n: 9, confidence: 0.9, pins: pins(5, 2, 1) }, // lost at once
  ];
  const kept = keepTracks(tracks);
  assert.deepEqual(kept.map((k) => [k.n, k.pins.length]), [[7, 20], [7, 10]]);
  const item = itemOf(kept[0], { n: 7, en: "Saffron 1g", fa: "زعفران", unit: "piece", priceCents: 1299 }, 0);
  assert.deepEqual([item.id, item.n, item.label], ["auto-7-0", 7, { en: "Saffron 1g", fa: "زعفران" }]);
});

test("stores take the hallway's free spots in order; the operator moves them; the areas join in order", () => {
  let b: Bazaar = { ...emptyBazaar(), spots: [{ id: "spot-1", t: 5, yaw: 1, pitch: 0, size: 0.5 }, { id: "spot-2", t: 9, yaw: -1, pitch: 0, size: 0.5 }] };
  assert.equal(spotFor(b, "alis")!.id, "spot-1");
  b = takeSpot(b, "spot-1", "alis");
  assert.equal(spotFor(b, "alis")!.id, "spot-1", "a store keeps its spot");
  assert.equal(spotFor(b, "nuts")!.id, "spot-2");
  b = takeSpot(b, "spot-2", "nuts");
  assert.equal(spotFor(b, "third"), null, "none free");
  b = moveStore(b, "nuts", "spot-1");
  assert.deepEqual(b.spots.map((s) => s.store), ["nuts", "alis"], "moving swaps");

  b = { ...b, areas: b.areas.map((a, i) => (i < 2 ? { ...a, walk: `scenes/area-${a.id}/walk-1.mp4` } : a)) };
  assert.deepEqual(joins(b), [{ from: "scenes/area-outside/walk-1.mp4", to: "scenes/area-lobby/walk-1.mp4" }]);
  assert.deepEqual(joins(moveArea(b, "lobby", -1)), [{ from: "scenes/area-lobby/walk-1.mp4", to: "scenes/area-outside/walk-1.mp4" }]);

  const door = doorOf(b.spots[1], { slug: "alis", name: { en: "Ali's", fa: "علی" }, walk: "scenes/store-alis/walk-1.mp4", image: "https://x.r2.dev/door.jpg" });
  const { walks, problems } = checkWalks({ walks: { "scenes/area-hallway/walk-1.mp4": { doors: [door], next: "scenes/area-lobby/walk-1.mp4" } } });
  assert.deepEqual(problems, []);
  const w = walks.walks["scenes/area-hallway/walk-1.mp4"];
  assert.equal(w.next, "scenes/area-lobby/walk-1.mp4");
  assert.equal(w.doors[0].image, "https://x.r2.dev/door.jpg");
  assert.equal(w.doors[0].size, 0.5);
  assert.ok(checkWalks({ walks: { "scenes/a/w.mp4": { doors: [{ ...door, image: "http://insecure" }] } } }).problems.length, "a door photo is https only");
});
