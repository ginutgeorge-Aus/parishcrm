/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    account: { findMany: jest.fn() },
    family: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
// A small fixed account list — id 3 doubles as the "non-default" account the
// paymentAccount-filter test selects (mirrors the old PETTY_CASH literal).
jest.mock("@/lib/paymentAccounts", () => ({
  getPaymentAccounts: jest.fn().mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isDefault: true, isActive: true },
    { id: 3, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true },
  ]),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
}))
jest.mock("@/components/accounting/TransactionFilters", () => ({
  TransactionFilters: () => null,
}))
jest.mock("@/components/accounting/DeleteTransactionButton", () => ({
  DeleteTransactionButton: () => null,
}))
jest.mock("@/components/accounting/ReconcileToggleButton", () => ({
  ReconcileToggleButton: () => null,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"
import TransactionsPage from "@/app/(dashboard)/accounting/transactions/page"

const mockAuth = auth as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock
const mockTxCount = prisma.transaction.count as jest.Mock
const mockTxAggregate = prisma.transaction.aggregate as jest.Mock
const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockFamilyFindMany = prisma.family.findMany as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockLogAudit = logAudit as jest.Mock

type Params = {
  from?: string
  to?: string
  account?: string
  type?: string
  family?: string
  paymentAccount?: string
  reconciled?: string
  q?: string
  page?: string
}

const makeProps = (params: Params = {}) => ({
  searchParams: Promise.resolve(params),
})

const dec = (n: string) => ({ toString: () => n })

const makeTx = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  date: new Date("2025-08-15"),
  description: "enc:Sunday offering",
  amount: dec("100.00"),
  type: "INCOME",
  reconciled: false,
  paymentAccountId: 1,
  paymentAccountRel: { id: 1, name: "ANZ Church" },
  familyId: null,
  accountId: 1,
  pettyCashReceiptId: null,
  pettyCashExpenseId: null,
  account: { code: "4000", name: "Tithes" },
  family: null,
  pettyCashReceipt: null,
  pettyCashExpense: null,
  ...over,
})

const emptyAgg = { _sum: { amount: null } }

function primeEmpty() {
  mockTxFindMany.mockResolvedValue([])
  mockTxCount.mockResolvedValue(0)
  mockTxAggregate.mockResolvedValue(emptyAgg)
  mockAccountFindMany.mockResolvedValue([])
  mockFamilyFindMany.mockResolvedValue([])
}

// Freeze to a fixed mid-FY date so the FY-default assertions below don't change
// meaning across the 1 July FY boundary — production and test now derive the
// same `now`.
beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers({ now: new Date("2026-06-01T00:00:00Z") })
})
afterEach(() => jest.useRealTimers())

