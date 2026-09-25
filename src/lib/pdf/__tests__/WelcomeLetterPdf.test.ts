/** @jest-environment node */
// No branding letterhead row in these tests — exercises the text-header
// fallback path (dedicated letterhead-fallback.test.ts covers the image path).
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

import PDFDocument from "pdfkit"
import { renderWelcomeLetterPdf } from "@/lib/pdf/WelcomeLetterPdf"
import type { WelcomeLetterModel } from "@/lib/welcomeLetter"

const MODEL: WelcomeLetterModel = {
  date: "6 August 2026",
  addresseeName: "Mr. Daniel Carter & Family",
  addressLines: ["5 Sample Avenue", "Exampleton NSW 2999"],
  greetingName: "Mr. Daniel Taylor Carter",
  memberNo: "A10/12",
  includeTransfer: true,
  transferChurch: "Example Sister Church, London",
  members: ["Mr. Daniel Taylor Carter", "Mrs. Grace Garcia"],
  bodyIntro: "Welcome paragraph.\n\nEnrolled paragraph.\n\nPrayer paragraph.",
  contributionsIntro: "As members of our parish, please use bank transfer.",
  bodyClosing: "Once again, welcome.",
  bankAccounts: [
    { fundLabel: "General Fund", bank: "ANZ Bank", bsb: "012345", account: "987654321", accountName: "Example Church", taxDeductible: false },
    { fundLabel: "Tithe / School Building Fund", bank: "ANZ Bank", bsb: "013999", account: "123456789", accountName: "Example Church School Building Fund", taxDeductible: true },
  ],
  signerName: "Mrs. Susan Miller",
  signerTitle: "Secretary",
  church: { name: "Example Community Church", address: "3 Example St", abn: "51 824 753 556", email: "x@example.org" },
}

describe("renderWelcomeLetterPdf", () => {
  it("produces a non-empty PDF buffer for a full model", async () => {
    const buf = await renderWelcomeLetterPdf(MODEL)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("renders a minimal model (no transfer, null memberNo)", async () => {
    const buf = await renderWelcomeLetterPdf({ ...MODEL, includeTransfer: false, transferChurch: "", memberNo: null, members: ["Mr. Daniel Carter"] })
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("keeps a long contact footer inside its band — no spill page", async () => {
    const log: string[] = []
    const origText = PDFDocument.prototype.text
    const origAdd = PDFDocument.prototype.addPage
    const t = jest.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      log.push(`text:${String(args[0]).slice(0, 5)}`)
      return (origText as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args)
    })
    const a = jest.spyOn(PDFDocument.prototype, "addPage").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
      log.push("addPage")
      return (origAdd as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args)
    })
    try {
      const church = { ...MODEL.church, address: "Address line ".repeat(38), email: "e".repeat(240) + "@x.org" }
      await renderWelcomeLetterPdf({ ...MODEL, church })
    } finally {
      t.mockRestore()
      a.mockRestore()
    }
    expect(log.at(-1)).toBe(`text:${MODEL.church.name.slice(0, 5)}`)
  })

  describe("layout", () => {
    let calls: { text: string; x: number; y: number }[]
    let spy: jest.SpyInstance
    beforeEach(() => {
      calls = []
      const orig = PDFDocument.prototype.text
      spy = jest.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
        calls.push({ text: String(args[0]), x: args[1] as number, y: args[2] as number })
        return (orig as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args)
      })
    })
    afterEach(() => spy.mockRestore())

    it("renders each member name on the same line as its bullet", async () => {
      await renderWelcomeLetterPdf(MODEL)
      for (const name of MODEL.members) {
        const idx = calls.findIndex((c) => c.text === name)
        expect(idx).toBeGreaterThan(0)
        expect(calls[idx - 1].text).toBe("•")
        expect(calls[idx].y).toBe(calls[idx - 1].y)
      }
    })

    it("writes a contact footer with the church email", async () => {
      await renderWelcomeLetterPdf(MODEL)
      const footer = calls[calls.length - 1]
      expect(footer.text).toContain(MODEL.church.address)
      expect(footer.text).toContain(MODEL.church.email)
    })
  })
})
