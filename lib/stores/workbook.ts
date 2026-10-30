/**
 * A STORE'S WORKBOOK, ALL OF IT (owner, 2026-10-30: "we upload the
 * spreadsheet with the photo with the product number and the prices … another
 * sheet or two sheets in one workbook that has the product number and then
 * photos … it is the duty of your code to find out this is this").
 *
 * `lib/splats/xlsx.ts` reads the first sheet's text. This reads every sheet,
 * and every picture in the workbook with the cell it sits on:
 *
 *   floating     a picture placed over the sheet (Insert → Pictures): its
 *                anchor in `xl/drawings/drawingN.xml` names the row and column
 *                of its top-left corner
 *   in a cell    Excel's «Place in cell» (=IMAGE or Insert → Picture → Place
 *                in Cell): the cell carries `vm="k"`, which leads through
 *                `xl/metadata.xml` and `xl/richData/` to the file
 *
 * Then the product sheet is the one `parseSheet` reads most products from,
 * and each picture belongs to the product on its row (`photosByProduct`).
 * A sheet that lists product number → photo file name (or photo number) is
 * read as the photo list (`photoList`).
 */

import { strFromU8, unzipSync } from "fflate";
import { parseSheet, type Product } from "../splats/catalogue";

export type Picture = { sheet: string; row: number; col: number; name: string; bytes: Uint8Array };
export type Book = { sheets: Array<{ name: string; rows: string[][] }>; pictures: Picture[] };

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** `xl/worksheets/_rels/sheet1.xml.rels`'s Id → target, made whole against `dir`. */
function relsOf(files: Record<string, Uint8Array>, relsPath: string, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const xml = files[relsPath] ? strFromU8(files[relsPath]) : "";
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) out.set(id, resolve(dir, target));
  }
  return out;
}

function resolve(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = dir.split("/").filter(Boolean);
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const relsPathOf = (path: string) => `${dirOf(path)}/_rels/${path.split("/").pop()}.rels`;

export function readBook(bytes: Uint8Array): Book {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This is not an .xlsx file (it could not be opened). Save it as Excel Workbook (.xlsx).");
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const wbRels = relsOf(files, "xl/_rels/workbook.xml.rels", "xl");
  const inCell = inCellPictures(files);

  const sheets: Book["sheets"] = [];
  const pictures: Picture[] = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decode(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const path = (rid && wbRels.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = text(path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
      const row: string[] = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], body = cm[2] ?? "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const col = ref ? columnOf(ref) : row.length;
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = texts(body);
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (type !== "e" && v !== undefined) value = decode(v);
        row[col] = value;
        const vm = /\bvm="(\d+)"/.exec(attrs)?.[1];
        const pic = vm ? inCell.get(Number(vm)) : undefined;
        if (pic && files[pic]) pictures.push({ sheet: name, row: r, col, name: pic.split("/").pop()!, bytes: files[pic] });
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
      rows[r] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });

    // Floating pictures: the sheet's drawing, each anchor's top-left cell.
    const sheetRels = relsOf(files, relsPathOf(path), dirOf(path));
    for (const dm of xml.matchAll(/<drawing\b[^>]*\br:id="([^"]+)"/g)) {
      const drawing = sheetRels.get(dm[1]);
      if (!drawing || !files[drawing]) continue;
      const dRels = relsOf(files, relsPathOf(drawing), dirOf(drawing));
      const dxml = strFromU8(files[drawing]);
      for (const am of dxml.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g)) {
        const from = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(am[0])?.[1] ?? "";
        const col = Number(/<xdr:col>(\d+)<\/xdr:col>/.exec(from)?.[1] ?? NaN);
        const row = Number(/<xdr:row>(\d+)<\/xdr:row>/.exec(from)?.[1] ?? NaN);
        const embed = /r:embed="([^"]+)"/.exec(am[0])?.[1];
        const media = embed ? dRels.get(embed) : undefined;
        if (Number.isFinite(row) && Number.isFinite(col) && media && files[media]) {
          pictures.push({ sheet: name, row, col, name: media.split("/").pop()!, bytes: files[media] });
        }
      }
    }
  }
  if (!sheets.length) throw new Error("The workbook has no sheet to read.");
  return { sheets, pictures };
}

