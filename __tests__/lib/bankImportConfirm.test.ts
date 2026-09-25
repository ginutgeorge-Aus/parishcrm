/** @jest-environment node */

// a plain (non-split, non-petty-cash) row with a null accountId was
// excluded from the plain-row createMany batch AND skipped by the linked-write
// loop, so it was silently dropped — imported without error, never persisted.
// confirmBankImport must now reject it as a validation error.

jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
  isDateLocked: jest.fn(() => false),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    family: { findMany: jest.fn() },
    person: { findMany: jest.fn() },
    // findFirst backs getCashAccount() (resolved once when any row is
    // fromPettyCash); findMany backs the paymentAccountId existence/kind
    // check when a row carries one. Default both to "not configured" / "none
    // referenced" so tests that don't care about payment accounts still pass.
    paymentAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      // upsert backs getCashAccount()'s self-heal when no active CASH row exists
      // (a fromPettyCash import triggers it) — return the canonical Petty Cash.
      upsert: jest.fn().mockResolvedValue({ id: 2, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true }),
      findMany: jest.fn().mockResolvedValue([{ id: 1, name: "ANZ Church", kind: "BANK", isActive: true }]),
    },
    transaction: { findMany: jest.fn(), createMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}))

import { prisma } from "@/lib/prisma"
import { getXferAccountId } from "@/lib/xferAccount"
import { confirmBankImport } from "@/lib/bankImportConfirm"

const mockAccountFindMany = prisma.account.findMany as jest.Mock
const mockFamilyFindMany = prisma.family.findMany as jest.Mock
const mockPersonFindMany = prisma.person.findMany as jest.Mock
const mockTxFindMany = prisma.transaction.findMany as jest.Mock
const mockCreateMany = prisma.transaction.createMany as jest.Mock
const mockCreate = prisma.transaction.create as jest.Mock
const mockGetXferAccountId = getXferAccountId as jest.Mock

const baseRow = {
  date: "2026-05-10",
  description: "Sunday offering",
  amount: "100.00",
  type: "INCOME" as const,
  bankRef: "REF-1",
  skip: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks wipes call data but NOT mockResolvedValue impls, so a test
  // that overrides these (e.g. the inactive-account case) would leak into the
  // next — re-assert the "active ANZ Church / self-heal cash / none configured"
  // defaults every test.
  ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([
    { id: 1, name: "ANZ Church", kind: "BANK", isActive: true },
  ])
  ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
  ;(prisma.paymentAccount.upsert as jest.Mock).mockResolvedValue({
    id: 2,
    name: "Petty Cash",
    kind: "CASH",
    isDefault: false,
    isActive: true,
  })
  mockTxFindMany.mockResolvedValue([])
  // createMany returns the true inserted count; default to "all inserted".
  mockCreateMany.mockImplementation((args: { data: unknown[] }) =>
    Promise.resolve({ count: args.data.length })
  )
})

describe("confirmBankImport — payment account isActive", () => {
  it("rejects a row referencing a deactivated bank account", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    ;(prisma.paymentAccount.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "ANZ Church", kind: "BANK", isActive: false },
    ])
    const result = await confirmBankImport([{ ...baseRow, accountId: 5, paymentAccountId: 1 }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.status).toBe(400)
    expect(result.error).toContain("Invalid payment account")
    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})

