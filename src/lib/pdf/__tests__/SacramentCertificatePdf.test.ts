/** @jest-environment node */
// No branding letterhead row: exercises the text-header path.
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

import PDFDocument from "pdfkit"
import { renderSacramentCertificatePdf } from "@/lib/pdf/SacramentCertificatePdf"
import type { CertificateSource } from "@/lib/sacraments"

const CHURCH = { name: "Example Community Church", address: "3 Example St" }
const BAPTISM: CertificateSource = {
  type: "BAPTISM",
  registerNo: "BAP-2026-014",
  date: "2026-03-01",
  place: "St Mark",
  ministerName: "Fr Example",
  person: { firstName: "Alex", lastName: "Sample" },
  spouse: null,
  spouseName: null,
  godparents: "Jane Roe",
}

describe("renderSacramentCertificatePdf", () => {
  let texts: string[]
  let spy: jest.SpyInstance
  beforeEach(() => {
    texts = []
    const orig = PDFDocument.prototype.text
    // pdfkit compresses page streams, so the person's name is checked at the draw call.
    spy = jest.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      texts.push(String(args[0]))
      return (orig as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args)
    })
  })
  afterEach(() => spy.mockRestore())

  it("produces a PDF that names the person, rite, date and register number", async () => {
    const buf = await renderSacramentCertificatePdf(BAPTISM, CHURCH)
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
    expect(buf.length).toBeGreaterThan(1000)
    expect(texts).toContain("Alex Sample")
    expect(texts).toContain("Certificate of Baptism")
    expect(texts).toContain("was baptised on 1 March 2026 at St Mark.")
    expect(texts).toContain("Register no. BAP-2026-014")
    expect(texts).toContain("Godparents: Jane Roe")
  })

  it("keeps worst-case input on one page", async () => {
    const long = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ")
    const worst: CertificateSource = {
      type: "MARRIAGE",
      registerNo: "MAR-2026-1000",
      date: "2026-03-01",
      place: long(40, "Placename"),
      ministerName: long(30, "Minister"),
      person: { firstName: "W".repeat(100), lastName: long(15, "Surnamelong") },
      spouse: null,
      spouseName: long(25, "Spousename"),
      godparents: long(60, "Godparent"),
    }
    const church = { name: long(20, "Church"), address: long(50, "Address") }
    const buf = await renderSacramentCertificatePdf(worst, church)
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
    expect(buf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1)
    // The same input at normal size is not shrunk: the short certificate still lays out.
    await renderSacramentCertificatePdf(BAPTISM, CHURCH)
  })

  it("prints both spouses on a marriage certificate and stays on one page", async () => {
    const buf = await renderSacramentCertificatePdf(
      { ...BAPTISM, type: "MARRIAGE", registerNo: "MAR-2026-002", godparents: null, spouseName: "Out Side" },
      CHURCH,
    )
    expect(texts).toContain("Alex Sample and Out Side")
    expect(buf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1)
  })
})
