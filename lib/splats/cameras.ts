/**
 * THE CAMERAMAN'S ROUTE FROM THE RECONSTRUCTION'S OWN CAMERAS.
 *
 * A splat is trained from the footage's frames, and the trainer works out
 * where the camera stood for each one. Exported as JSON beside the .ply, those
 * positions ARE the route the cameraman walked — in the splat's own
 * coordinates, so no recording walk is needed (`/operator/splats` takes the
 * file and sets the scene's route; `lib/splats/path.ts` uses it).
 *
 * Two common shapes:
 *   cameras.json      [{ img_name, position: [x, y, z], rotation, … }]   (3DGS / INRIA, Splatica-style)
 *   transforms.json   { frames: [{ file_path, transform_matrix: 4×4 }] } (Nerfstudio / Instant-NGP)
 * plus `{ cameras: [...] }` wrapping the first. And COLMAP's own sparse model,
 * which is not JSON (Brush trains from it):
 *   sparse/0/images.txt   two lines per image: IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME, then its 2D points
 *   sparse/0/images.bin   the same, binary little-endian (COLMAP's default)
 * COLMAP stores world-to-camera poses; the camera stands at C = -Rᵀ·t.
 *
 * ⚠️ COORDINATES: Brush's exported .ply is in the COLMAP world frame unchanged
 * — no axis swap, recentring or up-axis turn. It does divide by
 * `--units-per-meter` on load, but multiplies back on export
 * (brush-dataset/src/formats/mod.rs `scale_to_meters`; brush-process
 * train_stream.rs `export_checkpoint` → `splats.scaled(units_per_meter)`),
 * and the up axis it estimates is only written as a header comment
 * ("Vertical axis: …"). So the COLMAP camera centres need no transform beyond
 * the same `flip` the splat gets.
 *
 * The frames are put in filming order (by image name, naturally sorted), the
 * splat's upright turn is applied as the viewer applies it (`flip`: y and z
 * change sign), and the walk is thinned to a point every half unit.
 */

// `path.ts`'s Vec3 and recordStep, repeated: `node --test` runs this file
// without a bundler, so it imports nothing.
type Vec3 = [number, number, number];
function recordStep(route: Vec3[], p: Vec3, every = 0.5): Vec3[] {
  const last = route[route.length - 1];
  if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < every) return route;
  return [...route, p];
}

type Cam = { name: string; pos: Vec3 };

const finite3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n));

function fromEntry(e: unknown, i: number): Cam | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const name = String(o.img_name ?? o.file_path ?? o.name ?? o.id ?? i);
  if (finite3(o.position)) return { name, pos: [o.position[0], o.position[1], o.position[2]] };
  if (o.position && typeof o.position === "object") {
    const p = o.position as Record<string, unknown>;
    if ([p.x, p.y, p.z].every((n) => typeof n === "number" && Number.isFinite(n))) return { name, pos: [p.x as number, p.y as number, p.z as number] };
  }
  // A camera-to-world 4×4 matrix: the position is its last column.
  const m = o.transform_matrix ?? o.transform ?? o.c2w;
  if (Array.isArray(m) && m.length >= 3 && m.slice(0, 3).every((row) => Array.isArray(row) && row.length >= 4)) {
    const rows = m as number[][];
    const pos: Vec3 = [rows[0][3], rows[1][3], rows[2][3]];
    if (pos.every((n) => typeof n === "number" && Number.isFinite(n))) return { name, pos };
  }
  return null;
}

/** "frame_10" after "frame_9": numbers inside names compare as numbers. */
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Filming order, the viewer's upright turn, thinning: the step every format shares. */
function routeFromCams(cams: Cam[], flip: boolean): { route: Vec3[]; cameras: number } | null {
  if (cams.length < 2) return null;
  cams = [...cams].sort((a, b) => natural(a.name, b.name));
  let route: Vec3[] = [];
  for (const c of cams) {
    const p: Vec3 = flip ? [c.pos[0], -c.pos[1], -c.pos[2]] : c.pos;
    route = recordStep(route, p);
  }
  return route.length >= 2 ? { route: route.slice(0, 5000), cameras: cams.length } : null;
}

