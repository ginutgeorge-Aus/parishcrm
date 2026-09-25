/**
 * @jest-environment node
 */

import { formatReceiptNo, fyRange, buildDgrPdfModel, currentFyEndYear } from "@/lib/dgr"
import { formatLongDate } from "@/lib/formatting"
import { DEFAULT_RECEIPT_SETTINGS } from "@/lib/receiptSettings"

describe("formatReceiptNo prefix", () => {
  it("defaults to DGR", () => {
    expect(formatReceiptNo(2025, 1)).toBe("DGR-2025-001")
  })
  it("uses a custom prefix", () => {
    expect(formatReceiptNo(2025, 7, "RCPT")).toBe("RCPT-2025-007")
  })
})

describe("fyRange (AU July default) unchanged", () => {
  it("returns inclusive 1 Jul (prev year) .. 30 Jun bounds", () => {
    const { from, to } = fyRange(2025)
    expect(from.toISOString()).toBe("2024-07-01T00:00:00.000Z")
    expect(to.toISOString()).toBe("2025-06-30T00:00:00.000Z")
  })
})

describe("currentFyEndYear (AU July default)", () => {
  it("returns the FY end year for dates either side of 1 July", () => {
    expect(currentFyEndYear(new Date("2026-06-15T00:00:00.000Z"))).toBe(2026)
    expect(currentFyEndYear(new Date("2026-09-23T00:00:00.000Z"))).toBe(2027)
  })
})

describe("fyRange with a calendar-year fiscal year", () => {
  it("uses the ending year as the start year when FY starts in January", () => {
    const previous = process.env.APP_FY_START_MONTH
    process.env.APP_FY_START_MONTH = "1"
    jest.resetModules()

    try {
      const { fyRange: calendarYearRange } = require("@/lib/dgr") as typeof import("@/lib/dgr")
      const { from, to } = calendarYearRange(2026)

      expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z")
      expect(to.toISOString()).toBe("2026-12-31T00:00:00.000Z")
    } finally {
      if (previous === undefined) delete process.env.APP_FY_START_MONTH
      else process.env.APP_FY_START_MONTH = previous
      jest.resetModules()
    }
  })

  it("defaults the current FY end year and label to the calendar year", () => {
    const previous = process.env.APP_FY_START_MONTH
    process.env.APP_FY_START_MONTH = "1"
    jest.resetModules()

    try {
      const dgr = require("@/lib/dgr") as typeof import("@/lib/dgr")
      const endYear = dgr.currentFyEndYear(new Date("2026-09-23T00:00:00.000Z"))

      expect(endYear).toBe(2026)
      expect(dgr.fyLabel(endYear)).toBe("2026")
      expect(dgr.fyRange(endYear).from.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    } finally {
      if (previous === undefined) delete process.env.APP_FY_START_MONTH
      else process.env.APP_FY_START_MONTH = previous
      jest.resetModules()
    }
  })
})

describe("formatLongDate", () => {
  it("formats a UTC date as long-form", () => {
    expect(formatLongDate(new Date("2024-07-01T00:00:00.000Z"))).toBe("1 July 2024")
  })
})

describe("buildDgrPdfModel", () => {
  const church = { name: "Grace Church", abn: "12 345 678 901", address: "1 St", email: "g@x.org" }
  const input = {
    receiptNo: "DGR-2025-001",
    fyEndYear: 2025,
    issueDate: new Date("2025-07-05T00:00:00.000Z"),
    donorName: "Jane",
    lines: [{ date: "2024-08-01", amount: 100, method: "Bank" }],
  }
  it("substitutes churchName into legal lines and splits on blank line", () => {
    const m = buildDgrPdfModel(input, church, DEFAULT_RECEIPT_SETTINGS)
    expect(m.legalLines).toHaveLength(3)
    expect(m.legalLines[0]).toContain("Grace Church")
    expect(m.legalLines.join(" ")).not.toContain("{churchName}")
  })
  it("formats money via fmtAUD (currency-aware), not a bare $", () => {
    const m = buildDgrPdfModel(input, church, DEFAULT_RECEIPT_SETTINGS)
    expect(m.totalLabel).toBe("$100.00") // en-AU/AUD default
    expect(m.lines[0].amountLabel).toBe("$100.00")
  })
  it("builds coveredPeriod from the template with {from}/{to}", () => {
    const m = buildDgrPdfModel(input, church, DEFAULT_RECEIPT_SETTINGS)
    expect(m.coveredPeriod).toBe(
      "This receipt covers tax-deductible gifts received between 1 July 2024 and 30 June 2025."
    )
  })
  it("passes documentTitle + totalDonationsLabel through", () => {
    const m = buildDgrPdfModel(input, church, DEFAULT_RECEIPT_SETTINGS)
    expect(m.documentTitle).toBe("ANNUAL TAX-DEDUCTIBLE RECEIPT")
    expect(m.totalDonationsLabel).toBe("TOTAL TAX-DEDUCTIBLE DONATIONS")
  })
})
