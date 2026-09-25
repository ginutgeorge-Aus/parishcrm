/** @jest-environment node */

// Regression test for: the inline Giving History card on the family
// detail page rendered Transaction.description as ciphertext because it was
// never decrypted (the /giving subpage decrypts; this page did not).

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
    familyUpdateSubmission: { findFirst: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actions/familyActivity", () => ({
  getFamilyLastUpdate: jest.fn().mockResolvedValue(null),
}))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { renderToStaticMarkup } from "react-dom/server"
import FamilyDetailPage from "@/app/(dashboard)/families/[id]/page"

const mockAuth = auth as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockTransactionFindMany = prisma.transaction.findMany as jest.Mock
const mockSafeDecrypt = safeDecrypt as jest.Mock

beforeEach(() => jest.clearAllMocks())

const makeProps = (id = "1") => ({ params: Promise.resolve({ id }) })

describe("FamilyDetailPage giving history", () => {
  it("decrypts the giving transaction description before rendering", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family", people: [] })
    mockTransactionFindMany.mockResolvedValue([
      { id: 10, date: new Date("2025-09-15"), description: "enc:Sunday Offering", amount: "100.00" },
    ])

    await FamilyDetailPage(makeProps())

    expect(mockSafeDecrypt).toHaveBeenCalledWith("enc:Sunday Offering")
  })

  it("shows the Giving History card to a read-only accounting role (OFFICE_ADMIN)", async () => {
    // Gated on canViewAccounting (read), not canAccessAccounting (mutate), so
    // OFFICE_ADMIN/AUDITOR see the card — matching the standalone /giving page.
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family", people: [] })
    mockTransactionFindMany.mockResolvedValue([
      { id: 10, date: new Date("2025-09-15"), description: "enc:Sunday Offering", amount: "100.00" },
    ])

    const html = renderToStaticMarkup(await FamilyDetailPage(makeProps()))

    // The giving query ran (card is rendered) rather than being short-circuited.
    expect(mockTransactionFindMany).toHaveBeenCalled()
    expect(html).toContain("Sunday Offering")
  })

  it.each([
    ["OFFICE_ADMIN", false],
    ["ADMIN", true],
    ["PASTOR", true],
  ])("links giving rows to the transaction edit page only for accounting mutators — %s", async (role, linked) => {
    mockAuth.mockResolvedValue({ user: { role, id: "1" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family", people: [] })
    mockTransactionFindMany.mockResolvedValue([
      { id: 10, date: new Date("2025-09-15"), description: "enc:Sunday Offering", amount: "100.00" },
    ])

    const html = renderToStaticMarkup(await FamilyDetailPage(makeProps()))

    expect(html).toContain("Sunday Offering")
    expect(html.includes("/accounting/transactions/10/edit")).toBe(linked)
  })

  it("buckets a UTC-midnight transaction date into its UTC year, not a shifted local year", async () => {
    // date.getFullYear() (server-local) shifts a Jan-1 UTC-midnight anchor back
    // to the previous year on any negative-UTC-offset server. Force one here so
    // the regression reproduces regardless of the machine running the suite.
    const originalTz = process.env.TZ
    process.env.TZ = "America/New_York"
    try {
      mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
      mockFamilyFindUnique.mockResolvedValue({ id: 1, name: "Smith Family", people: [] })
      mockTransactionFindMany.mockResolvedValue([
        { id: 11, date: new Date("2025-01-01T00:00:00.000Z"), description: "enc:New Year Offering", amount: "50.00" },
      ])

      const html = renderToStaticMarkup(await FamilyDetailPage(makeProps()))

      expect(html).toContain("2025")
      expect(html).not.toContain("2024")
    } finally {
      process.env.TZ = originalTz
    }
  })
})
