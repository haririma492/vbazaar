// The Tagger's rules, the bazaar's spots and joins, and the walk's new door
// photo and onward walk.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { panoPixel } from "../splats/projection.ts";
import { checkWalks } from "../splats/walks.ts";
import { FOLLOW_FPS, FOLLOW_W, LOOK_EVERY, LOOK_FOV, LOOK_N, LOOK_PITCH, SHELF_FOV, SHELF_HEADINGS, SHELF_PITCHES, aim, boxSize, capTracks, follow, itemOf, keepTracks, lookPlan, type Track } from "./tagging.ts";
import { doorOf, emptyBazaar, joins, moveArea, moveStore, spotFor, takeSpot, type Bazaar } from "./bazaar.ts";

const deg = Math.PI / 180;

test("the tagger looks all round every few seconds", () => {
  const plan = lookPlan(20);
  assert.equal(plan[0].t, 1);
  assert.ok(plan.every((m, i) => i === 0 || Math.abs(m.t - plan[i - 1].t - LOOK_EVERY) < 1e-9));
  // Shelf looks (2026-11-04): 8 directions × 2 heights, 50° each, so a book's spine is sharp enough to read.
  assert.equal(plan[0].looks.length, SHELF_HEADINGS.length * SHELF_PITCHES.length);
  assert.equal(new Set(plan.flatMap((m) => m.looks.map((l) => l.id))).size, plan.length * 16, "every view has its own id");
  assert.ok(plan[0].looks.every((l) => l.fov === SHELF_FOV), "every view 50° wide");
});

test("a box's middle is aimed the way ffmpeg cut the view: the view's centre is its heading, right is + yaw", () => {
  const look = { t: 1, heading: 60 * deg, pitch: LOOK_PITCH, fov: LOOK_FOV, id: "a" };
  const c = aim(look, [400, 400, 600, 600]);
  assert.ok(Math.abs(c.lon - 60 * deg) < 1e-6 && Math.abs(c.lat - LOOK_PITCH) < 1e-6);
  assert.ok(aim(look, [800, 450, 900, 550]).lon > 60 * deg, "right of centre is further right");
  assert.ok(aim(look, [450, 50, 550, 150]).lat > LOOK_PITCH, "up is up");
  void LOOK_N;
  // The outline: a box a fifth of a 75° view wide is 17.5° across (2·atan(0.2·tan 37.5°)).
  const size = boxSize(look, [400, 400, 600, 600]);
  assert.ok(Math.abs(size.w - 17.5 * deg) < 0.3 * deg && Math.abs(size.h - 17.5 * deg) < 0.3 * deg, `${size.w / deg}° × ${size.h / deg}°`);
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
  // Frames from 0 s, the sighting in frame 10 (10 / FOLLOW_FPS s).
  const pins = follow(frames, W, H, 0, 10, truth(10));
  const seenAt = 10 / FOLLOW_FPS;
  assert.ok(pins.length >= 15, `followed ${pins.length} of 21 frames`);
  assert.equal(pins[0].t < seenAt && pins[pins.length - 1].t > seenAt, true, "before and after the sighting");
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

test("every heading the Tagger looks along is a yaw ffmpeg's v360 accepts (−180…180°)", async () => {
  const { v360Yaw } = await import("./media.ts");
  const { HEADINGS } = await import("./tagging.ts");
  for (const h of [...HEADINGS, ...SHELF_HEADINGS]) {
    const y = v360Yaw(h);
    assert.ok(y >= -180 && y <= 180, `heading ${(h * 180) / Math.PI}° became ${y}`);
  }
  assert.equal(Math.round(v360Yaw((240 * Math.PI) / 180)), -120);
  assert.equal(Math.round(v360Yaw((300 * Math.PI) / 180)), -60);
  assert.equal(Math.round(v360Yaw((60 * Math.PI) / 180)), 60);
});

test("a follow is precise to a fraction of a pixel: the dot does not zig-zag or creep", () => {
  const W = FOLLOW_W, H = FOLLOW_W / 2;
  // Book spines: fine stripes of many shades, the same every time; the camera turns and tips a little each frame.
  const shelf = (lon: number, lat: number) => 120 + 50 * Math.sin(lon * 180 + Math.sin(lon * 23) * 3) + 30 * Math.sin(lat * 90 + lon * 40) + 20 * Math.sin(lon * 57 - lat * 33);
  const truth = (i: number) => ({ lon: (20 + 0.37 * i + 0.2 * Math.sin(i * 0.9)) * deg, lat: (-8 + 0.13 * i) * deg });
  const frames: Float32Array[] = [];
  for (let i = 0; i < 17; i++) {
    const f = new Float32Array(W * H), d = truth(i), d0 = truth(8);
    // Only round the product matters: the rest stays plain.
    const p = panoPixel(d.lon, d.lat, "equirect", W, H);
    for (let y = Math.floor(p.y) - 60; y <= Math.floor(p.y) + 60; y++) {
      for (let x = Math.floor(p.x) - 60; x <= Math.floor(p.x) + 60; x++) {
        const lon = -Math.PI + ((x + 0.5) / W) * 2 * Math.PI, lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
        f[y * W + ((x % W) + W) % W] = shelf(lon - (d.lon - d0.lon), lat - (d.lat - d0.lat));
      }
    }
    frames.push(f);
  }
  const pins = follow(frames, W, H, 0, 8, truth(8));
  assert.ok(pins.length >= 15, `followed ${pins.length} of 17 frames`);
  let worst = 0;
  for (const q of pins) {
    const i = Math.round(q.t * FOLLOW_FPS);
    worst = Math.max(worst, Math.hypot(q.x - truth(i).lon, q.y - truth(i).lat));
  }
  assert.ok(worst < 0.1 * deg, `within ${(worst / deg).toFixed(3)}° of the product in every frame (a pixel is ${(360 / W).toFixed(3)}°)`);
});

test("the light cap is shared fairly: every product gets a light before any gets two, all along the walk", () => {
  const tr = (n: number, t: number, len: number) => ({ n, confidence: 0.9, pins: Array.from({ length: len }, (_, i) => ({ t: t + i * 0.2, x: 0, y: 0 })) });
  // Product 1 has many long spots early on; products 2–5 are seen once each, late in the walk.
  const tracks = [tr(1, 1, 20), tr(1, 5, 18), tr(1, 9, 16), tr(2, 100, 5), tr(3, 120, 5), tr(4, 140, 5), tr(5, 150, 4)];
  const kept = capTracks(tracks, 5);
  assert.deepEqual([...new Set(kept.map((k) => k.n))].sort(), [1, 2, 3, 4, 5], "every product has a light");
  assert.ok(kept.some((k) => k.pins[0].t >= 150), "the end of the walk keeps its lights");
  assert.ok(kept.every((k, i) => i === 0 || kept[i - 1].pins[0].t <= k.pins[0].t), "in time order");
});
