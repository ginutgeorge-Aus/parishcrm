// getGivingSummary pulls in the Prisma client at module load; stub it so the
// pure-CSV test doesn't spin up a real DB client.
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { groupBy: jest.fn() },
    family: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((s: string) => `decrypted:${s}`) }))

import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getGivingSummary, generateGivingSummaryCsv, type GivingSummaryRow } from "@/lib/givingSummary"

const mockGroupBy = prisma.transaction.groupBy as jest.Mock
const mockFindMany = prisma.family.findMany as jest.Mock
const mockSafeDecrypt = safeDecrypt as jest.Mock

function makeRow(overrides: Partial<GivingSummaryRow> = {}): GivingSummaryRow {
  return {
    familyId: 1,
    familyName: "Smith Family",
    memberNo: "C90/91",
    email: "head@example.com",
    totalCents: 123450,
    txCount: 6,
    lastGiving: new Date("2026-03-15"),
    ...overrides,
  }
}

describe("generateGivingSummaryCsv", () => {
  it("emits the header row", () => {
    expect(generateGivingSummaryCsv([]).split("\n")[0]).toBe(
      "Family,Member No,Primary Email,Total Giving,Transactions,Last Giving Date"
    )
  })

  it("formats a row: total 2dp, DD/MM/YYYY date, count as-is", () => {
    const csv = generateGivingSummaryCsv([makeRow()])
    expect(csv.split("\n")[1]).toBe(
      "Smith Family,C90/91,head@example.com,1234.50,6,15/03/2026"
    )
  })

  it("renders blanks for null memberNo, empty email, and no giving date", () => {
    const csv = generateGivingSummaryCsv([
      makeRow({ memberNo: null, email: "", lastGiving: null }),
    ])
    expect(csv.split("\n")[1]).toBe("Smith Family,,,1234.50,6,")
  })

  it("prefixes formula-injection cells with an apostrophe", () => {
    const csv = generateGivingSummaryCsv([
      makeRow({ familyName: "=cmd()", email: "+evil@x.com" }),
    ])
    const cells = csv.split("\n")[1].split(",")
    expect(cells[0]).toBe("'=cmd()")
    expect(cells[2]).toBe("'+evil@x.com")
  })

  it("quotes cells containing commas or quotes", () => {
    const csv = generateGivingSummaryCsv([makeRow({ familyName: 'Smith, "Jr"' })])
    expect(csv.split("\n")[1].startsWith('"Smith, ""Jr"""')).toBe(true)
  })

  // AUDITOR (canViewPeople false) must not see the decrypted primary
  // email — the column is omitted entirely, not just blanked.
  it("omits the Primary Email column entirely when includeEmail is false", () => {
    const csv = generateGivingSummaryCsv([makeRow()], false)
    expect(csv.split("\n")[0]).toBe(
      "Family,Member No,Total Giving,Transactions,Last Giving Date"
    )
    expect(csv.split("\n")[1]).toBe("Smith Family,C90/91,1234.50,6,15/03/2026")
    expect(csv).not.toContain("head@example.com")
  })
})

// AUDITOR (canViewPeople false) must never have the primary email
// decrypted server-side, not just have it hidden client-side.
describe("getGivingSummary email gating", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGroupBy.mockResolvedValue([
      { familyId: 1, _sum: { amount: 100 }, _count: { _all: 2 }, _max: { date: new Date("2026-01-01") } },
    ])
    mockFindMany.mockResolvedValue([
      {
        id: 1,
        name: "Smith Family",
        memberNo: "C1",
        people: [{ email: "cipher:head@example.com" }],
      },
    ])
  })

  it("decrypts and returns the primary email when includeEmail is true (default)", async () => {
    const rows = await getGivingSummary(2025)
    expect(rows[0].email).toBe("decrypted:cipher:head@example.com")
    expect(mockSafeDecrypt).toHaveBeenCalledWith("cipher:head@example.com")
  })

  it("never calls safeDecrypt and returns an empty email when includeEmail is false", async () => {
    const rows = await getGivingSummary(2025, false)
    expect(rows[0].email).toBe("")
    expect(mockSafeDecrypt).not.toHaveBeenCalled()
  })

  // isGiving is `!!familyId` for both INCOME and EXPENSE, so the groupBy
  // must filter type=INCOME or a family-linked expense inflates giving totals.
  it("filters the groupBy to type INCOME so family-linked expenses aren't counted", async () => {
    await getGivingSummary(2025)
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "INCOME" }) })
    )
  })
})
