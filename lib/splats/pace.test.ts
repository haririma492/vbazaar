// The photographer's walking speed, read off the floor (`pace.ts`).
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { CAMERA_HEIGHT, STANDARD, VIEW_FOV, VIEW_H, VIEW_PITCH, VIEW_W, VIEW_YAWS, driveRate, frameShift, groundMove, paceOf } from "./pace.ts";

/** A floor with texture: smooth-ish noise, the same at every point every time. */
function floorAt(x: number, y: number): number {
  const s = Math.sin(x * 7.1) * Math.cos(y * 5.3) + Math.sin(x * 2.3 + y * 3.7) + 0.5 * Math.sin(x * 13.1 - y * 11.7);
  return Math.round(128 + 40 * s);
}

/** What a pinhole view `yawDeg` round, `VIEW_PITCH` down, sees of the floor from the camera at (cx, cy). */
function view(cx: number, cy: number, yawDeg: number): Uint8Array {
  const out = new Uint8Array(VIEW_W * VIEW_H);
  const f = VIEW_W / 2 / Math.tan(VIEW_FOV / 2);
  const yaw = (yawDeg * Math.PI) / 180, p = VIEW_PITCH;
  for (let j = 0; j < VIEW_H; j++) {
    for (let i = 0; i < VIEW_W; i++) {
      // camera frame: forward, right, up
      const r = (i + 0.5 - VIEW_W / 2) / f, u = -(j + 0.5 - VIEW_H / 2) / f;
      // tilt down by p: forward' = (cos p, -sin p) in (horizontal, up)
      const fwdH = Math.cos(p) - u * Math.sin(p), up = -Math.sin(p) - u * Math.cos(p);
      // horizontal: forward along yaw, right is yaw + 90°
      const dx = fwdH * Math.cos(yaw) + r * Math.cos(yaw - Math.PI / 2);
      const dy = fwdH * Math.sin(yaw) + r * Math.sin(yaw - Math.PI / 2);
      const t = up < -1e-6 ? CAMERA_HEIGHT / -up : 1e6;
      out[j * VIEW_W + i] = floorAt(cx + dx * t, cy + dy * t);
    }
  }
  return out;
}

test("frameShift finds a picture slid by a known amount", () => {
  const a = view(0, 0, 0);
  const b = new Uint8Array(a.length);
  for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) {
    const sy = Math.min(VIEW_H - 1, Math.max(0, y - 7)), sx = Math.min(VIEW_W - 1, Math.max(0, x + 4));
    b[y * VIEW_W + x] = a[sy * VIEW_W + sx];
  }
  const s = frameShift(a, b, VIEW_W, VIEW_H);
  assert.deepEqual([s.dx, s.dy], [-4, 7]);
  assert.ok(s.score > 0.5);
});

test("a flat grey floor gives no texture to go on", () => {
  const g = new Uint8Array(VIEW_W * VIEW_H).fill(120);
  assert.ok(frameShift(g, g, VIEW_W, VIEW_H).score < 0.05);
});

test("the four views measure the camera's real speed in any walking direction", () => {
  for (const heading of [0, 0.7, 2.0]) {
    const speed = 1.1, dt = 1 / 4, step = speed * dt;
    const pairs = [];
    for (let k = 0; k < 20; k++) {
      const x0 = k * step * Math.cos(heading), y0 = k * step * Math.sin(heading);
      const x1 = x0 + step * Math.cos(heading), y1 = y0 + step * Math.sin(heading);
      pairs.push(VIEW_YAWS.map((yaw) => {
        const s = frameShift(view(x0, y0, yaw), view(x1, y1, yaw), VIEW_W, VIEW_H);
        return { move: groundMove(s.dx, s.dy), score: s.score };
      }));
    }
    const pace = paceOf(pairs, dt);
    assert.ok(pace !== null, `heading ${heading}`);
    assert.ok(Math.abs(pace! - speed) / speed < 0.25, `heading ${heading}: measured ${pace}, walked ${speed}`);
  }
});

test("standing still and unreadable frames give no pace", () => {
  const still = Array.from({ length: 30 }, () => VIEW_YAWS.map(() => ({ move: 0, score: 0.9 })));
  assert.equal(paceOf(still, 0.25), null);
  const blank = Array.from({ length: 30 }, () => VIEW_YAWS.map(() => ({ move: 0.3, score: 0 })));
  assert.equal(paceOf(blank, 0.25), null);
});

test("Slow and Fast are the same real speed on every walk", () => {
  assert.equal(driveRate("slow", 1.0, 0.3), STANDARD.slow / 1.0);
  assert.equal(driveRate("slow", 0.6, 0.3), 0.5);
  assert.equal(driveRate("fast", 0.7, 1.5), 2);
  assert.ok(driveRate("back", 1.0, -0.6) < 0);
  assert.equal(driveRate("fast", 0.2, 1.5), 4, "never faster than browsers play");
  assert.equal(driveRate("slow", null, 0.3), 0.3, "no pace: the old multiple");
});
