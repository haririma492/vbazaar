/**
 * HOW A WALK VIDEO HOLDS ITS 360° PICTURE (founder, 2026-10-17: a 360° video
 * downloaded from YouTube was shown flat — "can the code fix it … option 1 go
 * ahead").
 *
 *   equirect   the usual panorama: longitude across, latitude down (2:1, or
 *              squeezed into 16:9 by some downloads)
 *   eac        YouTube's Equi-Angular Cubemap: six faces in a 3×2 grid —
 *              top row left · front · right, bottom row down · back · up (the
 *              bottom row turned) — each face's grid spaced by angle, not by
 *              distance. Checked against ffmpeg's `v360=e:eac` (97% of 4000
 *              sampled directions the same colour; the rest is edge blur).
 *   flat       not 360° at all (an ordinary phone video).
 *
 * `eacUv` is what the walk's shader does per pixel (Walk360.tsx, EAC_GLSL) —
 * kept here, in plain code, so it can be tested.
 */

export type Projection = "equirect" | "eac" | "flat";
export const PROJECTIONS: Projection[] = ["equirect", "eac", "flat"];

/**
 * Where a direction — `lon` (radians, + right, 0 = the video's front) and
 * `lat` (+ up) — is in an EAC frame: `u` across, `v` down, both 0…1.
 */
export function eacUv(lon: number, lat: number): { u: number; v: number } {
  const x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let u: number, v: number, cx: number, cy: number, r = 0;
  if (az >= ax && az >= ay) {
    if (z > 0) { u = x / az; v = -y / az; cx = 1; cy = 0; } else { u = -x / az; v = -y / az; cx = 1; cy = 1; r = 1; }
  } else if (ax >= ay) {
    if (x > 0) { u = -z / ax; v = -y / ax; cx = 2; cy = 0; } else { u = z / ax; v = -y / ax; cx = 0; cy = 0; }
  } else if (y > 0) { u = x / ay; v = z / ay; cx = 2; cy = 1; r = 3; } else { u = x / ay; v = -z / ay; cx = 0; cy = 1; r = 3; }
  if (r === 1) [u, v] = [-v, u];
  else if (r === 3) [u, v] = [v, -u];
  u = (4 / Math.PI) * Math.atan(u);
  v = (4 / Math.PI) * Math.atan(v);
  return { u: (cx + (u + 1) / 2) / 3, v: (cy + (v + 1) / 2) / 2 };
}

/** The same, for the GPU: a sphere's own uv (equirect: x = longitude, y = latitude up) → the EAC frame's uv (y up, as a texture is read). */
export const EAC_GLSL = /* glsl */ `
vec2 eacUv(vec2 suv) {
  float lon = (suv.x - 0.5) * 6.28318531;
  float lat = (suv.y - 0.5) * 3.14159265;
  vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  vec3 a = abs(d);
  float u; float v; vec2 cell; int r = 0;
  if (a.z >= a.x && a.z >= a.y) {
    if (d.z > 0.0) { u = d.x / a.z; v = -d.y / a.z; cell = vec2(1.0, 0.0); }
    else { u = -d.x / a.z; v = -d.y / a.z; cell = vec2(1.0, 1.0); r = 1; }
  } else if (a.x >= a.y) {
    if (d.x > 0.0) { u = -d.z / a.x; v = -d.y / a.x; cell = vec2(2.0, 0.0); }
    else { u = d.z / a.x; v = -d.y / a.x; cell = vec2(0.0, 0.0); }
  } else if (d.y > 0.0) { u = d.x / a.y; v = d.z / a.y; cell = vec2(2.0, 1.0); r = 3; }
  else { u = d.x / a.y; v = -d.z / a.y; cell = vec2(0.0, 1.0); r = 3; }
  if (r == 1) { float t = u; u = -v; v = t; } else if (r == 3) { float t = u; u = v; v = -t; }
  u = atan(u) * 1.27323954;
  v = atan(v) * 1.27323954;
  // A little inside each face: sampling across a face's edge would pick up its neighbour.
  vec2 f = clamp(vec2(u, v) * 0.5 + 0.5, 0.004, 0.996);
  return vec2((cell.x + f.x) / 3.0, 1.0 - (cell.y + f.y) / 2.0);
}
`;
