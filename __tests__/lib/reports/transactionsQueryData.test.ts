/** @jest-environment node */

// getTransactionsData is DB-backed (buildTransactionWhere's pure edge cases live
// in transactionsQuery.test.ts with a `prisma: {}` mock). This file exercises the
// fix: a shape-valid but nonexistent paymentAccount id must be stripped
// from the `where` too, not just from the returned value — otherwise the list
// silently filters to zero rows against an id the dropdown shows as unselected.

jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    account: { findMany: jest.fn().mockResolvedValue([]) },
    family: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("@/lib/accountingLock", () => ({ getAccountingLockDate: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/paymentAccounts", () => ({ getPaymentAccounts: jest.fn() }))

import { prisma } from "@/lib/prisma"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { getTransactionsData } from "@/lib/reports/transactionsQuery"

const mockTxFindMany = prisma.transaction.findMany as jest.Mock
const mockGetPaymentAccounts = getPaymentAccounts as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPaymentAccounts.mockResolvedValue([
    { id: 1, name: "ANZ", kind: "BANK", isDefault: true, isActive: true },
  ])
})

describe("getTransactionsData — nonexistent paymentAccount filter", () => {
  it("strips a shape-valid but nonexistent id from the where and the returned value", async () => {
    const result = await getTransactionsData({ paymentAccount: "999" })
    expect(result.paymentAccountId).toBeUndefined()
    expect(mockTxFindMany.mock.calls[0][0].where).not.toHaveProperty("paymentAccountId")
  })

  it("keeps a filter on an id that exists", async () => {
    const result = await getTransactionsData({ paymentAccount: "1" })
    expect(result.paymentAccountId).toBe(1)
    expect(mockTxFindMany.mock.calls[0][0].where).toHaveProperty("paymentAccountId", 1)
  })
})
