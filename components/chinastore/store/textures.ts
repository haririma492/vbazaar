import * as THREE from "three";

/**
 * The simulated store's surfaces, painted on a canvas at load: honed marble,
 * walnut veneer, a grasscloth wallcovering, plaster. Seamless (periodic
 * noise), with a normal map derived from the same height so the light rakes
 * across the grain.
 */

// ── periodic noise ─────────────────────────────────────────────────────────

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise that tiles with period (px, py) lattice cells. */
function pnoise(x: number, y: number, px: number, py: number, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (a: number, p: number) => ((a % p) + p) % p;
  const a = hash(w(xi, px), w(yi, py), seed);
  const b = hash(w(xi + 1, px), w(yi, py), seed);
  const c = hash(w(xi, px), w(yi + 1, py), seed);
  const d = hash(w(xi + 1, px), w(yi + 1, py), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function pfbm(x: number, y: number, px: number, py: number, oct: number, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * pnoise(x * f, y * f, px * f, py * f, seed + i * 31);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}

type Painted = { color: THREE.Texture; normal: THREE.Texture; rough?: THREE.Texture };

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat: [number, number]) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Height (0..1 per pixel) → tangent-space normal map. */
function normalFrom(height: Float32Array, w: number, h: number, strength: number) {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      img.data[k] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function paint(
  w: number,
  h: number,
  fn: (x: number, y: number) => { rgb: [number, number, number]; height: number; rough?: number },
  repeat: [number, number],
  normalStrength: number,
  withRough = false,
): Painted {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const height = new Float32Array(w * h);
  const rc = withRough ? canvas(w, h) : null;
  const rimg = rc ? rc.getContext("2d")!.createImageData(w, h) : null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = fn(x, y);
      const k = (y * w + x) * 4;
      img.data[k] = Math.min(255, s.rgb[0] * 255);
      img.data[k + 1] = Math.min(255, s.rgb[1] * 255);
      img.data[k + 2] = Math.min(255, s.rgb[2] * 255);
      img.data[k + 3] = 255;
      height[y * w + x] = s.height;
      if (rimg) {
        const r = Math.min(255, (s.rough ?? 0.5) * 255);
        rimg.data[k] = r;
        rimg.data[k + 1] = r;
        rimg.data[k + 2] = r;
        rimg.data[k + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
  if (rc && rimg) rc.getContext("2d")!.putImageData(rimg, 0, 0);
  return {
    color: toTexture(c, true, repeat),
    normal: toTexture(normalFrom(height, w, h, normalStrength), false, repeat),
    rough: rc ? toTexture(rc, false, repeat) : undefined,
  };
}

const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Honed Calacatta-like marble in 80 cm tiles, 2 × 2 tiles per texture,
 * with fine grout lines. Each tile draws a different stretch of the veins.
 */
export function marbleFloor(repeat: [number, number]): Painted {
  const S = 1024;
  const BASE = [0.9, 0.885, 0.86];
  const VEIN = [0.55, 0.53, 0.5];
  const GOLDV = [0.72, 0.64, 0.52];
  return paint(S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const tx = Math.floor(u * 2);
    const ty = Math.floor(v * 2);
    const lu = u * 2 - tx;
    const lv = v * 2 - ty;
    const grout = Math.min(lu, 1 - lu, lv, 1 - lv) * 512;
    const seed = tx * 7 + ty * 13;
    const warp = pfbm(u * 6, v * 6, 6, 6, 5, seed);
    const flow = Math.sin((lu * 0.8 + lv * 1.6) * 5 + warp * 9 + seed);
    const vein = Math.pow(1 - Math.abs(flow), 18);
    const fine = Math.pow(1 - Math.abs(Math.sin((lu * 2.2 - lv * 0.7) * 9 + warp * 14 + seed * 2)), 40);
    const cloud = pfbm(u * 12, v * 12, 12, 12, 4, seed + 5);
    let rgb = mix3(BASE, [0.86, 0.85, 0.83], cloud * 0.6);
    rgb = mix3(rgb, GOLDV, vein * 0.55);
    rgb = mix3(rgb, VEIN, fine * 0.35 + vein * 0.2);
    let height = 0.5 + cloud * 0.05;
    if (grout < 1.6) {
      const g = 1 - grout / 1.6;
      rgb = mix3(rgb, [0.62, 0.6, 0.57], g);
      height -= g * 0.6;
    }
    return { rgb, height, rough: 0.32 + cloud * 0.12 + (grout < 1.6 ? 0.4 : 0) };
  }, repeat, 2.5, true);
}

/** Polished white marble for the counter top and the plinth. */
export function marbleSlab(repeat: [number, number]): Painted {
  const S = 1024;
  return paint(S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const warp = pfbm(u * 4, v * 4, 4, 4, 5, 3);
    const flow = Math.sin((u * 1.4 + v * 0.6) * 6.283 * 2 + warp * 10);
    const vein = Math.pow(1 - Math.abs(flow), 22);
    const cloud = pfbm(u * 9, v * 9, 9, 9, 4, 9);
    let rgb = mix3([0.93, 0.925, 0.91], [0.88, 0.875, 0.86], cloud * 0.7);
    rgb = mix3(rgb, [0.5, 0.49, 0.48], vein * 0.6);
    return { rgb, height: 0.5, rough: 0.12 + cloud * 0.06 };
  }, repeat, 0.5, true);
}

/** Walnut veneer: grain running along u. */
export function walnut(repeat: [number, number]): Painted {
  const W = 512;
  const H = 1024;
  return paint(W, H, (x, y) => {
    const u = x / W;
    const v = y / H;
    const warp = pfbm(u * 4, v * 3, 4, 3, 4, 21);
    const rings = Math.sin((u * 64 + warp * 2.2 + pfbm(u * 30, v * 2, 30, 2, 2, 5) * 0.8) * Math.PI * 2);
    const ring = Math.pow(rings * 0.5 + 0.5, 4);
    const pores = pfbm(u * 220, v * 8, 220, 8, 2, 4);
    const fig = pfbm(u * 10, v * 40, 10, 40, 3, 8);
    let rgb = mix3([0.25, 0.165, 0.11], [0.17, 0.105, 0.065], ring * 0.45 + fig * 0.35);
    rgb = mix3(rgb, [0.13, 0.075, 0.045], Math.pow(pores, 4) * 0.5);
    return { rgb, height: 0.5 + ring * 0.08 - Math.pow(pores, 4) * 0.25, rough: 0.42 + ring * 0.1 };
  }, repeat, 1.5, true);
}

/** Grasscloth wallcovering: horizontal fibres in a deep blue-green. */
export function grasscloth(repeat: [number, number]): Painted {
  const W = 512;
  const H = 512;
  return paint(W, H, (x, y) => {
    const u = x / W;
    const v = y / H;
    const fibre = pfbm(u * 6, v * 220, 6, 220, 3, 11);
    const slub = pfbm(u * 40, v * 60, 40, 60, 2, 2);
    const warpThread = Math.pow(Math.abs(Math.sin(u * Math.PI * 128)), 30);
    const k = fibre * 0.7 + slub * 0.3;
    let rgb = mix3([0.05, 0.085, 0.11], [0.11, 0.16, 0.19], k);
    rgb = mix3(rgb, [0.03, 0.05, 0.07], warpThread * 0.5);
    return { rgb, height: k * 0.6 - warpThread * 0.2, rough: 0.85 };
  }, repeat, 3, false);
}

/** Warm limewashed plaster. */
export function plaster(repeat: [number, number]): Painted {
  const S = 512;
  return paint(S, S, (x, y) => {
    const u = x / S;
    const v = y / S;
    const m = pfbm(u * 5, v * 5, 5, 5, 5, 17);
    const fine = pfbm(u * 60, v * 60, 60, 60, 2, 3);
    const rgb = mix3([0.5, 0.455, 0.405], [0.57, 0.52, 0.465], m);
    return { rgb, height: m * 0.3 + fine * 0.15, rough: 0.9 };
  }, repeat, 1.2, false);
}

/** A soft radial glow, white at the centre — the product highlight's halo. */
export function glowTexture(): THREE.Texture {
  const c = canvas(256, 256);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,244,222,1)");
  g.addColorStop(0.35, "rgba(255,236,200,0.45)");
  g.addColorStop(1, "rgba(255,230,190,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Engraved store name for the lintel: a canvas of brass letters on black. */
export function signTexture(text: string, sub: string): THREE.Texture {
  const c = canvas(2048, 256);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0d0d0e";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const grad = ctx.createLinearGradient(0, 40, 0, 200);
  grad.addColorStop(0, "#e9cf98");
  grad.addColorStop(0.5, "#b08a4f");
  grad.addColorStop(1, "#d9bb83");
  ctx.fillStyle = grad;
  ctx.font = '500 104px "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif';
  ctx.fillText(spaced(text), 1024, 112);
  ctx.font = '400 34px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(spaced(sub), 1024, 202);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const spaced = (s: string) => s.split("").join(" ");