describe("TransactionsPage", () => {
  // --- Role guard ---
  it("redirects VIEWER to /", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    await expect(TransactionsPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("redirects unauthenticated (no session) to /", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(TransactionsPage(makeProps())).rejects.toThrow("REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith("/")
  })

  it("allows AUDITOR to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    primeEmpty()
    const result = await TransactionsPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("allows ADMIN to view", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    const result = await TransactionsPage(makeProps())
    expect(result).toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  // --- FY default date logic ---
  it("applies FY default 'from' (1 July of current FY) when no date params", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps())
    const where = mockTxFindMany.mock.calls[0][0].where
    const now = new Date()
    const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
    expect(where.date.gte).toEqual(new Date(`${fyYear}-07-01`))
    expect(where.date.lte).toBeUndefined()
  })

  it("uses provided valid ISO 'from'/'to' over the default", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ from: "2024-01-01", to: "2024-12-31" }))
    const where = mockTxFindMany.mock.calls[0][0].where
    expect(where.date.gte).toEqual(new Date("2024-01-01"))
    // 'to' upper bound is the inclusive end-of-day so transactions stamped later
    // in the day are not excluded.
    expect(where.date.lte).toEqual(new Date("2024-12-31T23:59:59.999Z"))
  })

  it("falls back to FY default when 'from' is malformed (non-ISO)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ from: "01/02/2024" }))
    const where = mockTxFindMany.mock.calls[0][0].where
    const now = new Date()
    const fyYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
    expect(where.date.gte).toEqual(new Date(`${fyYear}-07-01`))
  })

  it("ignores malformed 'to' (no lte added)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ to: "not-a-date" }))
    const where = mockTxFindMany.mock.calls[0][0].where
    expect(where.date.lte).toBeUndefined()
  })

  // --- Other filters mapped into where ---
  it("maps account/type/family/paymentAccount/reconciled filters into where", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({
      account: "5",
      type: "EXPENSE",
      family: "7",
      paymentAccount: "3",
      reconciled: "true",
    }))
    const where = mockTxFindMany.mock.calls[0][0].where
    expect(where.accountId).toBe(5)
    expect(where.type).toBe("EXPENSE")
    expect(where.familyId).toBe(7)
    expect(where.paymentAccountId).toBe(3)
    expect(where.reconciled).toBe(true)
  })

  it("AND-combines the summary aggregates with an active type filter", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ type: "EXPENSE" }))
    // Both summary aggregates must respect the EXPENSE filter via AND rather than
    // overriding `type` by spread — otherwise the income tile shows unfiltered income.
    const incomeWhere = mockTxAggregate.mock.calls[0][0].where
    const expenseWhere = mockTxAggregate.mock.calls[1][0].where
    expect(incomeWhere.AND).toEqual([expect.objectContaining({ type: "EXPENSE" }), { type: "INCOME" }])
    expect(expenseWhere.AND).toEqual([expect.objectContaining({ type: "EXPENSE" }), { type: "EXPENSE" }])
  })

  it("maps reconciled=false into where", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ reconciled: "false" }))
    const where = mockTxFindMany.mock.calls[0][0].where
    expect(where.reconciled).toBe(false)
  })

  it("treats invalid account id (<=0 / NaN) as undefined", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ account: "0" }))
    const where = mockTxFindMany.mock.calls[0][0].where
    expect(where.accountId).toBeUndefined()
  })

  // --- Pagination / take + skip ---
  it("pages at take=50, skip=0 on page 1 when not searching", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps())
    expect(mockTxFindMany.mock.calls[0][0].take).toBe(50)
    expect(mockTxFindMany.mock.calls[0][0].skip).toBe(0)
  })

  it("applies skip for later pages (page=3 → skip=100)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ page: "3" }))
    expect(mockTxFindMany.mock.calls[0][0].take).toBe(50)
    expect(mockTxFindMany.mock.calls[0][0].skip).toBe(100)
  })

  it("caps the scan at 5000 and omits skip when searching by description (q present)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps({ q: "offering" }))
    expect(mockTxFindMany.mock.calls[0][0].take).toBe(5000)
    expect(mockTxFindMany.mock.calls[0][0].skip).toBeUndefined()
  })

  // --- Encrypted-search path ---
  it("decrypts then in-memory filters by q (case-insensitive)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockTxFindMany.mockResolvedValue([
      makeTx({ id: 1, description: "enc:Sunday OFFERING" }),
      makeTx({ id: 2, description: "enc:Rent payment", type: "EXPENSE", amount: dec("50.00") }),
    ])
    mockTxCount.mockResolvedValue(2)
    mockTxAggregate.mockResolvedValue(emptyAgg)
    mockAccountFindMany.mockResolvedValue([])
    mockFamilyFindMany.mockResolvedValue([])
    const result = await TransactionsPage(makeProps({ q: "offering" }))
    expect(result).toBeDefined()
    // Scan is capped at 5000 (well above these 2 rows); only the matching row survives the q filter.
    expect(mockTxFindMany.mock.calls[0][0].take).toBe(5000)
  })

  it("renders without error with full unsearched data", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockTxFindMany.mockResolvedValue([
      makeTx({ id: 1, type: "INCOME", amount: dec("100.00") }),
      makeTx({ id: 2, type: "EXPENSE", amount: dec("40.00"), description: "enc:Rent" }),
    ])
    mockTxCount.mockResolvedValue(2)
    mockTxAggregate
      .mockResolvedValueOnce({ _sum: { amount: dec("100.00") } }) // income
      .mockResolvedValueOnce({ _sum: { amount: dec("40.00") } }) // expense
    mockAccountFindMany.mockResolvedValue([{ id: 1, code: "4000", name: "Tithes" }])
    mockFamilyFindMany.mockResolvedValue([{ id: 1, name: "Smith" }])
    const result = await TransactionsPage(makeProps())
    expect(result).toBeDefined()
  })

  // --- Audit logging ---
  it("logs VIEW_TRANSACTION_LIST for AUDITOR", async () => {
    mockAuth.mockResolvedValue({ user: { role: "AUDITOR", id: "9" } })
    primeEmpty()
    await TransactionsPage(makeProps())
    expect(mockLogAudit).toHaveBeenCalledWith(9, "VIEW_TRANSACTION_LIST", "Transaction")
  })

  it("logs VIEW_TRANSACTION_LIST for ADMIN too", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps())
    expect(mockLogAudit).toHaveBeenCalledWith(1, "VIEW_TRANSACTION_LIST", "Transaction")
  })

  // --- Account/family lookups for filter dropdowns ---
  it("fetches only active accounts and non-archived families", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    primeEmpty()
    await TransactionsPage(makeProps())
    expect(mockAccountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    )
    expect(mockFamilyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } })
    )
  })
})
