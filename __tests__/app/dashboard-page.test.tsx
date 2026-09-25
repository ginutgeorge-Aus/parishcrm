/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findMany: jest.fn() },
    paymentAccount: { findMany: jest.fn() },
    person: { findMany: jest.fn(), count: jest.fn() },
    family: { count: jest.fn(), findMany: jest.fn() },
    pettyCashSession: { count: jest.fn() },
    event: { count: jest.fn() },
    registration: { findMany: jest.fn() },
    transaction: { aggregate: jest.fn() },
    auditLog: { findMany: jest.fn() },
    familyUpdateSubmission: { count: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/dashboard/BirthdayWidget", () => ({ BirthdayWidget: () => null }))
jest.mock("@/components/dashboard/MarriageAnniversaryWidget", () => ({ MarriageAnniversaryWidget: () => null }))

import { PERSON_FETCH_CAP } from "@/lib/constants"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import DashboardPage from "@/app/(dashboard)/page"

const mockAuth = auth as jest.Mock
const mockPersonFindMany = prisma.person.findMany as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

function primeMocks() {
  ;(prisma.accountOpeningBalance.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([])
  mockPersonFindMany.mockResolvedValue([])
  ;(prisma.person.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.family.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.pettyCashSession.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.event.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.registration.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } })
  ;(prisma.auditLog.findMany as jest.Mock).mockResolvedValue([])
}

beforeEach(() => jest.clearAllMocks())

describe("DashboardPage", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(DashboardPage()).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/login")
  })

  it("bounds the birthday person.findMany with take: PERSON_FETCH_CAP + 1", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(mockPersonFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dateOfBirth: { not: null }, archivedAt: null },
        take: PERSON_FETCH_CAP + 1,
      })
    )
  })

  it("bounds the marriage-anniversary family.findMany with take: PERSON_FETCH_CAP + 1", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(prisma.family.findMany as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { marriageDate: { not: null }, archivedAt: null },
        take: PERSON_FETCH_CAP + 1,
      })
    )
  })

  it("every person.findMany call is bounded by take: PERSON_FETCH_CAP + 1", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeMocks()
    await DashboardPage()
    expect(mockPersonFindMany).toHaveBeenCalledTimes(1)
    for (const call of mockPersonFindMany.mock.calls) {
      expect(call[0]).toHaveProperty("take", PERSON_FETCH_CAP + 1)
    }
  })
})
