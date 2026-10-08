/**
 * READING AND WRITING A SCENE'S SPLATS ON THE SERVER (for the 3D retouch,
 * `retouch.ts`). Node only (fs, zlib); no Spark — its package is a browser
 * bundle.
 *
 * Why these two formats: Spark's `build-lod` (bin/build-lod) reads .ply/.spz
 * and writes only .spz/.rad, never .ply. So a scene's file (.spz web copy or
 * .ply master) is read here, retouched as typed arrays, written as a plain
 * 3DGS binary .ply (lossless float32, the format every tool reads), and
 * `build-lod` makes the streamed .rad from that .ply.
 *
 *   .ply  binary_little_endian 3DGS: x y z, f_dc_0..2, f_rest_*, opacity
 *         (logit), scale_0..2 (log), rot_0..3 (w x y z). Other properties
 *         (nx ny nz, …) are skipped.
 *   .spz  Niantic's gzip of fixed-point arrays, versions 2 and 3 (what Spark
 *         2.3.1 writes; v3 packs rotations "smallest three"). Read as a
 *         stream: the inflated bytes are never all in memory at once.
 *
 * Values are kept as Spark reads them, with no change of axes, so the .ply
 * written here shows exactly as the source did.
 *
 * ⚠️ IMPORT-FREE apart from node built-ins and a type, so the CLI
 * (`scripts/retouch.mts`, node --experimental-strip-types) loads it as is.
 */
import { closeSync, createReadStream, openSync, readSync, writeSync } from "node:fs";
import { createGunzip } from "node:zlib";
import type { Splats } from "./retouch";

/** SH coefficients per colour channel beyond DC, by degree. */
export const shCoeffs = (degree: number) => [0, 3, 8, 15][degree] ?? 0;
const degreeOf = (coeffs: number) => (coeffs >= 15 ? 3 : coeffs >= 8 ? 2 : coeffs >= 3 ? 1 : 0);

export function emptySplats(count: number, shDegree: number): Splats {
  return {
    count,
    shDegree,
    pos: new Float32Array(count * 3),
    dc: new Float32Array(count * 3),
    alpha: new Float32Array(count),
    logScale: new Float32Array(count * 3),
    rot: new Float32Array(count * 4),
    sh: new Float32Array(count * 3 * shCoeffs(shDegree)),
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (a: number) => {
  const c = Math.min(Math.max(a, 1e-6), 1 - 1e-6);
  return Math.log(c / (1 - c));
};

export async function readSplats(path: string, maxSh = 3): Promise<Splats> {
  if (/\.ply$/i.test(path)) return readPly(path, maxSh);
  if (/\.spz$/i.test(path)) return readSpz(path, maxSh);
  throw new Error(`the retouch reads .ply or .spz, not ${path.split(".").pop()}`);
}

// ── PLY ─────────────────────────────────────────────────────────────────────

const PLY_SIZES: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8,
};

export function readPly(path: string, maxSh = 3): Splats {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(64 * 1024);
    const got = readSync(fd, head, 0, head.length, 0);
    const text = head.subarray(0, got).toString("latin1");
    const end = text.indexOf("end_header\n");
    if (!text.startsWith("ply") || end < 0) throw new Error("not a .ply file");
    const lines = text.slice(0, end).split("\n").map((l) => l.trim());
    if (!lines.some((l) => l === "format binary_little_endian 1.0")) throw new Error("only binary little-endian .ply is read");
    let count = -1;
    let inVertex = false;
    let seenVertex = false;
    const props: { name: string; type: string; offset: number }[] = [];
    let stride = 0;
    for (const l of lines) {
      const w = l.split(/\s+/);
      if (w[0] === "element") {
        if (seenVertex && inVertex) inVertex = false;
        if (w[1] === "vertex") {
          if (seenVertex) throw new Error("two vertex elements");
          count = Number(w[2]);
          inVertex = seenVertex = true;
        } else if (!seenVertex) throw new Error(".ply has an element before its vertices");
      } else if (w[0] === "property" && inVertex) {
        if (w[1] === "list") throw new Error("list properties in vertices are not read");
        const size = PLY_SIZES[w[1]];
        if (!size) throw new Error(`unknown .ply type ${w[1]}`);
        props.push({ name: w[2], type: w[1], offset: stride });
        stride += size;
      }
    }
    if (!(count >= 0)) throw new Error(".ply has no vertices");
    const at = (name: string) => props.find((p) => p.name === name) ?? null;
    for (const need of ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]) {
      if (!at(need)) throw new Error(`.ply lacks «${need}» — not a 3DGS scene`);
    }
    let rest = 0;
    while (at(`f_rest_${rest}`)) rest++;
    const fileCoeffs = Math.floor(rest / 3);
    const degree = Math.min(degreeOf(fileCoeffs), Math.max(0, maxSh));
    const K = shCoeffs(degree);
    const s = emptySplats(count, degree);

    // Destination of each needed property: [array, stride, offset].
    type Slot = { prop: { type: string; offset: number }; arr: Float32Array; st: number; off: number; fn?: (v: number) => number };
    const slots: Slot[] = [];
    const put = (name: string, arr: Float32Array, st: number, off: number, fn?: (v: number) => number) =>
      slots.push({ prop: at(name)!, arr, st, off, fn });
    ["x", "y", "z"].forEach((n, k) => put(n, s.pos, 3, k));
    [0, 1, 2].forEach((k) => put(`f_dc_${k}`, s.dc, 3, k));
    put("opacity", s.alpha, 1, 0, sigmoid);
    [0, 1, 2].forEach((k) => put(`scale_${k}`, s.logScale, 3, k));
    [0, 1, 2, 3].forEach((k) => put(`rot_${k}`, s.rot, 4, k));
    for (let d = 0; d < 3; d++) for (let k = 0; k < K; k++) put(`f_rest_${d * fileCoeffs + k}`, s.sh, 3 * K, d * K + k);

    const allFloat = slots.every((sl) => sl.prop.type === "float" || sl.prop.type === "float32") && stride % 4 === 0;
    const rowsPer = Math.max(1, Math.floor((8 << 20) / Math.max(stride, 1)));
    const chunk = new Uint8Array(rowsPer * stride);
    const f32 = new Float32Array(chunk.buffer);
    const dv = new DataView(chunk.buffer);
    let filePos = end + "end_header\n".length;
    for (let done = 0; done < count; ) {
      const rows = Math.min(rowsPer, count - done);
      const bytes = rows * stride;
      let have = 0;
      while (have < bytes) {
        const r = readSync(fd, chunk, have, bytes - have, filePos + have);
        if (r <= 0) throw new Error(".ply is cut short");
        have += r;
      }
      filePos += bytes;
      for (const sl of slots) {
        const { arr, st, off, fn } = sl;
        if (allFloat) {
          const w = stride >> 2;
          const p = sl.prop.offset >> 2;
          for (let r = 0, j = (done * st) + off; r < rows; r++, j += st) arr[j] = fn ? fn(f32[r * w + p]) : f32[r * w + p];
        } else {
          const t = sl.prop.type;
          for (let r = 0, j = (done * st) + off; r < rows; r++, j += st) {
            const o = r * stride + sl.prop.offset;
            const v = t === "double" || t === "float64" ? dv.getFloat64(o, true) : t === "float" || t === "float32" ? dv.getFloat32(o, true)
              : t === "uchar" || t === "uint8" ? dv.getUint8(o) : t === "char" || t === "int8" ? dv.getInt8(o)
              : t === "short" || t === "int16" ? dv.getInt16(o, true) : t === "ushort" || t === "uint16" ? dv.getUint16(o, true)
              : t === "uint" || t === "uint32" ? dv.getUint32(o, true) : dv.getInt32(o, true);
            arr[j] = fn ? fn(v) : v;
          }
        }
      }
      done += rows;
    }
    return s;
  } finally {
    closeSync(fd);
  }
}

