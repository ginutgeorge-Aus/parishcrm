/** @jest-environment node */

import { POST } from "@/app/api/import/bank-statement/confirm/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { __resetRateLimit } from "@/lib/rateLimit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
  isDateLocked: jest.requireActual("@/lib/accountingLock").isDateLocked,
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
    account: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    family: {
      findMany: jest.fn(),
    },
    person: {
      findMany: jest.fn(),
    },
    paymentAccount: {
      // Existence/kind/isActive check for any row-level paymentAccountId — one
      // active BANK account, id 1, matching the fixtures below.
      findMany: jest.fn().mockResolvedValue([{ id: 1, name: "ANZ Church", kind: "BANK", isActive: true }]),
      // Backs getCashAccount() — no cash account configured by default, so its
      // self-heal upserts the canonical Petty Cash.
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 2, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true }),
    },
  },
}))

const confirmedRow = {
  date: "2025-06-23",
  description: "PAYMENT FROM JACK",
  details: "PAYMENT FROM JACK | JACK",
  amount: "60.00",
  type: "INCOME",
  bankRef: "ANZ_987654321_20250623_60.00_PAYMENTFROMJACK",
  accountId: 1,
  skip: false,
}

function makeRequest(body: unknown) {
  const payload = JSON.stringify(body)
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": String(Buffer.byteLength(payload)) },
    body: payload,
  })
}

