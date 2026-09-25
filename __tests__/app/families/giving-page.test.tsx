/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/components/accounting/YearSelector", () => ({
  YearSelector: () => null,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect, notFound } from "next/navigation"
import { renderToStaticMarkup } from "react-dom/server"
import FamilyGivingPage from "@/app/(dashboard)/families/[id]/giving/page"

const mockAuth = auth as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockTransactionFindMany = prisma.transaction.findMany as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockNotFound = notFound as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

const makeProps = (id = "1", year?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(year ? { year } : {}),
})

describe("FamilyGivingPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(FamilyGivingPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view giving history", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family" })
    mockTransactionFindMany.mockResolvedValue([])
    const result = await FamilyGivingPage(makeProps())
    expect(result).toBeDefined()
  })

  it("calls notFound for unknown family", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFamilyFindUnique.mockResolvedValue(null)
    await expect(FamilyGivingPage(makeProps())).rejects.toThrow("NOT_FOUND")
    expect(mockNotFound).toHaveBeenCalled()
  })

  it("calls notFound for archived family", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family", archivedAt: new Date("2026-01-01") })
    await expect(FamilyGivingPage(makeProps())).rejects.toThrow("NOT_FOUND")
    expect(mockNotFound).toHaveBeenCalled()
  })

  it("resolves with transactions for ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family" })
    mockTransactionFindMany.mockResolvedValue([
      {
        id: 10,
        date: new Date("2025-09-15"),
        description: "enc:Sunday Offering",
        amount: "100.00",
        receiptSends: [{ status: "SUCCESS" }],
      },
    ])
    const result = await FamilyGivingPage(makeProps())
    expect(result).toBeDefined()
  })

  it.each([
    ["OFFICE_ADMIN", false],
    ["AUDITOR", false],
    ["ADMIN", true],
  ])("links rows to the transaction edit page only for accounting mutators — %s", async (role, linked) => {
    mockAuth.mockResolvedValue({ user: { role, id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family" })
    mockTransactionFindMany.mockResolvedValue([
      { id: 10, date: new Date("2025-09-15"), description: "enc:Sunday Offering", amount: "100.00", receiptSends: [] },
    ])
    const html = renderToStaticMarkup(await FamilyGivingPage(makeProps()))
    expect(html).toContain("Sunday Offering")
    expect(html.includes("/accounting/transactions/10/edit")).toBe(linked)
  })

  it("resolves with empty state for PASTOR with no transactions", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family" })
    mockTransactionFindMany.mockResolvedValue([])
    const result = await FamilyGivingPage(makeProps())
    expect(result).toBeDefined()
  })
})
