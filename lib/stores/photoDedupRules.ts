// DUPLICATE PHOTOS (owner, 2026-11-23: "dedup … duplicate product will reduce shopper's confidence"). A photo's
// fingerprint is its difference hash: the photo is shrunk to 9×8 grey pixels, and each row is compared with the next
// (64 bits). Two pictures of the same thing, resized or re-saved, differ by a few bits. Pure: `node --test` runs it.

/** 72 grey bytes (9 wide, 8 high) → the 64-bit difference hash as 16 hex digits. */
export function dhashFromGray(px: ArrayLike<number>): string {
  let bits = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) bits += px[r * 9 + c] > px[r * 9 + c + 1] ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** How many bits two hashes differ in (0 = the same picture). */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Groups of pictures that look the same (within `max` bits). Each group lists its ids, the first id first. */
export function groupDuplicates(items: { id: string; hash: string }[], max = 5): string[][] {
  const groups: { ids: string[]; hash: string }[] = [];
  for (const it of items) {
    const g = groups.find((x) => hamming(x.hash, it.hash) <= max);
    if (g) g.ids.push(it.id); else groups.push({ ids: [it.id], hash: it.hash });
  }
  return groups.filter((g) => g.ids.length > 1).map((g) => g.ids);
}
