import { DEFAULT_RECEIPT_SETTINGS, getReceiptSettings } from "@/lib/receiptSettings"

jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
const findMany = prisma.appSetting.findMany as jest.Mock

describe("getReceiptSettings", () => {
  it("defaults have no 'School Building Fund' and interpolatable churchName", () => {
    expect(DEFAULT_RECEIPT_SETTINGS.legalText).not.toMatch(/School Building Fund/)
    expect(DEFAULT_RECEIPT_SETTINGS.legalText).toContain("{churchName}")
    expect(DEFAULT_RECEIPT_SETTINGS.numberPrefix).toBe("DGR")
  })

  it("falls back per-field when a row is missing or blank", async () => {
    findMany.mockResolvedValue([
      { key: "receiptNumberPrefix", value: "RCPT" },
      { key: "receiptLegalText", value: "   " }, // blank → default
    ])
    const s = await getReceiptSettings()
    expect(s.numberPrefix).toBe("RCPT")
    expect(s.legalText).toBe(DEFAULT_RECEIPT_SETTINGS.legalText)
    expect(s.documentTitle).toBe(DEFAULT_RECEIPT_SETTINGS.documentTitle)
  })

  it("returns all defaults on DB error", async () => {
    findMany.mockRejectedValue(new Error("db down"))
    await expect(getReceiptSettings()).resolves.toEqual(DEFAULT_RECEIPT_SETTINGS)
  })
})
