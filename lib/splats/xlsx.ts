/**
 * The first sheet of an .xlsx file, as rows of strings — enough to read a
 * merchant's product list (`catalogue.ts`), without a spreadsheet library.
 *
 * An .xlsx is a zip of XML: `xl/workbook.xml` names the sheets, its
 * relationships say which file is the first, `xl/sharedStrings.xml` holds the
 * text cells by index, and each cell (`<c r="B3" t="s"><v>12</v></c>`) is a
 * number, a shared string, an inline string or a formula's last value.
 */

import { strFromU8, unzipSync } from "fflate";

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** All the text of an XML fragment's <t> elements (a rich-text string has several). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

/** «B3» → column 1 (A is 0). */
function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This is not an .xlsx file (it could not be opened). Save the sheet as Excel Workbook (.xlsx).");
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");

  // The first sheet, by the workbook's own order.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(text("xl/workbook.xml"))?.[1];
  if (firstRid) {
    const rels = text("xl/_rels/workbook.xml.rels");
    const target = new RegExp(`<Relationship\\b[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRid}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new Error("The workbook has no sheet to read.");

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnOf(ref) : row.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = texts(body);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = decode(v);
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}
