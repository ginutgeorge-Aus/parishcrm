jest.mock("server-only", () => ({}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (v: string) => v }))
jest.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: jest.fn(), groupBy: jest.fn() }, family: { findMany: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
import { loadStatements, loadStatementSummaries, loadStatementFamilies } from "@/lib/givingStatementData"

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

  it("never selects the gift description", async () => {
    findTx.mockResolvedValue([])
    await loadStatements(2025)
    expect(findTx.mock.calls[0][0].select).not.toHaveProperty("description")
  })

  it("groups rows by the transaction's family", async () => {
    findTx.mockResolvedValue([
      { date: new Date("2025-08-01T00:00:00Z"), amount: "10.00", familyId: 3, fund: null },
    ])
    const out = await loadStatements(2025)
    expect(out.get(3)?.totalCents).toBe(1000)
  })

  it("throws instead of understating when the scan cap is exceeded", async () => {
    findTx.mockResolvedValue(Array.from({ length: 50_001 }, () => ({ date: new Date(), amount: 1, familyId: 1, fund: null })))
    await expect(loadStatements(2025)).rejects.toThrow(/Too many gifts/)
  })
})

describe("loadStatementSummaries", () => {
  it("aggregates count and cents per family in the DB with the giving filters", async () => {
    ;(prisma.transaction.groupBy as jest.Mock).mockResolvedValue([
      { familyId: 1, _sum: { amount: "10.10" }, _count: { _all: 2 } },
      { familyId: 2, _sum: { amount: null }, _count: { _all: 1 } },
      { familyId: null, _sum: { amount: 5 }, _count: { _all: 1 } },
    ])
    const out = await loadStatementSummaries(2025)
    expect(out).toEqual(new Map([[1, { giftCount: 2, totalCents: 1010 }], [2, { giftCount: 1, totalCents: 0 }]]))
    expect((prisma.transaction.groupBy as jest.Mock).mock.calls[0][0]).toMatchObject({ by: ["familyId"], _sum: { amount: true }, _count: { _all: true } })
    expect((prisma.transaction.groupBy as jest.Mock).mock.calls[0][0].where).toMatchObject({ isGiving: true, type: "INCOME", familyId: { not: null } })
  })
})

describe("loadStatementFamilies", () => {
  it("includes archived families (flagged, never emailable) and orders people deterministically", async () => {
    findFam.mockResolvedValue([{ id: 9, name: "Old", archivedAt: new Date(), people: [{ email: "a@x.com", emailConsent: true, role: "HEAD" }] }])
    const out = await loadStatementFamilies([9], true)
    expect(findFam.mock.calls[0][0].where).toEqual({ id: { in: [9] } })
    expect(findFam.mock.calls[0][0].select.people.orderBy).toEqual([{ role: "asc" }, { firstName: "asc" }, { lastName: "asc" }, { id: "asc" }])
    expect(out.get(9)).toEqual({ id: 9, name: "Old", archived: true, canEmail: false, emails: ["a@x.com"] })
  })

  it("canEmail applies the same validity check as send, without returning addresses", async () => {
    findFam.mockResolvedValue([
      { id: 1, name: "Bad", archivedAt: null, people: [{ email: "not-an-email", emailConsent: true, role: "HEAD" }] },
      { id: 2, name: "Good", archivedAt: null, people: [{ email: "g@x.com", emailConsent: true, role: "HEAD" }] },
    ])
    const out = await loadStatementFamilies([1, 2], false)
    expect(out.get(1)).toEqual({ id: 1, name: "Bad", archived: false, canEmail: false, emails: [] })
    expect(out.get(2)).toEqual({ id: 2, name: "Good", archived: false, canEmail: true, emails: [] })
  })

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
    expect(out.get(1)?.canEmail).toBe(true)
  })

  it("omits addresses when withEmails is false but still reports canEmail", async () => {
    findFam.mockResolvedValue([
      { id: 1, name: "Smith", people: [{ email: "a@x.com", emailConsent: true, role: "HEAD" }] },
      { id: 2, name: "Jones", people: [{ email: "b@x.com", emailConsent: false, role: "HEAD" }] },
    ])
    const out = await loadStatementFamilies([1, 2], false)
    expect(out.get(1)).toEqual({ id: 1, name: "Smith", archived: false, canEmail: true, emails: [] })
    expect(out.get(2)?.canEmail).toBe(false)
  })
})
