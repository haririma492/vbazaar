/**
 * THE RESTORED LOOK (founder, 2026-10-08: "really big for commercialization").
 * An Instagram beauty filter, but for a filmed bazaar street: the asphalt
 * looks new, the bricks shine, grime and stains fade, the colours are
 * pleasant. Founder, the same day: "restore ONLY iranianplaza1": a scene
 * gets it only when its tour entry says so (`TourScene.look`). Every other
 * scene stays "original", and so does any scene the tour says nothing about.
 *
 * ⚠️ LIVE, ON THE GRAPHICS CHIP, PER SPLAT. It is a Spark "world modifier":
 * a few lines of shader that every splat's colour passes through as Spark
 * prepares the splats to draw. Nothing is downloaded or kept in memory, the
 * file is untouched, and it is the same for a whole-file scene and a
 * streamed one (`.rad`, `paged`): Spark builds both meshes' splats through
 * one pipeline (read the splat → object modifiers → place it in the world
 * → seam planes (`SplatEdit`) → world modifiers). So the seams still hide
 * what they hide (we never touch opacity), and the streak filter (the
 * renderer's `minAlpha`/`maxPixelRadius`) still applies after.
 *
 * Every number is a uniform: switching Fresh ↔ Showroom, or the eye moving,
 * is a value change and a re-run, not a new shader. "original" attaches no
 * modifier at all — the scene is drawn exactly as before.
 *
 * WHAT IT DOES TO A SPLAT'S COLOUR, IN ORDER:
 *   white balance   a warm/cool gain per channel
 *   exposure        in stops
 *   fresh asphalt   below the eye, near-neutral and dark → one deep charcoal,
 *                   most of its variation (patches, stains) taken out
 *   grime lift      dark, low-saturation, yellow-brown/grey → cleaner neutral,
 *                   a little brighter (dirt is dark, dull and brownish)
 *   brick shine     warm red/orange mid tones → more colour, a little brighter
 *   shadow lift     the darkest tones raised
 *   contrast        a gentle S-curve
 *   vibrance        more colour where there is little (skin and the already
 *                   vivid are left nearly alone)
 */

import * as THREE from "three";
import type { SplatMesh, dyno as DynoNs } from "@sparkjsdev/spark";
import type { Look } from "@/lib/splats/tour";

type Dyno = typeof DynoNs;

/** One look's numbers. Identity: gains 1, everything else 0 (saturation 1). */
export type LookParams = {
  /** White balance gains (r, g, b): > 1 red and < 1 blue is warmer. */
  wb: [number, number, number];
  /** Exposure, in stops. */
  exposure: number;
  /** Raise the darkest tones (0 … ~0.2). */
  shadowLift: number;
  /** S-curve strength (0 … 1). */
  contrast: number;
  /** Colour boost weighted toward the dull (0 … 1). */
  vibrance: number;
  /** Plain saturation multiplier (1: unchanged). */
  saturation: number;
  /** Grime lift strength (0 … 1). */
  grime: number;
  /** Fresh asphalt strength (0 … 1). */
  asphalt: number;
  /** Brick shine strength (0 … 1). */
  brick: number;
  /** The asphalt's new colour. */
  charcoal: [number, number, number];
};

const FRESH: LookParams = {
  wb: [1.03, 1.0, 0.96], exposure: 0.12, shadowLift: 0.05, contrast: 0.16, vibrance: 0.35, saturation: 1.04,
  grime: 0.6, asphalt: 0.65, brick: 0.5, charcoal: [0.14, 0.14, 0.15],
};
const SHOWROOM: LookParams = {
  wb: [1.04, 1.0, 0.95], exposure: 0.2, shadowLift: 0.08, contrast: 0.24, vibrance: 0.5, saturation: 1.06,
  grime: 0.9, asphalt: 0.9, brick: 0.8, charcoal: [0.12, 0.12, 0.13],
};
export const LOOK_PRESETS: Record<Exclude<Look, "original">, LookParams> = { fresh: FRESH, showroom: SHOWROOM };

/**
 * How far below the eye the ground begins and is fully "ground", in scene
 * units (≈ metres: the walked route is at eye height and its blue band is
 * drawn 0.6 below it, on the ground ahead). A shop sign at eye height is
 * never asphalt, however grey; nor is the foot of a wall: a flat splat
 * standing upright (`lookUpright`) is wall, whatever its height.
 */
const GROUND_FROM = 0.5;
const GROUND_FULL = 1.0;

