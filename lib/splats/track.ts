// FOLLOWING A PRODUCT THROUGH A PHONE VIDEO (founder, 2026-10-12: "the dot
// moves with shopper, instead of being pinned to the product … the single
// most important issue"). The operator taps a product once; the walk page
// steps through the video around that moment and finds the same patch of
// picture in each frame, so the dot has a place at every step and stays on
// the product as the camera walks past it.
//
// Matching is normalised cross-correlation of a small grey patch in a window
// round where it was a step before — cheap, and indifferent to the light
// changing a little. The patch is refreshed a little each step (the product
// grows and turns as the camera passes), and the follow stops when the match
// gets poor or the product reaches the edge of the frame.
//
// Pure (no DOM): `components/virtual-bazaar/walk/followProduct.ts` draws the
// frames on a canvas and calls these.

/** RGBA → grey, one value per pixel. */
export function toGray(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  return out;
}

/** The `size`×`size` patch centred on (cx, cy) — the caller keeps it inside the frame (`clampCentre`). */
export function patchAt(frame: Float32Array, w: number, cx: number, cy: number, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const x0 = Math.round(cx) - (size >> 1), y0 = Math.round(cy) - (size >> 1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = frame[(y0 + y) * w + (x0 + x)];
  return out;
}

/** A centre that keeps a `size` patch inside a w×h frame. */
export function clampCentre(cx: number, cy: number, w: number, h: number, size: number): { x: number; y: number } {
  const half = size >> 1;
  return { x: Math.min(w - size + half, Math.max(half, Math.round(cx))), y: Math.min(h - size + half, Math.max(half, Math.round(cy))) };
}

/**
 * Where `template` (size×size) best matches `frame` within `radius` pixels of
 * (cx, cy): its centre and the match (normalised cross-correlation, −1…1; 1
 * is the same picture). A flat template (no detail to match) scores 0.
 */
export function matchPatch(
  frame: Float32Array, w: number, h: number, template: Float32Array, size: number, cx: number, cy: number, radius: number,
): { x: number; y: number; score: number } {
  const n = size * size;
  let tMean = 0;
  for (let i = 0; i < n; i++) tMean += template[i];
  tMean /= n;
  let tVar = 0;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) { t[i] = template[i] - tMean; tVar += t[i] * t[i]; }
  const half = size >> 1;
  let best = { x: Math.round(cx), y: Math.round(cy), score: -Infinity };
  if (tVar < 1e-6) return { ...best, score: 0 };
  for (let y = Math.round(cy) - radius; y <= Math.round(cy) + radius; y++) {
    if (y - half < 0 || y - half + size > h) continue;
    for (let x = Math.round(cx) - radius; x <= Math.round(cx) + radius; x++) {
      if (x - half < 0 || x - half + size > w) continue;
      let sum = 0, sum2 = 0, cross = 0;
      for (let py = 0; py < size; py++) {
        const row = (y - half + py) * w + (x - half);
        for (let px = 0; px < size; px++) {
          const v = frame[row + px];
          sum += v;
          sum2 += v * v;
          cross += v * t[py * size + px];
        }
      }
      const fVar = sum2 - (sum * sum) / n;
      if (fVar < 1e-6) continue;
      const score = cross / Math.sqrt(fVar * tVar);
      if (score > best.score) best = { x, y, score };
    }
  }
  return best.score === -Infinity ? { ...best, score: 0 } : best;
}

/** The patch a little towards what was just found: the product changes as the camera passes, a whole new patch drifts. */
export function refresh(template: Float32Array, found: Float32Array, k = 0.25): Float32Array {
  const out = new Float32Array(template.length);
  for (let i = 0; i < out.length; i++) out[i] = template[i] * (1 - k) + found[i] * k;
  return out;
}

/** Below this the product is lost (behind something, out of focus, gone). */
export const MIN_MATCH = 0.55;

/**
 * One step of a follow: from the product's last centre in the previous frame
 * to its centre in `frame`, or null when it is lost or at the frame's edge.
 */
export function followStep(
  frame: Float32Array, w: number, h: number, template: Float32Array, size: number, at: { x: number; y: number }, radius: number,
): { x: number; y: number; score: number; template: Float32Array } | null {
  const m = matchPatch(frame, w, h, template, size, at.x, at.y, radius);
  if (m.score < MIN_MATCH) return null;
  const half = size >> 1;
  if (m.x <= half || m.y <= half || m.x >= w - half - 1 || m.y >= h - half - 1) return null;
  return { ...m, template: refresh(template, patchAt(frame, w, m.x, m.y, size)) };
}
