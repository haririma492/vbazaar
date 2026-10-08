// The route from a reconstruction's exported cameras: both common shapes,
// filming order, the viewer's upright turn, thinning.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { routeFromCameras, routeFromColmapBinary, routeFromColmapText } from "./cameras.ts";

test("cameras.json (3DGS): positions in filming order by image name, thinned", () => {
  const cams = [];
  for (let i = 0; i < 30; i++) cams.push({ id: i, img_name: `frame_${i}`, position: [0, 1.6, -i * 0.1], rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
  cams.reverse(); // the file need not be in order
  const r = routeFromCameras(cams, false)!;
  assert.equal(r.cameras, 30);
  assert.deepEqual(r.route[0], [0, 1.6, -0]);
  assert.ok(r.route.length >= 5 && r.route.length <= 7, `${r.route.length}`); // 2.9 walked, a point every 0.5
  assert.ok(r.route[r.route.length - 1][2] < -2);
});

test("frame_10 comes after frame_9", () => {
  const r = routeFromCameras([
    { img_name: "frame_10", position: [0, 0, -10] },
    { img_name: "frame_9", position: [0, 0, -9] },
    { img_name: "frame_1", position: [0, 0, -1] },
  ], false)!;
  assert.deepEqual(r.route.map((p) => p[2]), [-1, -9, -10]);
});

test("transforms.json (Nerfstudio): the camera-to-world matrix's last column", () => {
  const frame = (n: number, x: number, z: number) => ({
    file_path: `images/frame_${String(n).padStart(5, "0")}.jpg`,
    transform_matrix: [[1, 0, 0, x], [0, 1, 0, 1.5], [0, 0, 1, z], [0, 0, 0, 1]],
  });
  const r = routeFromCameras({ camera_model: "OPENCV", frames: [frame(2, 0, -2), frame(1, 0, -1), frame(3, 1, -3)] }, false)!;
  assert.deepEqual(r.route, [[0, 1.5, -1], [0, 1.5, -2], [1, 1.5, -3]]);
});

test("the splat's upright turn is applied as the viewer applies it", () => {
  const r = routeFromCameras({ cameras: [{ img_name: "a", position: [1, 2, 3] }, { img_name: "b", position: [1, 2, 9] }] }, true)!;
  assert.deepEqual(r.route[0], [1, -2, -3]);
});

test("a file without camera positions is refused", () => {
  assert.equal(routeFromCameras({ scenes: [] }, false), null);
  assert.equal(routeFromCameras([{ name: "x" }, { name: "y" }], false), null);
  assert.equal(routeFromCameras([{ position: [0, 0, 0] }], false), null);
  assert.equal(routeFromCameras("hello", false), null);
});

// ── COLMAP sparse model (what Brush trains from) ─────────────────────────────
// World-to-camera poses; the camera stands at C = -Rᵀ·t. Cross-checked with
// Brush's own loader test (crates/brush-dataset/src/formats/colmap.rs): a 90°
// turn about y with t = (1, 0, 2) puts the camera at (2, 0, -1).

type Img = { id: number; q: [number, number, number, number]; t: [number, number, number]; name: string; points?: [number, number, number][] };
const S = Math.SQRT1_2;
const IMGS: Img[] = [
  { id: 3, q: [1, 0, 0, 0], t: [0, 0, 2], name: "frame_10.jpg" },                     // C = (0, 0, -2)
  { id: 1, q: [1, 0, 0, 0], t: [-1, -2, -3], name: "frame_1.jpg", points: [[10, 20, 1], [30, 40, -1]] }, // C = (1, 2, 3)
  { id: 2, q: [S, 0, S, 0], t: [1, 0, 2], name: "frame_2.jpg" },                      // C = (2, 0, -1)
];
const WANT: Record<string, [number, number, number]> = { "frame_1.jpg": [1, 2, 3], "frame_2.jpg": [2, 0, -1], "frame_10.jpg": [0, 0, -2] };

function imagesTxt(imgs: Img[]): string {
  const out = [
    "# Image list with two lines of data per image:",
    "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
    "#   POINTS2D[] as (X, Y, POINT3D_ID)",
    `# Number of images: ${imgs.length}, mean observations per image: 1`,
  ];
  for (const m of imgs) {
    out.push([m.id, ...m.q, ...m.t, 1, m.name].join(" "));
    out.push((m.points ?? []).map((p) => p.join(" ")).join(" "));
  }
  return out.join("\n") + "\n";
}

function imagesBin(imgs: Img[]): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(BigInt(imgs.length));
  parts.push(head);
  for (const m of imgs) {
    const name = Buffer.from(m.name + "\0", "utf8");
    const pts = m.points ?? [];
    const b = Buffer.alloc(4 + 56 + 4 + name.length + 8 + pts.length * 24);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let at = 0;
    v.setInt32(at, m.id, true); at += 4;
    for (const n of [...m.q, ...m.t]) { v.setFloat64(at, n, true); at += 8; }
    v.setInt32(at, 1, true); at += 4;
    name.copy(b, at); at += name.length;
    v.setBigUint64(at, BigInt(pts.length), true); at += 8;
    for (const [x, y, id] of pts) {
      v.setFloat64(at, x, true); v.setFloat64(at + 8, y, true); v.setBigInt64(at + 16, BigInt(id), true); at += 24;
    }
    parts.push(b);
  }
  return Buffer.concat(parts);
}

const close = (got: number[], want: number[]) =>
  assert.ok(got.every((n, i) => Math.abs(n - want[i]) < 1e-9), `${got} ≠ ${want}`);

for (const [label, parse] of [
  ["images.txt", (flip: boolean, imgs = IMGS) => routeFromColmapText(imagesTxt(imgs), flip)],
  ["images.bin", (flip: boolean, imgs = IMGS) => routeFromColmapBinary(imagesBin(imgs), flip)],
] as const) {
  test(`COLMAP ${label}: camera centres -Rᵀ·t, in natural filming order`, () => {
    const r = parse(false)!;
    assert.equal(r.cameras, 3);
    assert.equal(r.route.length, 3);
    ["frame_1.jpg", "frame_2.jpg", "frame_10.jpg"].forEach((n, i) => close(r.route[i], WANT[n]));
  });

  test(`COLMAP ${label}: the splat's upright turn`, () => {
    const r = parse(true)!;
    close(r.route[0], [1, -2, -3]);
    close(r.route[1], [2, 0, 1]);
  });

  test(`COLMAP ${label}: thinned like the JSON route`, () => {
    const imgs: Img[] = [];
    for (let i = 0; i < 30; i++) imgs.push({ id: i + 1, q: [1, 0, 0, 0], t: [0, -1.6, i * 0.1], name: `f${i}.png` });
    const r = parse(false, imgs)!;
    assert.equal(r.cameras, 30);
    close(r.route[0], [0, 1.6, 0]);
    assert.ok(r.route.length >= 5 && r.route.length <= 7, `${r.route.length}`);
    // The same cameras as a cameras.json give the same route.
    const json = routeFromCameras(imgs.map((m) => ({ img_name: m.name, position: [0, 1.6, -m.t[2]] })), false)!;
    assert.equal(json.route.length, r.route.length);
    r.route.forEach((p, i) => close(p, json.route[i]));
  });
}

test("COLMAP images.txt: CRLF and a blank points line before the next image", () => {
  const r = routeFromColmapText(imagesTxt(IMGS).replace(/\n/g, "\r\n"), false)!;
  assert.equal(r.cameras, 3);
});

test("COLMAP: malformed files are refused", () => {
  // Text
  assert.equal(routeFromColmapText("", false), null);
  assert.equal(routeFromColmapText("# only comments\n", false), null);
  assert.equal(routeFromColmapText("1 PINHOLE 64 48 80 70 30 20\n", false), null); // cameras.txt
  assert.equal(routeFromColmapText("1 1.5 2.5 3.5 255 0 0 0.5 1 0\n2 -1 0 1 0 255 0 0.5 2 1\n", false), null); // points3D.txt
  assert.equal(routeFromColmapText("1 1 0 0 0 nope 0 0 1 a.jpg\n\n2 1 0 0 0 0 0 0 1 b.jpg\n\n", false), null);
  assert.equal(routeFromColmapText(imagesTxt(IMGS.slice(0, 1)), false), null); // one camera is no route
  assert.equal(routeFromColmapText(42 as unknown as string, false), null);
  // Binary
  const good = imagesBin(IMGS);
  assert.equal(routeFromColmapBinary(new ArrayBuffer(0), false), null);
  assert.equal(routeFromColmapBinary(good.subarray(0, good.length - 5), false), null); // truncated
  const huge = Buffer.from(good); huge.writeBigUInt64LE(1n << 40n, 0);
  assert.equal(routeFromColmapBinary(huge, false), null); // count larger than the file
  const noNul = imagesBin(IMGS.slice(0, 2)); noNul.fill(0x41, noNul.length - 9, noNul.length); // last name runs off the end
  assert.equal(routeFromColmapBinary(noNul.subarray(0, noNul.length - 8), false), null);
  const badQ = imagesBin([{ ...IMGS[0], q: [2, 0, 0, 0] }, IMGS[1]]);
  assert.equal(routeFromColmapBinary(badQ, false), null); // not a unit quaternion
  // A plain ArrayBuffer (as File.arrayBuffer() gives) works too.
  const ab = good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength);
  assert.equal(routeFromColmapBinary(ab as ArrayBuffer, false)!.cameras, 3);
});