const GLSL = /* glsl */ `
  float lookLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float lookSat(vec3 c) {
    float hi = max(c.r, max(c.g, c.b));
    float lo = min(c.r, min(c.g, c.b));
    return (hi - lo) / max(hi, 1e-4);
  }
  // Hue in degrees, 0 … 360 (red 0, yellow 60).
  float lookHue(vec3 c) {
    float hi = max(c.r, max(c.g, c.b));
    float lo = min(c.r, min(c.g, c.b));
    float d = max(hi - lo, 1e-5);
    float h;
    if (hi == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (hi == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return 60.0 * h;
  }
  vec3 lookSaturate(vec3 c, float k) {
    float l = lookLuma(c);
    return vec3(l) + (c - vec3(l)) * k;
  }
  // Brightness changes go through the luminance, so a colour keeps its hue
  // (per channel, a bright red clips and drifts to orange).
  vec3 lookToLuma(vec3 c, float l1) {
    return c * (l1 / max(lookLuma(c), 1e-4));
  }
  // Into range without clipping: a channel past 1 is brought back by
  // desaturating toward its own brightness, not by cutting it (same hue).
  vec3 lookFit(vec3 c) {
    c = max(c, vec3(0.0));
    float l = min(lookLuma(c), 1.0);
    float hi = max(c.r, max(c.g, c.b));
    if (hi > 1.0) c = vec3(l) + (c - vec3(l)) * ((1.0 - l) / max(hi - l, 1e-4));
    return c;
  }
  // wb.rgb gains, wb.a exposure (stops); tone: lift, contrast, vibrance, saturation;
  // fix: grime, asphalt, brick, (unused); ground: charcoal rgb, eye height (world y).
  vec3 lookQuatVec(vec4 q, vec3 v) {
    vec3 t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
  }
  // How much a splat is a piece of wall (flat, and facing sideways): 0 for
  // one lying flat (the ground) and for a round one (no telling).
  float lookUpright(vec3 scales, vec4 quat) {
    float lo = min(scales.x, min(scales.y, scales.z));
    float hi = max(scales.x, max(scales.y, scales.z));
    float mid = scales.x + scales.y + scales.z - lo - hi;
    float flatness = 1.0 - smoothstep(0.2, 0.5, lo / max(mid, 1e-6));
    vec3 axis = lo == scales.x ? vec3(1.0, 0.0, 0.0) : (lo == scales.y ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
    float up = abs(lookQuatVec(quat, axis).y);
    return flatness * (1.0 - smoothstep(0.45, 0.8, up));
  }
  vec3 restoredLook(vec3 c0, float y, float upright, vec4 wb, vec4 tone, vec4 fix, vec4 ground) {
    vec3 c = max(c0, vec3(0.0)) * wb.rgb;
    // Exposure with a soft shoulder: mid tones brighten, white stays white.
    float f = exp2(wb.a);
    float l0 = lookLuma(c);
    c = lookToLuma(c, l0 * f / (1.0 + l0 * (f - 1.0)));

    float l = lookLuma(c);
    float s = lookSat(c);
    float hue = lookHue(c);

    // Fresh asphalt: below the eye, dark, near-neutral — or the dull
    // yellow-brown of a patch or a stain on it (the ground is never brick).
    float below = smoothstep(${GROUND_FROM.toFixed(2)}, ${GROUND_FULL.toFixed(2)}, ground.w - y) * (1.0 - upright);
    float earthy = hue < 70.0 ? 1.0 : 0.0;
    float neutral = 1.0 - smoothstep(mix(0.12, 0.30, earthy), mix(0.30, 0.50, earthy), s);
    float darkish = 1.0 - smoothstep(0.36, 0.62, l);
    float a = fix.y * below * neutral * darkish;
    // One charcoal, keeping a fifth of the old variation (texture, not stains).
    vec3 tarmac = ground.rgb * (1.0 + 0.2 * (l / max(lookLuma(ground.rgb), 1e-3) - 1.0));
    c = mix(c, tarmac, a);
    vec3 laid = c;

    // Grime lift: dark and dull, grey or yellow-brown (dirt) — not brick,
    // which is far more coloured — and not what just became asphalt. It is
    // made neutral and brought up toward the clean wall around it.
    float dirtHue = (hue > 12.0 && hue < 65.0) ? 1.0 : (s < 0.08 ? 1.0 : 0.3);
    float dull = 1.0 - smoothstep(0.30, 0.55, s);
    float dim = 1.0 - smoothstep(0.40, 0.68, l);
    float g = fix.x * dull * dim * dirtHue * (1.0 - a / max(fix.y, 1e-3));
    float lg = lookLuma(c);
    c = mix(c, vec3(lg), 0.75 * g);
    c = lookToLuma(c, lg + g * 0.65 * max(0.62 - lg, 0.0));
    c = lookFit(c);

    // Brick shine: warm reds and oranges, mid tones, already well coloured.
    float warm = (1.0 - smoothstep(25.0, 40.0, hue)) + smoothstep(340.0, 355.0, hue);
    float mid = smoothstep(0.08, 0.22, l) * (1.0 - smoothstep(0.65, 0.88, l));
    float b = fix.z * clamp(warm, 0.0, 1.0) * mid * smoothstep(0.35, 0.55, s) * (1.0 - below);
    c = lookSaturate(c, 1.0 + 0.3 * b);
    c *= 1.0 + 0.1 * b;
    c = lookFit(c);

    // Shadow lift and contrast, on the brightness.
    float l1 = clamp(lookLuma(c), 0.0, 1.0);
    float inv = 1.0 - l1;
    float l2 = l1 + tone.x * inv * inv * inv;
    l2 = mix(l2, l2 * l2 * (3.0 - 2.0 * l2), tone.y);
    c = lookFit(lookToLuma(c, l2));
    // Vibrance (more where there is little) and saturation.
    float s2 = lookSat(c);
    c = lookSaturate(c, (1.0 + tone.z * (1.0 - s2)) * tone.w);
    // The new asphalt stays the charcoal it was laid as.
    c = mix(c, laid, a);
    return clamp(lookFit(c), 0.0, 1.0);
  }
`;