/** «Place in cell» pictures: a cell's `vm` (1-based) → the media file. */
function inCellPictures(files: Record<string, Uint8Array>): Map<number, string> {
  const out = new Map<number, string>();
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  const meta = text("xl/metadata.xml");
  if (!meta) return out;
  // valueMetadata's k-th <bk> → its <rc v="i"> → futureMetadata's i-th rich value index.
  const futures = [...meta.matchAll(/<xlrd:rvb\b[^>]*\bi="(\d+)"/g)].map((m) => Number(m[1]));
  const valueBlock = /<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/.exec(meta)?.[1] ?? "";
  const vms = [...valueBlock.matchAll(/<bk>[\s\S]*?<rc\b[^>]*\bv="(\d+)"[\s\S]*?<\/bk>/g)].map((m) => Number(m[1]));
  // Each rich value's first <v> is its index into richValueRel (the _rvRel:LocalImageIdentifier key).
  const values = [...text("xl/richData/rdrichvalue.xml").matchAll(/<rv\b[^>]*>([\s\S]*?)<\/rv>/g)].map((m) => Number(/<v>(\d+)<\/v>/.exec(m[1])?.[1] ?? NaN));
  const relIds = [...text("xl/richData/richValueRel.xml").matchAll(/<rel\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]);
  const rels = relsOf(files, "xl/richData/_rels/richValueRel.xml.rels", "xl/richData");
  vms.forEach((rc, k) => {
    const rv = futures[rc] ?? rc;
    const relIndex = values[rv];
    const media = Number.isFinite(relIndex) ? rels.get(relIds[relIndex]) : undefined;
    if (media) out.set(k + 1, media);
  });
  return out;
}

/** A header row that names the merchant's product number and a title but no Sarekooche number gets one: 1, 2, 3… in row order. */
export function withNumbers(rows: string[][]): string[][] {
  const first = parseSheet(rows);
  if (first.products.length) return rows;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const h = rows[r].map((c) => String(c ?? "").trim().toLowerCase());
    const titled = h.some((c) => /title|name|نام|عنوان|product|کالا/.test(c));
    if (!titled) continue;
    let n = 0;
    return rows.map((row, i) => (i < r ? ["", ...row] : i === r ? ["number", ...row] : row.some((v) => String(v ?? "").trim()) ? [String(++n), ...row] : ["", ...row]));
  }
  return rows;
}

/** The product sheet: the one that gives most products. Its rows, and which sheet row each product came from. */
export function productSheet(book: Book): { sheet: string; products: Product[]; problems: string[]; rowOf: Map<number, number> } | null {
  let best: ReturnType<typeof productSheet> = null;
  for (const s of book.sheets) {
    const rows = withNumbers(s.rows);
    const { products, problems } = parseSheet(rows);
    if (!products.length || (best && best.products.length >= products.length)) continue;
    // parseSheet keeps the sheet's numbers and titles; find each product's row again by both.
    const rowOf = new Map<number, number>();
    for (const p of products) {
      const title = (p.en ?? p.fa ?? "").trim();
      const r = rows.findIndex((row) => row.some((c) => String(c ?? "").trim() === String(p.n)) && row.some((c) => String(c ?? "").trim().slice(0, 120) === title));
      if (r >= 0) rowOf.set(p.n, r);
    }
    best = { sheet: s.name, products, problems, rowOf };
  }
  return best;
}

/** Digits of a name or number, without leading zeros: «IMG_0112.jpg» → «112», «SKU-00045» → «45». */
export const digitsOf = (s: string) => (s.replace(/\.[a-z0-9]+$/i, "").match(/\d+/g) ?? []).map((d) => d.replace(/^0+(?=\d)/, ""));