describe("POST /api/import/bank-statement/confirm", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetRateLimit() // confirm route is rate-limited 5/min per user
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.transaction.createMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 99 })
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([{ id: 1, type: "INCOME", isActive: true }])
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([{ id: 2 }])
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ id: 10, familyId: 2 }])
    ;(prisma.$transaction as jest.Mock).mockImplementation((ops) => Promise.all(ops))
  })

  test("returns 401 for unauthenticated user", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    const res = await POST(makeRequest([confirmedRow]))
    expect(res.status).toBe(401)
  })

  test("returns 403 for VIEWER role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const res = await POST(makeRequest([confirmedRow]))
    expect(res.status).toBe(403)
  })

  test("skips rows with skip=true", async () => {
    const res = await POST(makeRequest([{ ...confirmedRow, skip: true }]))
    const body = await res.json()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(body.skipped).toBe(1)
    expect(body.imported).toBe(0)
  })

  test("skips rows whose bankRef already exists (final dedup guard)", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ bankRef: confirmedRow.bankRef }])
    const res = await POST(makeRequest([confirmedRow]))
    const body = await res.json()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(prisma.transaction.createMany).not.toHaveBeenCalled()
    expect(body.duplicates).toBe(1)
    expect(body.imported).toBe(0)
  })

  test("creates transaction with correct fields and isGiving=false (batched createMany)", async () => {
    const res = await POST(makeRequest([confirmedRow]))
    const body = await res.json()
    expect(prisma.transaction.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          date: new Date("2025-06-23"),
          description: "enc:PAYMENT FROM JACK",
          amount: "60.00",
          type: "INCOME",
          accountId: 1,
          isGiving: false,
          bankRef: confirmedRow.bankRef,
          reconciled: false,
          // notes is now encrypted at write time, same as description.
          notes: "enc:PAYMENT FROM JACK | JACK",
        }),
      ],
      skipDuplicates: true,
    })
    expect(body.imported).toBe(1)
    expect(body.skipped).toBe(0)
    expect(body.duplicates).toBe(0)
  })

  const pettyCashRow = {
    date: "2025-07-22",
    description: "CASH DEPOSIT",
    details: "",
    amount: "1200.00",
    type: "INCOME",
    bankRef: "ANZ_987654321_20250722_1200.00_CASHDEPOSIT_123456",
    accountId: null,
    skip: false,
    paymentAccountId: 1,
    fromPettyCash: true,
  }

  test("fromPettyCash: resolves the pre-seeded XFER account by code", async () => {
    await POST(makeRequest([pettyCashRow]))
    expect(prisma.account.findUnique).toHaveBeenCalledWith({
      where: { code: "XFER" },
      select: { id: true },
    })
    // Pre-seeded path: no implicit upsert when the account already exists.
    expect(prisma.account.upsert).not.toHaveBeenCalled()
  })

  test("fromPettyCash: self-heal-upserts XFER only if the seed hasn't run", async () => {
    ;(prisma.account.findUnique as jest.Mock).mockResolvedValueOnce(null)
    ;(prisma.account.upsert as jest.Mock).mockResolvedValueOnce({ id: 99 })
    await POST(makeRequest([pettyCashRow]))
    expect(prisma.account.upsert).toHaveBeenCalledWith({
      where: { code: "XFER" },
      update: {},
      create: { code: "XFER", name: "Internal Transfer", type: "EXPENSE", isActive: false },
      select: { id: true },
    })
  })

  test("fromPettyCash: creates ANZ INCOME with XFER accountId", async () => {
    await POST(makeRequest([pettyCashRow]))
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "INCOME",
        accountId: 99,
        paymentAccountId: 1,
        bankRef: pettyCashRow.bankRef,
      }),
    })
  })

  test("fromPettyCash: creates paired PETTY_CASH EXPENSE", async () => {
    await POST(makeRequest([pettyCashRow]))
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "EXPENSE",
        accountId: 99,
        paymentAccountId: 2,
        bankRef: `XFER_OUT_${pettyCashRow.bankRef}`,
        amount: "1200.00",
      }),
    })
  })

  test("fromPettyCash: commits ANZ INCOME and PETTY_CASH pair atomically", async () => {
    await POST(makeRequest([pettyCashRow]))
    // Both legs go through one $transaction so a mid-pair failure can't split
    // the transfer (income recorded, matching cash-out lost).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0]
    expect(Array.isArray(ops)).toBe(true)
    expect(ops).toHaveLength(2)
  })

  test("fromPettyCash: does not create pair if ANZ row is duplicate", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([
      { bankRef: pettyCashRow.bankRef },
    ])
    await POST(makeRequest([pettyCashRow]))
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("fromPettyCash: skips petty cash pair if pairRef already exists", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([
      { bankRef: `XFER_OUT_${pettyCashRow.bankRef}` },
    ])
    await POST(makeRequest([pettyCashRow]))
    // ANZ INCOME created, petty cash pair skipped
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1)
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "INCOME" }),
    })
  })

  test("fromPettyCash: skips the XFER_OUT when a matching session transfer exists", async () => {
    // The bankRef-dedup query returns []; the session-transfer-mirror query
    // returns a matching transfer (same cents, date within window).
    ;(prisma.transaction.findMany as jest.Mock).mockImplementation((args: any) =>
      Promise.resolve(
        args?.where?.pettyCashTransferId
          ? [{ id: 50, amount: "1200.00", date: new Date("2025-07-23"), pettyCashTransferId: 42 }]
          : []
      )
    )
    await POST(makeRequest([pettyCashRow]))
    // ANZ INCOME still recorded; the PETTY_CASH cash-out is deduped (session
    // transfer already recorded it) — only one create.
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1)
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "INCOME", bankRef: pettyCashRow.bankRef }),
    })
  })

  test("fromPettyCash: still creates the XFER_OUT when no session transfer matches", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockImplementation((args: any) =>
      Promise.resolve(
        args?.where?.pettyCashTransferId
          ? [{ id: 50, amount: "999.00", date: new Date("2025-07-23"), pettyCashTransferId: 42 }] // amount mismatch
          : []
      )
    )
    await POST(makeRequest([pettyCashRow]))
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2) // income + cash-out
  })

  test("returns 400 naming the row when a row's accountId does not exist", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([])
    const res = await POST(makeRequest([confirmedRow]))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('"PAYMENT FROM JACK"')
    expect(body.error).toContain("2025-06-23")
    expect(body.error).toContain("no longer exists")
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    // a clean rejection wrote nothing but the attempt to post into the
    // ledger still leaves a forensic trail (reason = static validation message).
    expect(logAudit).toHaveBeenCalledWith(
      999,
      "IMPORT_BANK_STATEMENT_REJECTED",
      "Transaction",
      undefined,
      expect.objectContaining({ reason: expect.stringContaining("no longer exists") }),
      "unknown",
    )
  })

  test("returns 400 naming the row and both types when account type does not match the row type", async () => {
    // confirmedRow.type === "INCOME" but the account is EXPENSE
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([{ id: 1, type: "EXPENSE", isActive: true }])
    const res = await POST(makeRequest([confirmedRow]))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('"PAYMENT FROM JACK"')
    expect(body.error).toContain("2025-06-23")
    expect(body.error).toMatch(/EXPENSE/)
    expect(body.error).toMatch(/INCOME/)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("returns 400 naming the row when account is inactive", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([{ id: 1, type: "INCOME", isActive: false }])
    const res = await POST(makeRequest([confirmedRow]))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('"PAYMENT FROM JACK"')
    expect(body.error).toContain("inactive")
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  // --- Split transactions (one bank line → multiple category allocations) ---
  const splitRow = {
    date: "2025-06-23",
    description: "PAYMENT FROM JACK",
    details: "PAYMENT FROM JACK | JACK",
    amount: "100.00",
    type: "INCOME",
    bankRef: "ANZ_987654321_20250623_100.00_PAYMENTFROMJACK",
    accountId: null,
    skip: false,
    paymentAccountId: 1,
    splits: [
      { accountId: 1, amount: "60.00", familyId: 2, personId: 10 },
      { accountId: 3, amount: "40.00", familyId: null, personId: null },
    ],
  }

  test("split row: creates one transaction per allocation with per-line account/amount/member", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    const res = await POST(makeRequest([splitRow]))
    const body = await res.json()
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2)
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: "60.00",
        accountId: 1,
        type: "INCOME",
        familyId: 2,
        personId: 10,
        isGiving: true,
        bankRef: splitRow.bankRef,
      }),
    })
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: "40.00",
        accountId: 3,
        type: "INCOME",
        familyId: null,
        personId: null,
        isGiving: false,
        bankRef: `${splitRow.bankRef}#2`,
      }),
    })
    // `imported` counts bank lines, not Transaction rows written — one
    // split bank line contributes 1 here even though it wrote 2 Transaction
    // rows, matching how the plain-row and petty-cash-pair branches count.
    expect(body.imported).toBe(1)
  })

  test("split row: creates all allocations atomically in one $transaction", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    await POST(makeRequest([splitRow]))
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const arg = (prisma.$transaction as jest.Mock).mock.calls[0][0]
    expect(Array.isArray(arg)).toBe(true)
    expect(arg).toHaveLength(2)
  })

  test("split row: returns 400 when the same member is assigned to two allocations", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    const dup = { ...splitRow, splits: [
      { accountId: 1, amount: "60.00", familyId: 2, personId: 10 },
      { accountId: 3, amount: "40.00", familyId: 2, personId: 10 },
    ] }
    const res = await POST(makeRequest([dup]))
    expect(res.status).toBe(400)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("split row: returns 400 when an allocation pairs a person with a family they don't belong to", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    // person 10 belongs to family 2 (default mock), but the split names family 5
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([{ id: 5 }])
    const mismatch = { ...splitRow, splits: [
      { accountId: 1, amount: "60.00", familyId: 5, personId: 10 },
      { accountId: 3, amount: "40.00", familyId: null, personId: null },
    ] }
    const res = await POST(makeRequest([mismatch]))
    expect(res.status).toBe(400)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("returns 400 when a top-level row pairs a person with a family they don't belong to", async () => {
    // person 10 belongs to family 2 (default mock); the row names family 5.
    ;(prisma.family.findMany as jest.Mock).mockResolvedValue([{ id: 5 }])
    const mismatch = { ...confirmedRow, familyId: 5, personId: 10 }
    const res = await POST(makeRequest([mismatch]))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not belong/i)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("split row: allows two allocations with no member assigned", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    const noMember = { ...splitRow, splits: [
      { accountId: 1, amount: "60.00", familyId: null, personId: null },
      { accountId: 3, amount: "40.00", familyId: null, personId: null },
    ] }
    const res = await POST(makeRequest([noMember]))
    const body = await res.json()
    // one bank line in, one counted in `imported` (see comment above).
    expect(body.imported).toBe(1)
  })

  test("split row: returns 400 and inserts nothing when an allocation amount is zero", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    const bad = { ...splitRow, splits: [
      { accountId: 1, amount: "100.00", familyId: null, personId: null },
      { accountId: 3, amount: "0.00", familyId: null, personId: null },
    ] }
    const res = await POST(makeRequest([bad]))
    expect(res.status).toBe(400)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("split row: returns 400 and inserts nothing when allocations do not sum to the row amount", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    const bad = { ...splitRow, splits: [
      { accountId: 1, amount: "60.00", familyId: null, personId: null },
      { accountId: 3, amount: "30.00", familyId: null, personId: null },
    ] }
    const res = await POST(makeRequest([bad]))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('"PAYMENT FROM JACK"')
    expect(body.error).toContain("100.00")
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("split row: returns 400 when an allocation account type does not match the row type", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "EXPENSE", isActive: true },
    ])
    const res = await POST(makeRequest([splitRow]))
    expect(res.status).toBe(400)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  test("split row: re-import is skipped as duplicate when the canonical bankRef exists", async () => {
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ bankRef: splitRow.bankRef }])
    const res = await POST(makeRequest([splitRow]))
    const body = await res.json()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(body.duplicates).toBe(1)
    expect(body.imported).toBe(0)
  })

  test("imported counts bank lines consistently across plain, split, and petty-cash rows", async () => {
    // One plain row (1 Transaction), one split row with 2 allocations (2
    // Transactions), one fromPettyCash row (2 Transactions: deposit + paired
    // cash-out). Before the fix, `imported` mixed line-count and row-count —
    // the split row alone would have contributed 2 instead of 1, breaking
    // imported+duplicates === toImport.length.
    ;(prisma.account.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: "INCOME", isActive: true },
      { id: 3, type: "INCOME", isActive: true },
    ])
    const res = await POST(makeRequest([confirmedRow, splitRow, pettyCashRow]))
    const body = await res.json()
    expect(body.imported).toBe(3)
    expect(body.duplicates).toBe(0)
    expect(body.skipped).toBe(0)
  })

  test("returns 400 and does not create any transaction when rows array exceeds 1000", async () => {
    const oversizedRows = Array.from({ length: 1001 }, (_, i) => ({
      date: "2025-06-23",
      description: "PAYMENT",
      amount: "10.00",
      type: "INCOME",
      bankRef: `ANZ_123_20250623_10.00_PAYMENT_${i}`,
      accountId: 1,
      skip: false,
    }))
    const res = await POST(makeRequest(oversizedRows))
    expect(res.status).toBe(400)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })
})
