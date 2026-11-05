// The Shelf Tour's camera over a shelf's still (`choreo.ts`).
import test from "node:test";
import assert from "node:assert/strict";
import { ASPECT, choreograph, frameOf, lengthOf, windowAt } from "./choreo.ts";

test("whole shelf → each level (serpentine) → whole shelf, always inside the still", () => {
  const W = 2400, H = 2800;
  const levels = [{ x: 100, y: 200, w: 2200, h: 400 }, { x: 100, y: 1000, w: 2200, h: 400 }];
  const keys = choreograph(W, H, levels);
  assert.equal(keys[0].win.w, keys[keys.length - 1].win.w, "starts and ends on the whole shelf");
  const l1 = keys[2].win, l1end = keys[3].win, l2 = keys[4].win, l2end = keys[5].win;
  assert.ok(l1.cx < l1end.cx, "level 1 left to right");
  assert.ok(l2.cx > l2end.cx, "level 2 right to left");
  assert.ok(Math.abs(l1.cy - 400) < 1 && Math.abs(l2.cy - 1200) < 1, "each on its level");
  for (let t = 0; t <= lengthOf(keys); t += 0.1) {
    const v = windowAt(keys, t), h = v.w / ASPECT;
    assert.ok(v.cx - v.w / 2 >= -0.5 && v.cx + v.w / 2 <= W + 0.5 && v.cy - h / 2 >= -0.5 && v.cy + h / 2 <= H + 0.5, `inside at ${t.toFixed(1)}`);
  }
});

test("a frame of the window is the still's own pixels", () => {
  const W = 8, H = 8, still = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) still[i * 3] = 200;
  const out = new Uint8Array(4 * 3 * 3);
  frameOf(still, W, H, { cx: 4, cy: 4, w: 4 }, 4, 3, out);
  assert.ok([...out].every((v, i) => (i % 3 === 0 ? Math.abs(v - 200) <= 1 : v === 0)));
});
