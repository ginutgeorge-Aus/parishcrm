/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUnique: jest.fn() },
    family: { findMany: jest.fn() },
    transaction: { groupBy: jest.fn() },
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => null }))
jest.mock("@/components/ui/PrintButton", () => ({ PrintButton: () => null }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import DuesReportPage from "@/app/(dashboard)/accounting/dues/page"

const mockAuth = auth as jest.Mock
const mockAccount = prisma.account.findUnique as jest.Mock
const mockFamilies = prisma.family.findMany as jest.Mock
const mockGroupBy = prisma.transaction.groupBy as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const props = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) })

beforeEach(() => jest.clearAllMocks())

describe("DuesReportPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(DuesReportPage(props())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view (read-only)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockAccount.mockResolvedValue({ id: 7 })
    mockFamilies.mockResolvedValue([])
    mockGroupBy.mockResolvedValue([])
    const result = await DuesReportPage(props())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("sums paid amounts against the subscription account within the chosen FY", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccount.mockResolvedValue({ id: 7 })
    mockFamilies.mockResolvedValue([
      { id: 1, name: "Smith", memberNo: "C1", joinedDate: null, monthlyDues: { toString: () => "60" } },
    ])
    mockGroupBy.mockResolvedValue([{ familyId: 1, _sum: { amount: { toString: () => "200" } } }])

    const result = await DuesReportPage(props({ year: "2025" }))
    expect(result).toBeDefined()
    expect(mockFamilies).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ monthlyDues: { not: null }, archivedAt: null }) })
    )
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: 7,
          type: "INCOME",
          date: { gte: new Date("2025-07-01"), lt: new Date("2026-07-01") },
        }),
      })
    )
  })

  it("skips the paid query when the subscription account is missing", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccount.mockResolvedValue(null)
    mockFamilies.mockResolvedValue([
      { id: 1, name: "Smith", memberNo: null, joinedDate: null, monthlyDues: { toString: () => "60" } },
    ])
    const result = await DuesReportPage(props())
    expect(result).toBeDefined()
    expect(mockGroupBy).not.toHaveBeenCalled()
  })
})
