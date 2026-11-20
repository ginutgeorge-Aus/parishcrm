/**
 * AUD-3-04 part A: opening-balance carry-forward and close roll-forward.
 * calcRunningBalance is the real one so the money arithmetic is exercised.
 */
jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/actions/settings", () => ({ getPettyCashDefaultCustodianId: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const db = {
    pettyCashSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    person: { findFirst: jest.fn() },
    auditLog: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  }
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
  return { prisma: db }
})

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { closeSession, createSession, ensureWeeklySession } from "@/lib/actions/pettyCashSession"
import { getPettyCashDefaultCustodianId } from "@/lib/actions/settings"

const mockAuth = auth as jest.Mock
const s = prisma.pettyCashSession as unknown as Record<string, jest.Mock>
const mockAuditFind = (prisma as unknown as { auditLog: { findFirst: jest.Mock } }).auditLog.findFirst
const mockAudit = logAuditTx as jest.Mock
const mockCustodian = getPettyCashDefaultCustodianId as jest.Mock
const mockPerson = (prisma as unknown as { person: { findFirst: jest.Mock } }).person.findFirst

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  s.updateMany.mockResolvedValue({ count: 1 })
  s.findMany.mockResolvedValue([])
  mockAuditFind.mockResolvedValue(null)
})

describe("ensureWeeklySession opening balance", () => {
  beforeEach(() => {
    mockCustodian.mockResolvedValue(5)
    mockPerson.mockResolvedValue({ id: 5 })
    s.findFirst.mockResolvedValue(null) // no session for this Sunday yet
    s.create.mockResolvedValue({ id: 99 })
    s.findMany.mockResolvedValue([{ id: 7, title: "05-JAN-2020", openedAt: new Date("2020-01-06T00:00:00Z") }])
  })

  test("opening balance uses counted cash of a closed prior session", async () => {
    // System balance 100 - 20 = 80, but the tin held 75.
    s.findUnique.mockResolvedValue({
      status: "CLOSED",
      countedCash: "75.00",
      openingBalance: "100.00",
      receipts: [],
      expenses: [{ amount: "20.00" }],
      transfers: [],
    })
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "created" })
    expect(s.create).toHaveBeenCalledWith({ data: expect.objectContaining({ openingBalance: 75 }) })
  })

  test("closed prior session without a count opens from its running balance", async () => {
    s.findUnique.mockResolvedValue({
      status: "CLOSED",
      countedCash: null,
      openingBalance: "100.00",
      receipts: [],
      expenses: [{ amount: "20.00" }],
      transfers: [],
    })
    await ensureWeeklySession()
    expect(s.create).toHaveBeenCalledWith({ data: expect.objectContaining({ openingBalance: 80 }) })
  })

  test("open prior session: still creates, flags the opening as provisional and records the source", async () => {
    s.findUnique.mockResolvedValue({
      status: "OPEN",
      countedCash: null,
      openingBalance: "100.00",
      receipts: [],
      expenses: [{ amount: "20.00" }],
      transfers: [],
    })
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "created", provisional: true })
    expect(s.create).toHaveBeenCalledWith({ data: expect.objectContaining({ openingBalance: 80 }) })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(), 1, "PETTY_CASH_SESSION_AUTO_OPENED", "PettyCashSession", 99,
      expect.objectContaining({ openingBalance: 80, carriedFromSessionId: 7, provisional: true }),
    )
  })

  test("existing session whose prior is still open reports provisional", async () => {
    s.findFirst.mockResolvedValue({ id: 42 })
    s.findMany.mockResolvedValue([
      { id: 7, title: "05-JAN-2020", openedAt: new Date("2020-01-06T00:00:00Z"), status: "OPEN" },
    ])
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "exists", provisional: true })
    expect(s.create).not.toHaveBeenCalled()
  })

  test("existing session whose prior is closed is not provisional", async () => {
    s.findFirst.mockResolvedValue({ id: 42 })
    s.findMany.mockResolvedValue([
      { id: 7, title: "05-JAN-2020", openedAt: new Date("2020-01-06T00:00:00Z"), status: "CLOSED" },
    ])
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "exists" })
  })
})

