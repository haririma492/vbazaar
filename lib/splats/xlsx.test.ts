// Reading the first sheet of an .xlsx: shared strings, inline strings,
// numbers, gaps between cells, and the workbook's own sheet order.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { readXlsx } from "./xlsx.ts";

function workbook(sheets: Record<string, string>, order: string[]): Uint8Array {
  const rels = order.map((f, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/${f}"/>`).join("");
  const names = order.map((f, i) => `<sheet name="S${i}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets>${names}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships>${rels}</Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>number</t></si><si><t>title_fa</t></si><si><r><t>Pista</t></r><r><t xml:space="preserve">chio &amp; co</t></r></si><si><t>پسته</t></si></sst>`),
  };
  for (const [name, xml] of Object.entries(sheets)) files[`xl/worksheets/${name}`] = strToU8(xml);
  return zipSync(files);
}

test("the first sheet's cells, as text, in their columns", () => {
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>price</t></is></c></row>
    <row r="3"><c r="A3"><v>12</v></c><c r="B3" t="s"><v>3</v></c><c r="C3" t="s"><v>2</v></c><c r="D3"><f>1+1</f><v>4.99</v></c></row>
  </sheetData></worksheet>`;
  const rows = readXlsx(workbook({ "data.xml": sheet, "other.xml": "<worksheet/>" }, ["data.xml", "other.xml"]));
  assert.deepEqual(rows, [
    ["number", "title_fa", "", "price"],
    [],
    ["12", "پسته", "Pistachio & co", "4.99"],
  ]);
});

test("not an .xlsx: says so", () => {
  assert.throws(() => readXlsx(new Uint8Array([1, 2, 3])), /not an \.xlsx/);
});
