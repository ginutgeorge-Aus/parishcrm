// __tests__/actions/petty-cash-import.test.ts
/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findMany: jest.fn() },
    person: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    pettyCashSession: { findMany: jest.fn(), upsert: jest.fn() },
    pettyCashReceipt: { findMany: jest.fn() },
    pettyCashExpense: { findMany: jest.fn() },
    // Backs getCashAccount(), resolved once per import batch.
    paymentAccount: {
      // findFirst null + upsert = getCashAccount()'s self-heal.
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 2, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true }),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/accountingLock", () => ({
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
  isDateLocked: jest.requireActual("@/lib/accountingLock").isDateLocked,
}))
// pettyCashEntry builders are pure (encrypt is mocked above) — use the real
// module so the test exercises the actual batched write shape.

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { previewImport, commitImport } from "@/lib/actions/pettyCashImport"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { dedupeKey } from "@/lib/pettyCashImport"
import { decrypt, safeDecrypt } from "@/lib/crypto"

const mockSession = auth as jest.Mock
const mockLockDate = getAccountingLockDate as jest.Mock
const mockAccounts = prisma.account.findMany as jest.Mock
const mockPeople = prisma.person.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

function fd(csv: string, custodianId = "5") {
  const f = new FormData()
  f.set("custodianId", custodianId)
  f.set("csv", csv)
  return f
}

const HEADER = "date,type,account,payee_or_donor,amount,notes"

describe("previewImport", () => {
  it("rejects non-admins", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    const res = await previewImport(fd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`))
    expect(res).toEqual({ error: "Unauthorized" })
  })

  it("resolves accounts and donors and returns a preview", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccounts.mockResolvedValue([{ id: 1, name: "Sunday Offertory", type: "INCOME", isActive: true }])
    mockPeople.mockResolvedValue([{ id: 9, firstName: "Amy", middleName: null, lastName: "Taylor", bankingName: null }])
    const res = await previewImport(fd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,Amy Taylor,122,`))
    expect("preview" in res).toBe(true)
    if ("preview" in res) {
      expect(res.preview.rows[0]).toMatchObject({ accountId: 1, errors: [] })
      expect(res.preview.rows[0].donor).toMatchObject({ status: "matched", personId: 9 })
      expect(res.preview.hardErrorCount).toBe(0)
    }
  })

  it("reports hard errors for unknown accounts", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccounts.mockResolvedValue([])
    mockPeople.mockResolvedValue([])
    const res = await previewImport(fd(`${HEADER}\n2025-09-07,receipt,Nope,,122,`))
    if ("preview" in res) expect(res.preview.hardErrorCount).toBe(1)
    else throw new Error("expected preview")
  })
})

const mockSessFind = prisma.pettyCashSession.findMany as jest.Mock
const mockSessUpsert = prisma.pettyCashSession.upsert as jest.Mock
const mockRcptFind = prisma.pettyCashReceipt.findMany as jest.Mock
const mockExpFind = prisma.pettyCashExpense.findMany as jest.Mock
const mockTx = prisma.$transaction as jest.Mock

function commitFd(csv: string) {
  const f = new FormData()
  f.set("custodianId", "5")
  f.set("csv", csv)
  f.set("donorOverrides", "{}")
  return f
}