describe("closeSession roll-forward", () => {
  // Session 1 (05-JAN-2020): opening 100, one 20 expense → system 80.
  const closing = {
    id: 1,
    title: "05-JAN-2020",
    status: "OPEN",
    openingBalance: "100.00",
    receipts: [],
    expenses: [{ amount: "20.00" }],
    transfers: [],
  }
  // Session 2 (12-JAN-2020) was auto-opened from session 1 at 100 (before the expense).
  const next = { id: 2, status: "OPEN", openingBalance: "100.00" }

  beforeEach(() => {
    s.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
      where.id === 1 ? closing : where.id === 2 ? next : null)
    s.findMany.mockResolvedValue([
      { id: 1, title: "05-JAN-2020", openedAt: new Date("2020-01-06T00:00:00Z") },
      { id: 2, title: "12-JAN-2020", openedAt: new Date("2020-01-13T00:00:00Z") },
    ])
    mockAuditFind.mockResolvedValue({ id: 500 }) // AUTO_OPENED row says: carried from session 1
  })

  test("closing a session rolls the corrected balance into the next session and audits it", async () => {
    await closeSession(1, undefined, fd({ countedCash: "75.00", notes: "5 short" }))
    // Counted cash wins (pending PO confirmation on #3341).
    expect(s.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { openingBalance: "75.00" } })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(), 1, "PETTY_CASH_SESSION_OPENING_ROLLED_FORWARD", "PettyCashSession", 2,
      expect.objectContaining({ fromSessionId: 1, oldOpeningBalance: "100.00", newOpeningBalance: "75.00", basis: "counted" }),
    )
    // Only auto-opened sessions carried from THIS session qualify.
    expect(mockAuditFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: "PETTY_CASH_SESSION_AUTO_OPENED",
        resourceId: 2,
        metadata: { path: ["carriedFromSessionId"], equals: 1 },
      }),
    }))
  })

  test("count-less close rolls the system balance forward", async () => {
    await closeSession(1, undefined, fd({ notes: "handover" }))
    expect(s.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { openingBalance: "80.00" } })
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(), 1, "PETTY_CASH_SESSION_OPENING_ROLLED_FORWARD", "PettyCashSession", 2,
      expect.objectContaining({ basis: "system", newOpeningBalance: "80.00" }),
    )
  })

  test("a manually opened next session (no auto-open carry from this one) is left alone", async () => {
    mockAuditFind.mockResolvedValue(null)
    await closeSession(1, undefined, fd({ notes: "handover" }))
    expect(s.update).not.toHaveBeenCalled()
  })

  test("a closed next session is never changed", async () => {
    s.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
      where.id === 1 ? closing : { ...next, status: "CLOSED" })
    await closeSession(1, undefined, fd({ notes: "handover" }))
    expect(s.update).not.toHaveBeenCalled()
  })

  test("no update or audit when the next opening already matches", async () => {
    s.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
      where.id === 1 ? closing : { ...next, openingBalance: "80.00" })
    await closeSession(1, undefined, fd({ notes: "handover" }))
    expect(s.update).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "PETTY_CASH_SESSION_OPENING_ROLLED_FORWARD",
      expect.anything(), expect.anything(), expect.anything(),
    )
  })

  test("the close runs Serializable", async () => {
    await closeSession(1, undefined, fd({ notes: "handover" }))
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
  })

  test("variance is computed from the read inside the close transaction", async () => {
    // Pre-read (outside the tx) sees no expenses; the in-tx read sees the 20 expense.
    let first = true
    s.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => {
      if (where.id !== 1) return next
      if (first) {
        first = false
        return { ...closing, expenses: [] }
      }
      return closing
    })
    // 80 counted == in-tx system balance 80 → no variance note needed.
    const res = await closeSession(1, undefined, fd({ countedCash: "80.00" }))
    expect(res).toBeUndefined()
    expect(s.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ countedCash: "80.00", closingVariance: "0.00" }),
    }))
  })

  test("close notes are encrypted at rest", async () => {
    await closeSession(1, undefined, fd({ notes: "handed to the treasurer" }))
    expect(s.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ notes: "enc:handed to the treasurer" }),
    }))
  })
})

describe("createSession audit", () => {
  test("writes an audit row carrying the manual opening balance", async () => {
    mockPerson.mockResolvedValue({ id: 3 })
    s.create.mockResolvedValue({ id: 7 })
    await createSession(undefined, fd({ sessionDate: "2026-05-24", custodianId: "3", openingBalance: "12.34" }))
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(), 1, "PETTY_CASH_SESSION_CREATED", "PettyCashSession", 7,
      expect.objectContaining({ title: "24-MAY-2026", custodianId: 3, openingBalance: "12.34" }),
    )
  })
})
