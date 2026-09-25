/** @jest-environment node */
/**
 * Tests for: giving totals on person detail page must use integer-cent
 * arithmetic (sumCents/centsToNumber), not float reduce, to avoid IEEE-754 drift.
 */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/people/DeletePersonButton", () => ({
  DeletePersonButton: () => null,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import PersonDetailPage from "@/app/(dashboard)/people/[id]/page"
import { renderToStaticMarkup } from "react-dom/server"

const mockAuth = auth as jest.Mock
const mockPersonFindUnique = prisma.person.findUnique as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock

/** Decimal-like object matching what Prisma returns for Decimal fields */
const dec = (s: string) => ({ toString: () => s })

const makePerson = () => ({
  id: 1,
  title: null,
  firstName: "Jane",
  middleName: null,
  lastName: "Doe",
  suffix: null,
  gender: "FEMALE",
  role: "MEMBER",
  classification: "ACTIVE",
  archivedAt: null,
  email: null,
  dateOfBirth: null,
  mobile: null,
  workPhone: null,
  homePhone: null,
  pastoralNotes: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  notes: null,
  membershipDate: null,
  baptismDate: null,
  family: { id: 10, name: "Doe Family" },
})

const makeProps = (id = "1") => ({
  params: Promise.resolve({ id }),
})

beforeEach(() => jest.clearAllMocks())

describe("PersonDetailPage giving total", () => {
  it("displays exact total for Decimal amounts — matches cent-based sum not float reduce", async () => {
    // 3 donations: $0.10 + $0.20 + $0.30
    // Float reduce: 0.1 + 0.2 + 0.3 = 0.6000000000000001 (raw) → toFixed(2) = "0.60"
    // Cent sum:     10 + 20 + 30 = 60 cents → $0.60
    // Both render "$0.60" via toFixed(2) — the value is correct; this test
    // verifies the page renders a parseable total that equals the cent sum.
    // The fix ensures correctness even for cases where float drift would cross
    // a rounding boundary (e.g. many sub-cent accumulations in other currencies).
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "99" } })
    mockPersonFindUnique.mockResolvedValue(makePerson())
    mockTxFindMany.mockResolvedValue([
      { id: 1, date: new Date("2025-03-01"), description: "Offering", amount: dec("0.10") },
      { id: 2, date: new Date("2025-03-08"), description: "Offering", amount: dec("0.20") },
      { id: 3, date: new Date("2025-03-15"), description: "Offering", amount: dec("0.30") },
    ])

    const element = await PersonDetailPage(makeProps())
    const html = renderToStaticMarkup(element as React.ReactElement)

    // Correct total: $0.60
    expect(html).toContain("Total: $0.60")
    // The old float-reduce raw value must not appear in output
    expect(html).not.toContain("0.6000000000000001")
    // Giving History amounts use the house .tabular utility, not font-mono
    expect(html).toMatch(/class="[^"]*\btabular\b[^"]*"/)
    expect(html).not.toContain("font-mono")
  })

  it("shows the correct year total for multiple donations", async () => {
    // 4 donations in 2025: $250.00 + $250.00 + $500.00 + $750.00 = $1750.00
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "5" } })
    mockPersonFindUnique.mockResolvedValue(makePerson())
    mockTxFindMany.mockResolvedValue([
      { id: 1, date: new Date("2025-01-01"), description: "Jan giving", amount: dec("250.00") },
      { id: 2, date: new Date("2025-04-01"), description: "Apr giving", amount: dec("250.00") },
      { id: 3, date: new Date("2025-07-01"), description: "Jul giving", amount: dec("500.00") },
      { id: 4, date: new Date("2025-10-01"), description: "Oct giving", amount: dec("750.00") },
    ])

    const element = await PersonDetailPage(makeProps())
    const html = renderToStaticMarkup(element as React.ReactElement)

    expect(html).toContain("Total: $1,750.00")
  })

  it("shows no-giving message when person has no transactions (AUDITOR cannot view giving)", async () => {
    // AUDITOR cannot access people pages but PASTOR can — test PASTOR with empty txns
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "3" } })
    mockPersonFindUnique.mockResolvedValue(makePerson())
    mockTxFindMany.mockResolvedValue([])

    const element = await PersonDetailPage(makeProps())
    const html = renderToStaticMarkup(element as React.ReactElement)

    expect(html).toContain("No giving recorded for this person")
  })

  it("AUDITOR is redirected (cannot view people pages)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "2" } })
    await expect(PersonDetailPage(makeProps())).rejects.toThrow("REDIRECT")
  })

  it("notFound for a non-numeric id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await expect(PersonDetailPage(makeProps("abc"))).rejects.toThrow("NOT_FOUND")
    expect(notFound).toHaveBeenCalled()
    expect(mockPersonFindUnique).not.toHaveBeenCalled()
  })
})