/**
 * Write `s` as a 3DGS binary .ply, leaving out the splats whose `keep` is 0.
 * Returns how many were written.
 */
export function writePly(path: string, s: Splats, keep?: Uint8Array | null): number {
  const K = shCoeffs(s.shDegree);
  const names = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", ...Array.from({ length: 3 * K }, (_, i) => `f_rest_${i}`),
    "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  let kept = 0;
  for (let i = 0; i < s.count; i++) if (!keep || keep[i]) kept++;
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${kept}\n${names.map((n) => `property float ${n}`).join("\n")}\nend_header\n`;
  const fd = openSync(path, "w");
  try {
    writeSync(fd, header);
    const w = names.length;
    const rowsPer = 65536;
    const buf = new Float32Array(rowsPer * w);
    let rows = 0;
    const flush = () => {
      if (rows) writeSync(fd, new Uint8Array(buf.buffer, 0, rows * w * 4));
      rows = 0;
    };
    for (let i = 0; i < s.count; i++) {
      if (keep && !keep[i]) continue;
      let o = rows * w;
      buf[o++] = s.pos[i * 3]; buf[o++] = s.pos[i * 3 + 1]; buf[o++] = s.pos[i * 3 + 2];
      buf[o++] = s.dc[i * 3]; buf[o++] = s.dc[i * 3 + 1]; buf[o++] = s.dc[i * 3 + 2];
      for (let k = 0, b = i * 3 * K; k < 3 * K; k++) buf[o++] = s.sh[b + k];
      buf[o++] = logit(s.alpha[i]);
      buf[o++] = s.logScale[i * 3]; buf[o++] = s.logScale[i * 3 + 1]; buf[o++] = s.logScale[i * 3 + 2];
      buf[o++] = s.rot[i * 4]; buf[o++] = s.rot[i * 4 + 1]; buf[o++] = s.rot[i * 4 + 2]; buf[o++] = s.rot[i * 4 + 3];
      if (++rows === rowsPer) flush();
    }
    flush();
  } finally {
    closeSync(fd);
  }
  return kept;
}

// ── SPZ ─────────────────────────────────────────────────────────────────────

const SPZ_MAGIC = 0x5053474e; // "NGSP"

/**
 * Decode an SPZ byte stream (already inflated), fed in pieces. Sections in
 * order: centres (i24 × 3, fixed point), alphas, colours, scales, rotations,
 * SH — each for every splat before the next.
 */
export class SpzDecoder {
  splats: Splats | null = null;
  private pending: Buffer = Buffer.alloc(0);
  private version = 0;
  private fileDegree = 0;
  private frac = 1;
  private stage = 0;
  private next = 0;
  private maxSh: number;
  constructor(maxSh = 3) {
    this.maxSh = maxSh;
  }

  push(bytes: Buffer) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, bytes]) : bytes;
    if (!this.splats) {
      if (this.pending.length < 16) return;
      const b = this.pending;
      if (b.readUInt32LE(0) !== SPZ_MAGIC) throw new Error("not an .spz file");
      this.version = b.readUInt32LE(4);
      if (this.version < 2 || this.version > 3) throw new Error(`.spz version ${this.version} is not read (2 and 3 are)`);
      const count = b.readUInt32LE(8);
      this.fileDegree = b[12];
      this.frac = 2 ** b[13];
      if (b[14] & 0x80) throw new Error("this .spz is already a level-of-detail file: retouch the scene's own file");
      this.splats = emptySplats(count, Math.min(this.fileDegree, Math.max(0, this.maxSh)));
      this.pending = b.subarray(16);
    }
    this.drain();
  }

  get done() {
    return !!this.splats && this.stage === 6;
  }

  private drain() {
    const s = this.splats!;
    const n = s.count;
    const fileK = shCoeffs(this.fileDegree);
    const K = shCoeffs(s.shDegree);
    const sizes = [9, 1, 3, 3, this.version === 3 ? 4 : 3, 3 * fileK];
    const b = this.pending;
    let at = 0;
    while (this.stage < 6) {
      const size = sizes[this.stage];
      const items = size ? Math.min(n - this.next, Math.floor((b.length - at) / size)) : n - this.next;
      for (let i = this.next, o = at; i < this.next + items; i++, o += size) {
        switch (this.stage) {
          case 0:
            for (let k = 0; k < 3; k++) {
              const v = b[o + 3 * k] | (b[o + 3 * k + 1] << 8) | (b[o + 3 * k + 2] << 16);
              s.pos[i * 3 + k] = ((v & 0x800000 ? v | ~0xffffff : v)) / this.frac;
            }
            break;
          case 1:
            s.alpha[i] = b[o] / 255;
            break;
          case 2:
            for (let k = 0; k < 3; k++) s.dc[i * 3 + k] = (b[o + k] / 255 - 0.5) / 0.15;
            break;
          case 3:
            for (let k = 0; k < 3; k++) s.logScale[i * 3 + k] = b[o + k] / 16 - 10;
            break;
          case 4: {
            // Stored x y z (w): kept here as the .ply's rot_0..3 = w x y z.
            let x: number, y: number, z: number, w: number;
            if (this.version === 3) {
              const comp = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
              const largest = comp >>> 30;
              const q = [0, 0, 0, 0];
              let rem = comp;
              let sum = 0;
              for (let j = 3; j >= 0; j--) {
                if (j === largest) continue;
                const mag = rem & 511;
                const neg = (rem >>> 9) & 1;
                rem >>>= 10;
                const v = Math.SQRT1_2 * (mag / 511) * (neg ? -1 : 1);
                q[j] = v;
                sum += v * v;
              }
              q[largest] = Math.sqrt(Math.max(0, 1 - sum));
              [x, y, z, w] = q;
            } else {
              x = b[o] / 127.5 - 1;
              y = b[o + 1] / 127.5 - 1;
              z = b[o + 2] / 127.5 - 1;
              w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
            }
            s.rot[i * 4] = w; s.rot[i * 4 + 1] = x; s.rot[i * 4 + 2] = y; s.rot[i * 4 + 3] = z;
            break;
          }
          case 5:
            // SPZ: coefficient-major (k, then channel); .ply: channel-major.
            for (let d = 0; d < 3; d++) for (let k = 0; k < K; k++) s.sh[i * 3 * K + d * K + k] = (b[o + k * 3 + d] - 128) / 128;
            break;
        }
      }
      this.next += items;
      at += items * size;
      if (this.next < n) break;
      this.next = 0;
      this.stage++;
    }
    this.pending = b.subarray(at);
  }
}

export async function readSpz(path: string, maxSh = 3): Promise<Splats> {
  const dec = new SpzDecoder(maxSh);
  const gunzip = createGunzip();
  createReadStream(path).on("error", (e) => gunzip.destroy(e)).pipe(gunzip);
  for await (const piece of gunzip) {
    dec.push(piece as Buffer);
    if (dec.done) break;
  }
  if (!dec.done || !dec.splats) throw new Error(".spz is cut short");
  gunzip.destroy();
  return dec.splats;
}
