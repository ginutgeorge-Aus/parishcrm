/** @jest-environment node */
jest.mock("@/lib/branding", () => ({ getLetterheadAsset: jest.fn().mockResolvedValue(null) }))

import { renderGivingStatementPdf } from "@/lib/pdf/GivingStatementPdf"
import type { GivingStatementModel } from "@/lib/givingStatement"

const base: GivingStatementModel = {
  churchName: "Example Church", churchAbn: "51824753556", churchAddress: "1 Example St", churchEmail: "c@x.com",
  familyName: "Smith", fyLabel: "2025–26", periodLabel: "1 July 2025 to 30 June 2026", issueDate: "5 July 2026",
  totalLabel: "$300.00",
  byFund: [{ fund: "Alms", amountLabel: "$300.00" }],
  lines: [{ dateLabel: "10/08/2025", fund: "Alms", amountLabel: "$300.00" }],
}

/** Count PDF page objects without a PDF parser (unpdf is ESM-only under this Jest). */
const pageCount = (buf: Buffer): number => (buf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length

it("renders a PDF buffer", async () => {
  const buf = await renderGivingStatementPdf(base)
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-")
  expect(buf.length).toBeGreaterThan(1000)
  expect(pageCount(buf)).toBe(1)
})

it("paginates a long gift list", async () => {
  const lines = Array.from({ length: 120 }, (_, i) => ({ ...base.lines[0], dateLabel: `${i + 1}/08/2025` }))
  const buf = await renderGivingStatementPdf({ ...base, lines })
  expect(pageCount(buf)).toBeGreaterThan(1)
})
