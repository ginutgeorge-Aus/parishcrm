/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    accountOpeningBalance: { findMany: jest.fn() },
    transaction: { aggregate: jest.fn() },
  },
}))
// 3 payment accounts in church/tithe/petty order — the page's Promise.all
// issues aggregate calls in this array order (church income, church expense,
// tithe income, tithe expense, petty income, petty expense), matching the
// mockResolvedValueOnce chains below.
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
    { id: 2, name: "ANZ Tithe", kind: "BANK", isDefault: false, isActive: true },
    { id: 3, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true },
  ]),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}))
jest.mock("@/components/accounting/BalanceSheetDatePicker", () => ({
  BalanceSheetDatePicker: () => null,
}))
jest.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => null,
}))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import BalanceSheetPage from "@/app/(dashboard)/accounting/reports/balance-sheet/page"

const mockAuth = auth as jest.Mock
const mockObFindMany = prisma.accountOpeningBalance.findMany as jest.Mock
const mockTxAggregate = prisma.transaction.aggregate as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

const makeProps = (date?: string) => ({
  searchParams: Promise.resolve(date ? { date } : {}),
})

const makeOb = (amount: string, asOfDate: string) => ({
  amount: { toString: () => amount },
  asOfDate: new Date(asOfDate),
})

// One opening-balance row per given account id, all sharing the same amount/
// asOfDate — the single batched findMany() replaces the old per-account
// findUnique() calls, so a uniform mockResolvedValue there now becomes one
// row per id here.
const makeObRows = (amount: string, asOfDate: string, ids: number[] = [1, 2, 3]) =>
  ids.map((paymentAccountId) => ({ ...makeOb(amount, asOfDate), paymentAccountId }))

const makeAgg = (amount: string | null) => ({
  _sum: { amount: amount ? { toString: () => amount } : null },
})

beforeEach(() => jest.clearAllMocks())

describe("BalanceSheetPage", () => {
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(BalanceSheetPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    mockObFindMany.mockResolvedValue(makeObRows("51952.04", "2025-07-01"))
    mockTxAggregate.mockResolvedValue(makeAgg("1000"))
    const result = await BalanceSheetPage(makeProps("2026-05-29"))
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("allows PASTOR to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    mockObFindMany.mockResolvedValue([])
    const result = await BalanceSheetPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("calculates balance: opening + income - expenses", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindMany.mockResolvedValue(makeObRows("10000", "2025-07-01"))
    mockTxAggregate
      .mockResolvedValueOnce(makeAgg("3000")) // church income
      .mockResolvedValueOnce(makeAgg("1000")) // church expense
      .mockResolvedValueOnce(makeAgg("500"))  // tithe income
      .mockResolvedValueOnce(makeAgg("200"))  // tithe expense
      .mockResolvedValueOnce(makeAgg("100"))  // petty income
      .mockResolvedValueOnce(makeAgg("50"))   // petty expense

    const result = await BalanceSheetPage(makeProps("2026-05-29"))
    expect(result).toBeDefined()
    // All 3 accounts have opening balances → 6 aggregate calls
    expect(mockTxAggregate).toHaveBeenCalledTimes(6)
    // Verify income and expense types are queried
    expect(mockTxAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "INCOME" }) })
    )
    expect(mockTxAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "EXPENSE" }) })
    )
  })

  it("skips aggregates for accounts without opening balance", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // Only church has opening balance
    mockObFindMany.mockResolvedValue(makeObRows("10000", "2025-07-01", [1]))
    mockTxAggregate
      .mockResolvedValueOnce(makeAgg("500"))  // church income
      .mockResolvedValueOnce(makeAgg("200"))  // church expense

    const result = await BalanceSheetPage(makeProps())
    expect(result).toBeDefined()
    // Only 2 aggregate calls (church only)
    expect(mockTxAggregate).toHaveBeenCalledTimes(2)
  })

  it("skips aggregate and shows no balance for an as-at date before the anchor", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // Anchor 2025-07-01; view as-at 2025-06-01 (before anchor) → position undefined.
    mockObFindMany.mockResolvedValue(makeObRows("5000", "2025-07-01"))
    const result = await BalanceSheetPage(makeProps("2025-06-01"))
    expect(result).toBeDefined()
    // Inverted range must never be queried — all three accounts skip.
    expect(mockTxAggregate).not.toHaveBeenCalled()
  })

  it("defaults to today when date param missing", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindMany.mockResolvedValue([])
    const result = await BalanceSheetPage(makeProps())
    expect(result).toBeDefined()
  })

  it("defaults to today when date param invalid", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindMany.mockResolvedValue([])
    const result = await BalanceSheetPage(makeProps("not-a-date"))
    expect(result).toBeDefined()
  })

  // §8.4 — assert the rendered $ Total, not just the query shape. The
  // per-account balance (opening + income − expense) and the sumCents Total are
  // computed inline in the page.
  it("renders the correct per-account balances and summed Total", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindMany.mockResolvedValue(makeObRows("10000", "2025-07-01"))
    mockTxAggregate
      .mockResolvedValueOnce(makeAgg("3000")) // church income  → 10000+3000-1000 = 12000
      .mockResolvedValueOnce(makeAgg("1000")) // church expense
      .mockResolvedValueOnce(makeAgg("500"))  // tithe income   → 10000+500-200   = 10300
      .mockResolvedValueOnce(makeAgg("200"))  // tithe expense
      .mockResolvedValueOnce(makeAgg("100"))  // petty income   → 10000+100-50    = 10050
      .mockResolvedValueOnce(makeAgg("50"))   // petty expense
    const html = renderToStaticMarkup(await BalanceSheetPage(makeProps("2026-05-29")))
    expect(html).toContain("$12,000.00") // church balance
    expect(html).toContain("$10,300.00") // tithe balance
    expect(html).toContain("$10,050.00") // petty balance
    expect(html).toContain("Total")
    expect(html).toContain("$32,350.00") // summed Total
  })

  it("renders an em-dash Total when no account has an opening balance", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockObFindMany.mockResolvedValue([])
    const html = renderToStaticMarkup(await BalanceSheetPage(makeProps()))
    expect(html).toContain("Total")
    expect(html).not.toContain("$") // no balances anywhere
  })
})
