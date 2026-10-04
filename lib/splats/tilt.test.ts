// Walk by tilting: the phone's comfortable hold is standing still; tilting the
// top back walks at three speeds; a steering-wheel twist turns the body and
// the body stays turned when the hand comes back.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { LEVEL_SPEED, TURN_GAIN, TWIST_DEAD, holdAngles, speedLevel, startTilt, stepTilt, stickHold, type TiltState } from "./tilt.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("how the phone is held: upright is 0, leaning back adds pitch, a steering twist is roll", () => {
  // Upright, straight.
  let h = holdAngles(90, 0);
  near(h.pitch, 0);
  near(h.roll, 0);
  // The comfortable hold: top 17° back from upright is beta 73.
  h = holdAngles(73, 0);
  near(h.pitch, 17);
  near(h.roll, 0);
  // Flat face-up on a table.
  near(holdAngles(0, 0).pitch, 90);
  // Twisted right like a steering wheel (right edge dips: the browser's gamma
  // goes positive) while leaning back: roll positive; left, negative.
  assert.ok(holdAngles(73, 10).roll > 0);
  assert.ok(holdAngles(73, -10).roll < 0);
  // Upright and twisted, the roll is the twist itself.
  near(holdAngles(90, 0).roll, 0);
  // Held sideways (landscape), the screen's own up is used.
  near(holdAngles(0, -90, 90).pitch, 0, 1e-6);
});

test("speed: 2°, 4°, 6° past comfortable; back to comfortable stops", () => {
  assert.equal(speedLevel(0, 0), 0);
  assert.equal(speedLevel(1.9, 0), 0);
  assert.equal(speedLevel(2, 0), 1);
  assert.equal(speedLevel(4.2, 0), 2);
  assert.equal(speedLevel(6.5, 0), 3);
  assert.equal(speedLevel(20, 0), 3);
  // Leaning forward of comfortable is not walking backward: it is standing.
  assert.equal(speedLevel(-5, 0), 0);
  assert.deepEqual(LEVEL_SPEED.length, 4);
});

test("speed does not flicker at a step's edge, and stops near comfortable", () => {
  // At level 1, a tilt of 1.5° (just under the 2° step) keeps walking…
  assert.equal(speedLevel(1.5, 1), 1);
  // …but back within 1° of comfortable stops.
  assert.equal(speedLevel(0.8, 1), 0);
  assert.equal(speedLevel(3.4, 2), 2);
  assert.equal(speedLevel(2.9, 2), 1);
});

test("a twist right turns the body right; coming back to straight keeps the new direction", () => {
  let s: TiltState = startTilt(17);
  let heading = 0;
  for (const roll of [0, 3, 6, 10, 15]) {
    const r = stepTilt(s, 17, roll);
    s = r.state;
    heading += r.turn;
  }
  near(heading, (15 - TWIST_DEAD) * TURN_GAIN);
  const afterTwist = heading;
  // The hand comes back to straight: no turn back.
  for (const roll of [12, 8, 4, 1, 0]) {
    const r = stepTilt(s, 17, roll);
    s = r.state;
    heading += r.turn;
  }
  near(heading, afterTwist);
});

test("to turn back, twist the other way; a small twist is a small turn", () => {
  let s = startTilt(17);
  let heading = 0;
  const feed = (rolls: number[]) => {
    for (const roll of rolls) {
      const r = stepTilt(s, 17, roll);
      s = r.state;
      heading += r.turn;
    }
  };
  feed([0, 5, 10, 0]); // right
  const right = heading;
  assert.ok(right > 0);
  feed([0, -5, -10, 0]); // left by as much
  near(heading, 0);
  feed([0, 3, 0]); // a small nudge
  near(heading, (3 - TWIST_DEAD) * TURN_GAIN);
  // A steady hand inside the dead zone turns nothing.
  const before = heading;
  feed([1, -1, 1.2, -0.5, 0]);
  near(heading, before);
});

test("walking and turning together: tilt sets the speed while a twist turns", () => {
  let s = startTilt(17);
  let r = stepTilt(s, 21.5, 8); // 4.5° back and twisted right
  s = r.state;
  assert.equal(s.level, 2);
  assert.ok(r.turn > 0);
  r = stepTilt(s, 17, 0); // back to comfortable, straight
  assert.equal(r.state.level, 0);
  assert.equal(r.turn, 0);
});

test("the stick drives exactly like the phone: stepped speeds up, a push sideways turns the body and it stays", () => {
  let s = startTilt(0);
  const push = (x: number, y: number) => {
    const h = stickHold(x, y);
    const r = stepTilt(s, h.pitch, h.roll);
    s = r.state;
    return r.turn;
  };
  push(0, -0.2);
  assert.equal(s.level, 0); // a nudge: standing
  push(0, -0.3);
  assert.equal(s.level, 1);
  push(0, -0.55);
  assert.equal(s.level, 2);
  push(0, -1);
  assert.equal(s.level, 3);
  push(0, 0);
  assert.equal(s.level, 0); // let go: stop
  // Full push right and back to the middle: a quarter turn, kept.
  let heading = 0;
  for (const x of [0.25, 0.5, 1]) heading += push(x, 0);
  near(heading, 90);
  for (const x of [0.5, 0.1, 0]) heading += push(x, 0);
  near(heading, 90);
  // Pushing down (reverse) is no tilt at all.
  assert.equal(stickHold(0, 1).pitch, 0);
});
