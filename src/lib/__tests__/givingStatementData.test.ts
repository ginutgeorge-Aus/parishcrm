jest.mock("server-only", () => ({}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (v: string) => v }))
jest.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: jest.fn() }, family: { findMany: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
import { loadStatements, loadStatementFamilies } from "@/lib/givingStatementData"

const findTx = prisma.transaction.findMany as jest.Mock
const findFam = prisma.family.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe("loadStatements", () => {
  it("queries INCOME giving only (a family-linked EXPENSE is excluded by the filter)", async () => {
    findTx.mockResolvedValue([])
    await loadStatements(2025, [1])
    const where = findTx.mock.calls[0][0].where
    expect(where).toMatchObject({ isGiving: true, type: "INCOME", familyId: { in: [1] } })
  })

  it("groups rows by the transaction's family", async () => {
    findTx.mockResolvedValue([
      { date: new Date("2025-08-01T00:00:00Z"), description: "a", amount: "10.00", familyId: 3, fund: null },
    ])
    const out = await loadStatements(2025)
    expect(out.get(3)?.totalCents).toBe(1000)
  })

  it("throws instead of understating when the scan cap is exceeded", async () => {
    findTx.mockResolvedValue(Array.from({ length: 50_001 }, () => ({ date: new Date(), description: "", amount: 1, familyId: 1, fund: null })))
    await expect(loadStatements(2025)).rejects.toThrow(/Too many gifts/)
  })
})

describe("loadStatementFamilies", () => {
  it("excludes archived people in the query and orders head first, honouring consent", async () => {
    findFam.mockResolvedValue([
      {
        id: 1,
        name: "Smith",
        people: [
          { email: "kid@x.com", emailConsent: true, role: "CHILD" },
          { email: "no@x.com", emailConsent: false, role: "SPOUSE" },
          { email: "head@x.com", emailConsent: true, role: "HEAD" },
        ],
      },
    ])
    const out = await loadStatementFamilies([1])
    expect(findFam.mock.calls[0][0].select.people.where).toEqual({ archivedAt: null })
    expect(out.get(1)?.emails).toEqual(["head@x.com", "kid@x.com"])
  })
})