describe("confirmBankImport — plain row category validation", () => {
  it("rejects a plain row with a null category instead of silently dropping it", async () => {
    const result = await confirmBankImport([{ ...baseRow, accountId: null }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.status).toBe(400)
    expect(result.error).toContain("needs a category")
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it("imports a plain row that has a valid category", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    const result = await confirmBankImport([{ ...baseRow, accountId: 5 }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.imported).toBe(1)
    expect(mockCreateMany).toHaveBeenCalledTimes(1)
  })
})

describe("confirmBankImport — createMany insert count", () => {
  it("reports the actual inserted count and attributes skipped rows to duplicates", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    // Two distinct rows reach createMany, but a same-instant concurrent import
    // already inserted one bankRef, so skipDuplicates drops it → count = 1.
    mockCreateMany.mockResolvedValueOnce({ count: 1 })
    const result = await confirmBankImport([
      { ...baseRow, bankRef: "REF-1", accountId: 5 },
      { ...baseRow, bankRef: "REF-2", accountId: 5 },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.imported).toBe(1)
    expect(result.duplicates).toBe(1)
    // Invariant: imported + duplicates === rows to import.
    expect(result.imported + result.duplicates).toBe(2)
  })
})

describe("confirmBankImport — member link backfill", () => {
  it("fills familyId from the person's own family when a member is picked without one", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    mockFamilyFindMany.mockResolvedValue([{ id: 42 }])
    mockPersonFindMany.mockResolvedValue([{ id: 7, familyId: 42 }])
    const result = await confirmBankImport([
      { ...baseRow, accountId: 5, personId: 7 }, // familyId omitted
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const data = mockCreateMany.mock.calls[0][0].data
    expect(data[0]).toMatchObject({ personId: 7, familyId: 42, isGiving: true })
  })

  it("leaves familyId null and isGiving false for a person who genuinely has no family", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    mockPersonFindMany.mockResolvedValue([{ id: 8, familyId: null }])
    const result = await confirmBankImport([
      { ...baseRow, accountId: 5, personId: 8 },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const data = mockCreateMany.mock.calls[0][0].data
    expect(data[0]).toMatchObject({ personId: 8, familyId: null, isGiving: false })
  })
})

// statement detail lines (row.details, a superset of the encrypted
// description) were written to Transaction.notes in plaintext, defeating the
// description encryption. notes must now be encrypted the same way.
describe("confirmBankImport — notes encryption", () => {
  it("encrypts row.details into notes for a plain row", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    const result = await confirmBankImport([
      { ...baseRow, accountId: 5, details: "PAYMENT FROM JACK MORGAN REF 123" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const data = mockCreateMany.mock.calls[0][0].data
    expect(data[0].notes).toBe("enc:PAYMENT FROM JACK MORGAN REF 123")
  })

  it("stores null notes (not an encrypted empty string) when there is no details line", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    const result = await confirmBankImport([{ ...baseRow, accountId: 5 }])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const data = mockCreateMany.mock.calls[0][0].data
    expect(data[0].notes).toBeNull()
  })

  it("encrypts the composed notes string (details + split suffix) for a split row", async () => {
    mockAccountFindMany.mockResolvedValue([
      { id: 5, type: "INCOME", isActive: true },
      { id: 6, type: "INCOME", isActive: true },
    ])
    const result = await confirmBankImport([
      {
        ...baseRow,
        accountId: null,
        details: "TRANSFER FROM MARY TAYLOR",
        splits: [
          { accountId: 5, amount: "60.00" },
          { accountId: 6, amount: "40.00" },
        ],
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockCreate.mock.calls[0][0].data.notes).toBe(
      "enc:TRANSFER FROM MARY TAYLOR (split 1/2)"
    )
    expect(mockCreate.mock.calls[1][0].data.notes).toBe(
      "enc:TRANSFER FROM MARY TAYLOR (split 2/2)"
    )
  })

})

// the same real transaction imported once as a Statement (ANZ_ bankRef) and
// again as a Transaction Report (ANZTR_ bankRef) has two different exact bankRefs,
// so the exact dedup never catches it and the amount double-posts. The content key
// embedded in both bankRefs must dedup the cross-format re-import.
describe("confirmBankImport — cross-format dedup", () => {
  it("skips a report row whose transaction was already imported as a statement row", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    // The DB already holds the statement-format row for this transaction. Both the
    // exact-ref fetch and the date-range content-key fetch return it (same mock).
    mockTxFindMany.mockResolvedValue([
      { bankRef: "ANZ_987654321_20260608_300.00_PAYMENTFROMBRUNOTAYL_1030000", type: "INCOME" },
    ])
    const result = await confirmBankImport([
      {
        date: "2026-06-08",
        description: "PAYMENT FROM BRUNO TAYLOR WILLIAMSON",
        amount: "300.00",
        type: "INCOME",
        // Report-format bankRef for the SAME transaction — different prefix/suffix.
        bankRef: "ANZTR_987654321_20260608_300.00_PAYMENTFROMBRUNOTAYL_0",
        accountId: 5,
        skip: false,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.imported).toBe(0)
    expect(result.duplicates).toBe(1)
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it("imports a report row when no matching statement row exists", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    mockTxFindMany.mockResolvedValue([])
    const result = await confirmBankImport([
      {
        date: "2026-06-08",
        description: "PAYMENT FROM BRUNO TAYLOR WILLIAMSON",
        amount: "300.00",
        type: "INCOME",
        bankRef: "ANZTR_987654321_20260608_300.00_PAYMENTFROMBRUNOTAYL_0",
        accountId: 5,
        skip: false,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.imported).toBe(1)
    expect(result.duplicates).toBe(0)
  })
})

describe("confirmBankImport — notes encryption petty cash", () => {
  it("encrypts row.details into notes for the petty-cash-transfer deposit leg", async () => {
    mockGetXferAccountId.mockResolvedValue(99)
    const result = await confirmBankImport([
      {
        ...baseRow,
        accountId: null,
        fromPettyCash: true,
        paymentAccountId: 1,
        details: "DEPOSIT PETTY CASH FLOAT",
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    // First create() call is the deposit leg (accountId = xferAccountId).
    const depositCall = mockCreate.mock.calls.find((c) => c[0].data.accountId === 99 && c[0].data.type === "INCOME")
    expect(depositCall[0].data.notes).toBe("enc:DEPOSIT PETTY CASH FLOAT")
  })
})

describe("confirmBankImport — partial write on mid-batch DB fault", () => {
  it("returns the committed count + actionable error when a later row throws a non-unique DB error", async () => {
    // One plain row commits via createMany (imported=1); a split row then hits a
    // transient DB fault in its $transaction — the plain row is NOT rolled back.
    mockAccountFindMany.mockResolvedValue([
      { id: 5, type: "INCOME", isActive: true },
      { id: 6, type: "INCOME", isActive: true },
    ])
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(new Error("connection reset by peer"))

    const result = await confirmBankImport([
      { ...baseRow, bankRef: "REF-plain", accountId: 5 },
      {
        ...baseRow,
        bankRef: "REF-split",
        accountId: null,
        splits: [{ accountId: 6, amount: "100.00" }],
      },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.status).toBe(500)
    expect(result.imported).toBe(1) // the plain row really committed
    expect(result.error).toContain("already saved")
  })
})

describe("confirmBankImport — impossible calendar date", () => {
  it("rejects a shape-valid but non-existent date before any lock check or insert", async () => {
    // 2026-02-31 passes the YYYY-MM-DD regex but new Date() normalises it into
    // March — it must be rejected, not silently reposted under another period.
    const result = await confirmBankImport([{ ...baseRow, date: "2026-02-31", accountId: 5 }])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.status).toBe(400)
    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})

describe("confirmBankImport — petty-cash type invariant", () => {
  it("rejects a fromPettyCash row typed EXPENSE (deposit legs must be INCOME)", async () => {
    // A crafted EXPENSE + fromPettyCash row would book an ANZ expense plus a
    // petty-cash expense instead of the intended ANZ income + cash-out pair.
    const result = await confirmBankImport([
      { ...baseRow, type: "EXPENSE", fromPettyCash: true, paymentAccountId: 1, accountId: null },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("confirmBankImport — direction-aware cross-format dedup", () => {
  it("does not skip an INCOME row against an opposite-direction EXPENSE with the same content key", async () => {
    mockAccountFindMany.mockResolvedValue([{ id: 5, type: "INCOME", isActive: true }])
    // DB holds an EXPENSE transaction whose lossy content key (acct/date/amount/
    // desc-prefix) collides with this INCOME import — different direction, not a dup.
    mockTxFindMany.mockResolvedValue([
      { bankRef: "ANZ_987654321_20260608_300.00_PAYMENTFROMBRUNOTAYL_1030000", type: "EXPENSE" },
    ])
    const result = await confirmBankImport([
      {
        date: "2026-06-08",
        description: "PAYMENT FROM BRUNO TAYLOR WILLIAMSON",
        amount: "300.00",
        type: "INCOME",
        bankRef: "ANZTR_987654321_20260608_300.00_PAYMENTFROMBRUNOTAYL_0",
        accountId: 5,
        skip: false,
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.imported).toBe(1)
    expect(result.duplicates).toBe(0)
  })
})