describe("commitImport", () => {
  beforeEach(() => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccounts.mockResolvedValue([
      { id: 1, name: "Sunday Offertory", type: "INCOME", isActive: true },
      { id: 2, name: "Church Operations", type: "EXPENSE", isActive: true },
    ])
    mockPeople.mockResolvedValue([])
    mockSessFind.mockResolvedValue([])      // no existing sessions
    mockRcptFind.mockResolvedValue([])      // no existing entries (dedupe)
    mockExpFind.mockResolvedValue([])
  })

  it("blocks commit when a hard error exists", async () => {
    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Nope,,122,`))
    expect(res).toEqual({ error: expect.stringMatching(/error/i) })
    expect(mockTx).not.toHaveBeenCalled()
  })

  it("creates sessions, receipts, expenses and a mirror per row", async () => {
    // Capture the work done inside the $transaction by running the callback with a fake tx client.
    const fakeTx = {
      pettyCashSession: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, status: "OPEN", ...create })),
        // Pre-insert lock recheck — default to a winning match (still OPEN).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pettyCashReceipt: { createManyAndReturn: jest.fn(async ({ data }: any) => data.map((d: any, i: number) => ({ id: i + 1, ...d }))) },
      pettyCashExpense: { createManyAndReturn: jest.fn(async ({ data }: any) => data.map((d: any, i: number) => ({ id: i + 1, ...d }))) },
      transaction: { createMany: jest.fn(async (_args: any) => ({ count: 1 })) },
    }
    mockTx.mockImplementation(async (cb: any) => cb(fakeTx))
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })

    const csv = `${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,\n2025-09-07,expense,Church Operations,Vicar,200,Vicar Ta`
    const res = await commitImport(commitFd(csv))

    expect(res).toMatchObject({ success: expect.any(String) })
    expect(fakeTx.pettyCashSession.upsert).toHaveBeenCalledTimes(1)                          // one session for the shared date
    expect(fakeTx.pettyCashReceipt.createManyAndReturn).toHaveBeenCalledTimes(1)             // one batched receipt insert
    expect(fakeTx.pettyCashReceipt.createManyAndReturn.mock.calls[0][0].data).toHaveLength(1)
    expect(fakeTx.pettyCashExpense.createManyAndReturn.mock.calls[0][0].data).toHaveLength(1)
    const mirrors = fakeTx.transaction.createMany.mock.calls.reduce((n: number, c: any) => n + c[0].data.length, 0)
    expect(mirrors).toBe(2)                                                                  // mirror per entry
    // Mirror rows link back to the generated ids and carry the session title.
    const receiptMirror = fakeTx.transaction.createMany.mock.calls[0][0].data[0]
    expect(receiptMirror).toMatchObject({ type: "INCOME", bankRef: "PC_R_1", pettyCashReceiptId: 1, reference: "07-SEP-2025" })
  })

  it("rejects the import when a session is closed by a concurrent transaction just before the batched insert", async () => {
    // The top-of-transaction read/upsert saw the session OPEN, but a concurrent
    // closeSession commits before the pre-insert recheck runs — the recheck's
    // conditional updateMany must catch it and abort the whole import.
    const fakeTx = {
      pettyCashSession: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, status: "OPEN", ...create })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pettyCashReceipt: { createManyAndReturn: jest.fn() },
      pettyCashExpense: { createManyAndReturn: jest.fn() },
      transaction: { createMany: jest.fn() },
    }
    mockTx.mockImplementation(async (cb: any) => cb(fakeTx))
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })

    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`))

    expect(res).toEqual({ error: expect.stringMatching(/is closed/) })
    expect(fakeTx.pettyCashReceipt.createManyAndReturn).not.toHaveBeenCalled()
    expect(fakeTx.transaction.createMany).not.toHaveBeenCalled()
  })

  it("rejects the import when a row is in the locked accounting period", async () => {
    mockLockDate.mockResolvedValueOnce(new Date("2026-06-30"))
    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`))
    expect(res).toEqual({
      error: "One or more rows fall in a locked accounting period (on or before 2026-06-30). Adjust the lock date or exclude those rows.",
    })
    expect(mockTx).not.toHaveBeenCalled()
  })

  it("rejects an archived person as custodian", async () => {
    // findFirst is scoped to archivedAt: null, so an archived custodian id
    // resolves to null — same as a non-existent person.
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null)
    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`))
    expect(res).toEqual({ error: "Custodian not found" })
    expect(mockTx).not.toHaveBeenCalled()
  })

  it("rejects a donor override that is not an active person", async () => {
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })  // custodian ok
    mockPeople.mockResolvedValue([])                                       // override id 999 not active
    const f = new FormData()
    f.set("custodianId", "5")
    f.set("csv", `${HEADER}\n2025-09-07,receipt,Sunday Offertory,Someone,122,`)
    f.set("donorOverrides", JSON.stringify({ "1": 999 }))
    const res = await commitImport(f)
    expect(res).toEqual({ error: expect.stringMatching(/invalid donor/i) })
    expect(mockTx).not.toHaveBeenCalled()
  })

  it("is idempotent: skips a re-imported donor receipt already on file", async () => {
    // The donor name is stored in notes, so the dedupe key for a re-imported
    // donor receipt must match the existing row's stored notes.
    mockRcptFind.mockResolvedValue([
      { date: new Date("2025-09-07T00:00:00.000Z"), accountId: 1, amount: 122, notes: "Amy Taylor" },
    ])
    const fakeTx = {
      pettyCashSession: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, status: "OPEN", ...create })),
        // Pre-insert lock recheck — default to a winning match (still OPEN).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pettyCashReceipt: { createManyAndReturn: jest.fn() },
      pettyCashExpense: { createManyAndReturn: jest.fn() },
      transaction: { createMany: jest.fn() },
    }
    mockTx.mockImplementation(async (cb: any) => cb(fakeTx))
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })

    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,Amy Taylor,122,`))

    expect(res).toMatchObject({ success: expect.stringMatching(/skipped 1 duplicate/) })
    expect(fakeTx.pettyCashReceipt.createManyAndReturn).not.toHaveBeenCalled()
    expect(fakeTx.transaction.createMany).not.toHaveBeenCalled()
  })

  it("skips re-import via stored importKey even after notes were edited", async () => {
    // Existing receipt: its notes were edited post-import to something that no
    // longer matches the CSV, but its importKey is frozen from import time.
    const frozenKey = dedupeKey({ date: new Date("2025-09-07T00:00:00.000Z"), type: "receipt", accountId: 1, amount: 122, text: "Amy Taylor" })
    mockRcptFind.mockResolvedValue([
      { date: new Date("2025-09-07T00:00:00.000Z"), accountId: 1, amount: 122, notes: "EDITED LATER — different", importKey: frozenKey },
    ])
    const fakeTx = {
      pettyCashSession: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, status: "OPEN", ...create })),
        // Pre-insert lock recheck — default to a winning match (still OPEN).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pettyCashReceipt: { createManyAndReturn: jest.fn() },
      pettyCashExpense: { createManyAndReturn: jest.fn() },
      transaction: { createMany: jest.fn() },
    }
    mockTx.mockImplementation(async (cb: any) => cb(fakeTx))
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })

    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,Amy Taylor,122,`))

    expect(res).toMatchObject({ success: expect.stringMatching(/skipped 1 duplicate/) })
    expect(fakeTx.pettyCashReceipt.createManyAndReturn).not.toHaveBeenCalled()
  })

  it("does not abort the dedupe pass when an existing row's ciphertext can't be decrypted", async () => {
    // A rotated-out-key or corrupt existing row must degrade gracefully via
    // safeDecrypt, not throw raw out of the whole import.
    ;(decrypt as jest.Mock).mockImplementation((v: string) => {
      if (v === "enc:CORRUPT") throw new Error("unknown key id")
      return v.replace(/^enc:/, "")
    })
    ;(safeDecrypt as jest.Mock).mockImplementation((v: string) =>
      v === "enc:CORRUPT" ? "�" : v.replace(/^enc:/, "")
    )
    mockRcptFind.mockResolvedValue([
      { date: new Date("2025-09-07T00:00:00.000Z"), accountId: 1, amount: 999, notes: "enc:CORRUPT" },
    ])
    const fakeTx = {
      pettyCashSession: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(async ({ create }: any) => ({ id: 100, status: "OPEN", ...create })),
        // Pre-insert lock recheck — default to a winning match (still OPEN).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pettyCashReceipt: { createManyAndReturn: jest.fn(async ({ data }: any) => data.map((d: any, i: number) => ({ id: i + 1, ...d }))) },
      pettyCashExpense: { createManyAndReturn: jest.fn() },
      transaction: { createMany: jest.fn(async (_args: any) => ({ count: 1 })) },
    }
    mockTx.mockImplementation(async (cb: any) => cb(fakeTx))
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })

    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`))

    expect(res).toMatchObject({ success: expect.any(String) })
    expect(fakeTx.pettyCashReceipt.createManyAndReturn).toHaveBeenCalledTimes(1)
  })

  it("reuses the session when a concurrent import wins the race", async () => {
    // upsert (INSERT … ON CONFLICT) resolves the unique-title race to the winner
    // row without raising P2002 — no in-tx refetch that a 25P02 abort would break.
    const fakeTx: any = {
      pettyCashSession: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ id: 100, title: "07-SEP-2025", status: "OPEN" }),
        // Pre-insert lock recheck — default to a winning match (still OPEN).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pettyCashReceipt: { createManyAndReturn: jest.fn(async ({ data }: any) => data.map((d: any, i: number) => ({ id: i + 1, ...d }))) },
      pettyCashExpense: { createManyAndReturn: jest.fn() },
      transaction: { createMany: jest.fn(async (_args: any) => ({ count: 1 })) },
    }
    mockTx.mockImplementation(async (cb: any) => cb(fakeTx))
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })

    const res = await commitImport(commitFd(`${HEADER}\n2025-09-07,receipt,Sunday Offertory,,122,`))

    expect(res).toMatchObject({ success: expect.any(String) })
    expect(fakeTx.pettyCashSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { title: "07-SEP-2025" }, update: {} }),
    )
    expect(fakeTx.pettyCashReceipt.createManyAndReturn).toHaveBeenCalledTimes(1)    // import still proceeded
  })
})
