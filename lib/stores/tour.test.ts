// The Shelf tour's planning (`tour.ts`).
import test from "node:test";
import assert from "node:assert/strict";
import { aimCommands, planTour, project, shelvesOf, type Seen } from "./tour.ts";

const deg = Math.PI / 180;
const s = (n: number, t: number, lonDeg: number, w = 0.1): Seen => ({ n, t, lon: lonDeg * deg, lat: 0, size: { w, h: w } });

test("a camera's aim is the middle of its frame; right is right, up is up", () => {
  const c = project(0.3, 0.1, 0.3, 0.1, 1.2, 0.7)!;
  assert.ok(Math.abs(c.x - 0.5) < 1e-9 && Math.abs(c.y - 0.5) < 1e-9);
  assert.ok(project(0.4, 0.1, 0.3, 0.1, 1.2, 0.7)!.x > 0.5, "further right is right of the middle");
  assert.ok(project(0.3, 0.2, 0.3, 0.1, 1.2, 0.7)!.y < 0.5, "higher is above the middle");
  assert.equal(project(Math.PI, 0, 0, 0, 1.2, 0.7), null, "behind the camera");
});

test("shelves: one direction without a long gap; a shelf seen again keeps its closest visit", () => {
  const seen = [
    s(1, 1, 60), s(2, 1.5, 70), s(3, 2.5, 80),         // shelf A, on the right
    s(4, 4, -60), s(5, 5, -70),                         // shelf B, on the left
    s(1, 20, 62, 0.3), s(2, 21, 72, 0.3), s(3, 22, 78, 0.3), // shelf A again, closer
  ];
  const sh = shelvesOf(seen);
  assert.equal(sh.length, 2);
  assert.deepEqual(sh.map((g) => g.map((x) => x.n)), [[4, 5], [1, 2, 3]], "B first, A from its closer visit");
});

test("the tour: a clip a shelf, every product on screen at some moment", () => {
  const seen = [s(1, 10, 50), s(2, 11, 60), s(3, 12, 70), s(4, 30, -40), s(5, 31, -30)];
  const p = planTour(seen, [], 60);
  assert.equal(p.clips.length, 2);
  assert.ok(p.clips.every((c) => c.to - c.from >= 3 && c.to - c.from <= 6));
  assert.deepEqual(p.items.map((i) => i.n).sort(), [1, 2, 3, 4, 5]);
  assert.ok(Math.abs(p.seconds - p.clips.reduce((x, c) => x + c.to - c.from, 0)) < 0.02);
  assert.match(aimCommands(p.clips[0]), /^0\.000 v360@cam yaw /);
});

test("a point on the screen goes back to the direction it came from", async () => {
  const { unproject } = await import("./tour.ts");
  for (const [lon, lat] of [[0.5, 0.1], [0.9, -0.3], [0.2, 0.25]]) {
    const p = project(lon, lat, 0.6, -0.1, 1.4, 0.85)!;
    const d = unproject(p.x, p.y, 0.6, -0.1, 1.4, 0.85);
    assert.ok(Math.abs(d.lon - lon) < 1e-9 && Math.abs(d.lat - lat) < 1e-9, `${lon},${lat} → ${d.lon},${d.lat}`);
  }
});