/**
 * A PHOTO LIST SHEET: any other sheet whose header names a product (number or
 * code) and a photo (file name, photo number or picture). Each row: the
 * product it names → the photo's name or number (and the row, for a picture
 * placed on it).
 */
export function photoList(book: Book, products: Product[], productSheetName: string): Array<{ n: number; photo: string; sheet: string; row: number }> {
  const out: Array<{ n: number; photo: string; sheet: string; row: number }> = [];
  for (const s of book.sheets) {
    if (s.name === productSheetName) continue;
    let header = -1, pCol = -1, fCol = -1;
    for (let r = 0; r < Math.min(s.rows.length, 15) && header < 0; r++) {
      const h = s.rows[r].map((c) => String(c ?? "").trim().toLowerCase());
      const p = h.findIndex((c) => /product|sku|code|item|number|^n$|^#$|شماره|کد|کالا/.test(c) && !/photo|image|عکس|تصویر/.test(c));
      const f = h.findIndex((c) => /photo|image|picture|pic|file|عکس|تصویر/.test(c));
      if (p >= 0 && f >= 0) { header = r; pCol = p; fCol = f; }
    }
    if (header < 0) continue;
    for (let r = header + 1; r < s.rows.length; r++) {
      const row = s.rows[r];
      const ref = String(row[pCol] ?? "").trim();
      if (!ref) continue;
      const product = productByRef(products, ref);
      if (!product) continue;
      out.push({ n: product.n, photo: String(row[fCol] ?? "").trim(), sheet: s.name, row: r });
    }
  }
  return out;
}

/** The product a sheet or a file name means: its Sarekooche number, or the merchant's own code (digits compared). */
export function productByRef(products: Product[], ref: string): Product | undefined {
  const t = ref.trim();
  const bySku = products.find((p) => p.sku && p.sku.trim().toLowerCase() === t.toLowerCase());
  if (bySku) return bySku;
  const d = digitsOf(t)[0];
  if (!d) return undefined;
  return products.find((p) => p.sku && digitsOf(p.sku)[0] === d) ?? products.find((p) => String(p.n) === d);
}

export type PhotoMatch = { n: number; how: "in the sheet" | "photo list" | "file name" };

/**
 * Pictures inside the workbook → products: a picture on a product's row of
 * the product sheet is that product's; one on a photo list's row is that
 * row's product.
 */
export function picturesByProduct(book: Book, sheet: NonNullable<ReturnType<typeof productSheet>>, list: ReturnType<typeof photoList>): Map<Picture, PhotoMatch> {
  const out = new Map<Picture, PhotoMatch>();
  const byRow = new Map([...sheet.rowOf].map(([n, r]) => [r, n]));
  for (const pic of book.pictures) {
    if (pic.sheet === sheet.sheet) {
      const n = byRow.get(pic.row);
      if (n !== undefined) out.set(pic, { n, how: "in the sheet" });
      continue;
    }
    const hit = list.find((l) => l.sheet === pic.sheet && l.row === pic.row);
    if (hit) out.set(pic, { n: hit.n, how: "photo list" });
  }
  return out;
}

/**
 * An uploaded photo file → its product, without looking at it: the photo
 * list names the file (or its photo number), or the file's name carries the
 * product's code or number. Null: the Photo matcher looks at it.
 */
export function matchFileName(fileName: string, products: Product[], list: ReturnType<typeof photoList>): PhotoMatch | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  for (const l of list) {
    const f = l.photo.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
    if (f && (f === stem || (digitsOf(f)[0] && digitsOf(f)[0] === digitsOf(stem)[0] && digitsOf(stem).length === 1))) return { n: l.n, how: "photo list" };
  }
  // A camera's own name (IMG_4412, DSC01234, PXL_2026…) says nothing about the product.
  if (/^(img|dsc|dscn|pxl|photo|image|screenshot|whatsapp|mvimg|dji)[\s_-]/i.test(stem)) return null;
  const p = productByRef(products, stem);
  return p ? { n: p.n, how: "file name" } : null;
}