/**
 * The route in the viewer's coordinates, from a camera JSON. Null when the
 * file holds no camera positions this understands.
 */
export function routeFromCameras(json: unknown, flip: boolean): { route: Vec3[]; cameras: number } | null {
  let list: unknown[] | null = null;
  if (Array.isArray(json)) list = json;
  else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.frames)) list = o.frames;
    else if (Array.isArray(o.cameras)) list = o.cameras;
  }
  if (!list) return null;
  return routeFromCams(list.map(fromEntry).filter((c): c is Cam => c !== null), flip);
}

/**
 * Where a COLMAP camera stands: C = -Rᵀ·t, R from the world-to-camera
 * quaternion (w, x, y, z). Null unless the quaternion is a unit one, as COLMAP
 * writes it — which also refuses cameras/points3D files picked by mistake.
 */
function colmapCentre(qw: number, qx: number, qy: number, qz: number, tx: number, ty: number, tz: number): Vec3 | null {
  if (![qw, qx, qy, qz, tx, ty, tz].every(Number.isFinite)) return null;
  const n = Math.hypot(qw, qx, qy, qz);
  if (Math.abs(n - 1) > 1e-2) return null;
  const [w, x, y, z] = [qw / n, qx / n, qy / n, qz / n];
  // COLMAP's qvec2rotmat, row by row.
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const t = [tx, ty, tz];
  // -Rᵀ·t: column i of R dotted with t.
  const c = (i: number) => -(R[0][i] * t[0] + R[1][i] * t[1] + R[2][i] * t[2]);
  return [c(0), c(1), c(2)];
}

/**
 * The route from COLMAP's `images.txt`. Null when the text is not an images
 * file (a line that does not parse refuses the whole file).
 */
export function routeFromColmapText(text: string, flip: boolean): { route: Vec3[]; cameras: number } | null {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  const cams: Cam[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    // IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME
    const f = line.split(/\s+/);
    if (f.length < 10 || !/^\d+$/.test(f[0]) || !/^\d+$/.test(f[8])) return null;
    const pos = colmapCentre(...(f.slice(1, 8).map(Number) as [number, number, number, number, number, number, number]));
    if (!pos) return null;
    cams.push({ name: f.slice(9).join(" "), pos });
    i++; // the next line is this image's 2D points, empty or not
  }
  return routeFromCams(cams, flip);
}

/**
 * The route from COLMAP's `images.bin` (little-endian): uint64 count, then per
 * image int32 id, 4×f64 q, 3×f64 t, int32 camera id, NUL-terminated name,
 * uint64 point count, and that many (f64 x, f64 y, i64 point3D id).
 * Null when the bytes are not that.
 */
export function routeFromColmapBinary(data: ArrayBuffer | ArrayBufferView, flip: boolean): { route: Vec3[]; cameras: number } | null {
  const v = data instanceof ArrayBuffer
    ? new DataView(data)
    : ArrayBuffer.isView(data) ? new DataView(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!v || v.byteLength < 8) return null;
  const MIN_IMAGE = 4 + 7 * 8 + 4 + 1 + 8;
  const count = v.getBigUint64(0, true);
  if (count > BigInt(Math.floor((v.byteLength - 8) / MIN_IMAGE))) return null;
  let at = 8;
  const cams: Cam[] = [];
  for (let k = 0; k < Number(count); k++) {
    if (at + 4 + 7 * 8 + 4 > v.byteLength) return null;
    const d = (j: number) => v.getFloat64(at + 4 + j * 8, true);
    const pos = colmapCentre(d(0), d(1), d(2), d(3), d(4), d(5), d(6));
    if (!pos) return null;
    at += 4 + 7 * 8 + 4;
    const start = at;
    while (at < v.byteLength && v.getUint8(at) !== 0) at++;
    if (at >= v.byteLength) return null;
    const name = new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + start, at - start));
    at++; // the NUL
    if (at + 8 > v.byteLength) return null;
    const points = v.getBigUint64(at, true);
    at += 8;
    if (points > BigInt(Math.floor((v.byteLength - at) / 24))) return null;
    at += Number(points) * 24;
    cams.push({ name, pos });
  }
  return routeFromCams(cams, flip);
}
