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
 * plus `{ cameras: [...] }` wrapping the first.
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
  const cams = list.map(fromEntry).filter((c): c is Cam => c !== null);
  if (cams.length < 2) return null;
  cams.sort((a, b) => natural(a.name, b.name));
  let route: Vec3[] = [];
  for (const c of cams) {
    const p: Vec3 = flip ? [c.pos[0], -c.pos[1], -c.pos[2]] : c.pos;
    route = recordStep(route, p);
  }
  return route.length >= 2 ? { route: route.slice(0, 5000), cameras: cams.length } : null;
}
