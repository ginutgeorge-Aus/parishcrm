/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/givingSummary", () => ({ getGivingSummary: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => null }))
jest.mock("@/components/ui/PrintButton", () => ({ PrintButton: () => null }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { getGivingSummary } from "@/lib/givingSummary"
import GivingSummaryPage from "@/app/(dashboard)/accounting/reports/giving-summary/page"

const mockAuth = auth as jest.Mock
const mockSummary = getGivingSummary as jest.Mock

beforeEach(() => jest.clearAllMocks())

const props = (year: string) => ({ searchParams: Promise.resolve({ year }) })

describe("GivingSummaryPage grand total", () => {
  it("sums totals in dollars, not 100× inflated", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // totalCents are integer cents: $1,000.00 + $500.00 = $1,500.00.
    mockSummary.mockResolvedValue([
      { familyId: 1, familyName: "Alpha", memberNo: "A1", email: "a@x.com", totalCents: 100000, txCount: 3, lastGiving: new Date("2025-08-01") },
      { familyId: 2, familyName: "Beta", memberNo: "B2", email: "", totalCents: 50000, txCount: 1, lastGiving: new Date("2025-09-01") },
    ])
    const html = renderToStaticMarkup(await GivingSummaryPage(props("2025")))
    expect(html).toContain("$1,500.00")
    // Feeding integer cents through sumCents/toCents would 100× the grand total.
    expect(html).not.toContain("$150,000.00")
  })
})

// AUDITOR is accounting-only and must not see decrypted member PII —
// the Primary Email column must not render at all for that role.
describe("GivingSummaryPage email column gating", () => {
  const rowsWithEmail = [
    { familyId: 1, familyName: "Alpha", memberNo: "A1", email: "alpha@example.com", totalCents: 100000, txCount: 3, lastGiving: new Date("2025-08-01") },
  ]

  it("renders the Primary Email column for ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockSummary.mockResolvedValue(rowsWithEmail)
    const html = renderToStaticMarkup(await GivingSummaryPage(props("2025")))
    expect(html).toContain("Primary Email")
    expect(html).toContain("alpha@example.com")
    expect(mockSummary).toHaveBeenCalledWith(2025, true)
  })

  it("omits the Primary Email column for AUDITOR", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "2" } })
    mockSummary.mockResolvedValue(rowsWithEmail)
    const html = renderToStaticMarkup(await GivingSummaryPage(props("2025")))
    expect(html).not.toContain("Primary Email")
    expect(html).not.toContain("alpha@example.com")
    expect(mockSummary).toHaveBeenCalledWith(2025, false)
  })
})
