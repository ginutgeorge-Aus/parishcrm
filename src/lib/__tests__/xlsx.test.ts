/** @jest-environment node */
import { crc32, inflateRawSync } from "node:zlib"
import { buildXlsx, columnName } from "@/lib/xlsx"

/** Minimal ZIP reader for the test: walks local file headers and returns name -> text. */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8)
    const crc = buf.readUInt32LE(p + 14)
    const size = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extraLen = buf.readUInt16LE(p + 28)
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8")
    const start = p + 30 + nameLen + extraLen
    const raw = buf.subarray(start, start + size)
    const data = method === 8 ? inflateRawSync(raw) : raw
    expect(crc32(data)).toBe(crc)
    // DOS date 1980-01-01, never the invalid all-zero date.
    expect(buf.readUInt16LE(p + 12)).toBe(0x0021)
    out.set(name, data.toString("utf8"))
    p = start + size
  }
  // Central directory follows the entries; end record closes the file.
  expect(buf.readUInt32LE(p)).toBe(0x02014b50)
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50)
  return out
}

describe("columnName", () => {
  it("maps 0-based indexes to spreadsheet letters", () => {
    expect([0, 25, 26, 51, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "ZZ", "AAA"])
  })
})

describe("buildXlsx", () => {
  it("writes a valid workbook with the expected parts", () => {
    const files = unzip(buildXlsx("Report", [["Child", "Score"], ["Ann", 12.5], ["Bob", null]]))
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ])
    const sheet = files.get("xl/worksheets/sheet1.xml")!
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Child</t></is></c>')
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>')
    // Null cells are left out, so row 3 has only A3.
    expect(sheet).toContain('<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">Bob</t></is></c></row>')
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Report" sheetId="1" r:id="rId1"/>')
  })

  it("escapes XML, strips control characters and keeps formulas as plain text", () => {
    const sheet = unzip(buildXlsx("A&B", [["=1+1 <x> & \"q\"\u0001"]])).get("xl/worksheets/sheet1.xml")!
    expect(sheet).toContain('<t xml:space="preserve">=1+1 &lt;x&gt; &amp; &quot;q&quot;</t>')
    expect(sheet).not.toContain("<f>")
  })

  it("sanitises the sheet name (Excel forbids []:*?/\\ and >31 chars)", () => {
    const wb = unzip(buildXlsx("a/b:c*d?e[f]g\\h-very-long-name-over-limit", [])).get("xl/workbook.xml")!
    expect(wb).toContain('name="a b c d e f g h-very-long-name-"')
    expect(unzip(buildXlsx("", [])).get("xl/workbook.xml")).toContain('name="Sheet1"')
  })

  it("rejects non-finite numbers by writing them blank", () => {
    const sheet = unzip(buildXlsx("S", [[Number.NaN, Infinity, 3]])).get("xl/worksheets/sheet1.xml")!
    expect(sheet).toContain('<row r="1"><c r="C1" s="1"><v>3</v></c></row>')
  })
})