/** The uniforms of one mesh's look: change their values, then `mesh.updateVersion()`. */
export type LookUniforms = {
  wb: { value: THREE.Vector4 };
  tone: { value: THREE.Vector4 };
  fix: { value: THREE.Vector4 };
  ground: { value: THREE.Vector4 };
};

export type LookHandle = { look: Look; uniforms: LookUniforms };

function setParams(u: LookUniforms, p: LookParams) {
  u.wb.value.set(p.wb[0], p.wb[1], p.wb[2], p.exposure);
  u.tone.value.set(p.shadowLift, p.contrast, p.vibrance, p.saturation);
  u.fix.value.set(p.grime, p.asphalt, p.brick, 0);
  u.ground.value.set(p.charcoal[0], p.charcoal[1], p.charcoal[2], u.ground.value.w);
}

/**
 * Give `mesh` this look (or take it away: "original"). Returns its handle, to
 * pass back next time (the same shader is kept when only the numbers change)
 * and to move the eye height with (`followEye`).
 */
export function applyLook(dyno: Dyno, mesh: SplatMesh, look: Look, prev: LookHandle | null, eyeY: number): LookHandle | null {
  if (look === "original") {
    if (prev) {
      mesh.worldModifier = undefined;
      mesh.updateGenerator();
    }
    return null;
  }
  if (prev) {
    if (prev.look !== look) setParams(prev.uniforms, LOOK_PRESETS[look]);
    mesh.updateVersion();
    return { look, uniforms: prev.uniforms };
  }
  // The values are placeholders here; `setParams` fills them.
  const vec4 = () => dyno.dynoVec4(new THREE.Vector4()) as unknown as { value: THREE.Vector4 };
  const u: LookUniforms = { wb: vec4(), tone: vec4(), fix: vec4(), ground: vec4() };
  setParams(u, LOOK_PRESETS[look]);
  u.ground.value.w = eyeY;
  const restore = new dyno.Dyno({
    inTypes: { gsplat: dyno.Gsplat, wb: "vec4", tone: "vec4", fix: "vec4", ground: "vec4" },
    outTypes: { gsplat: dyno.Gsplat },
    globals: () => [dyno.unindent(GLSL)],
    statements: ({ inputs, outputs }) => dyno.unindentLines(/* glsl */ `
      ${outputs.gsplat} = ${inputs.gsplat};
      if (isGsplatActive(${inputs.gsplat}.flags)) {
        ${outputs.gsplat}.rgba.rgb = restoredLook(${inputs.gsplat}.rgba.rgb, ${inputs.gsplat}.center.y,
          lookUpright(${inputs.gsplat}.scales, ${inputs.gsplat}.quaternion),
          ${inputs.wb}, ${inputs.tone}, ${inputs.fix}, ${inputs.ground});
      }
    `),
  });
  const modifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
    gsplat: restore.apply({
      gsplat,
      wb: u.wb as never,
      tone: u.tone as never,
      fix: u.fix as never,
      ground: u.ground as never,
    }).gsplat,
  }));
  // A WORLD modifier: the splat's centre is in the world's coordinates, so
  // "below the eye" is plain height, whatever the scene's flip or place.
  mesh.worldModifier = modifier;
  mesh.updateGenerator();
  return { look, uniforms: u };
}

/**
 * The eye moved up or down: the asphalt test follows. Only a change of a
 * couple of centimetres re-runs the splats (walking re-runs them anyway).
 */
export function followEye(mesh: SplatMesh, h: LookHandle, eyeY: number) {
  const g = h.uniforms.ground.value;
  if (Math.abs(g.w - eyeY) < 0.02) return;
  g.w = eyeY;
  mesh.updateVersion();
}
