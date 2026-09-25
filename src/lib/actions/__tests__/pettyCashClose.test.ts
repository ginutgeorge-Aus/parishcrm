import { closeSession } from "@/lib/actions/pettyCashSession"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
// Value import of `Prisma` in pettyCash.ts loads the real generated client
// (cuid2 init) — stub the namespace so the suite doesn't pull it in.
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    pettyCashSession: { findUnique: jest.fn(), updateMany: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockFind = prisma.pettyCashSession.findUnique as jest.Mock
const mockUpdate = prisma.pettyCashSession.updateMany as jest.Mock
const mockAudit = logAudit as jest.Mock

// system balance = 100.00 (opening 100, no entries)
function openSession(overrides = {}) {
  return {
    id: 1,
    status: "OPEN",
    openingBalance: "100.00",
    receipts: [],
    expenses: [],
    transfers: [],
    ...overrides,
  }
}
function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockUpdate.mockResolvedValue({ count: 1 })
})

test("unauthorized role rejected", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
  const res = await closeSession(1, undefined, fd({}))
  expect(res).toEqual({ error: "Unauthorized" })
  expect(mockUpdate).not.toHaveBeenCalled()
})

test("blank counted cash closes with null count + null variance", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ notes: "handover" }))
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ countedCash: null, closingVariance: null }),
    })
  )
})

test("count-less close still writes an audit record with counted:false", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ notes: "handover" }))
  expect(mockAudit).toHaveBeenCalledWith(
    1,
    "PETTY_CASH_SESSION_CLOSED",
    "PettyCashSession",
    1,
    expect.objectContaining({ counted: false, countedCash: null, variance: null })
  )
})

test("counted close audits counted:true with the count + variance", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ countedCash: "100.00" }))
  expect(mockAudit).toHaveBeenCalledWith(
    1,
    "PETTY_CASH_SESSION_CLOSED",
    "PettyCashSession",
    1,
    expect.objectContaining({ counted: true, countedCash: "100.00", variance: "0.00" })
  )
})

test("counted equals system → variance 0.00 stored, no note needed", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ countedCash: "100.00" }))
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ countedCash: "100.00", closingVariance: "0.00" }),
    })
  )
})

test("counted differs + blank note → error, not persisted", async () => {
  mockFind.mockResolvedValue(openSession())
  const res = await closeSession(1, undefined, fd({ countedCash: "95.00" }))
  expect(res?.error).toMatch(/variance/i)
  expect(mockUpdate).not.toHaveBeenCalled()
})

test("counted short + note → variance negative stored", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ countedCash: "95.00", notes: "coin lost" }))
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ countedCash: "95.00", closingVariance: "-5.00" }),
    })
  )
})

test("counted over + note → variance positive stored", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ countedCash: "103.50", notes: "extra float" }))
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ countedCash: "103.50", closingVariance: "3.50" }),
    })
  )
})

test("counted with >2dp rejected", async () => {
  mockFind.mockResolvedValue(openSession())
  const res = await closeSession(1, undefined, fd({ countedCash: "100.005" }))
  expect(res?.error).toBeTruthy()
  expect(mockUpdate).not.toHaveBeenCalled()
})

test("negative counted rejected", async () => {
  mockFind.mockResolvedValue(openSession())
  const res = await closeSession(1, undefined, fd({ countedCash: "-1.00" }))
  expect(res?.error).toBeTruthy()
  expect(mockUpdate).not.toHaveBeenCalled()
})

test("already-closed session rejected", async () => {
  mockFind.mockResolvedValue(openSession({ status: "CLOSED" }))
  const res = await closeSession(1, undefined, fd({}))
  expect(res).toEqual({ error: "Session already closed" })
})

test("closes via a conditional OPEN-only update", async () => {
  mockFind.mockResolvedValue(openSession())
  await closeSession(1, undefined, fd({ notes: "handover" }))
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 1, status: "OPEN" } })
  )
})

test("concurrent close losing the race is rejected without an audit", async () => {
  // Both closers read OPEN, but the conditional updateMany matches no row for
  // the loser — it must not overwrite the winner's audited close.
  mockFind.mockResolvedValue(openSession())
  mockUpdate.mockResolvedValue({ count: 0 })
  const res = await closeSession(1, undefined, fd({ notes: "handover" }))
  expect(res).toEqual({ error: "Session already closed" })
  expect(mockAudit).not.toHaveBeenCalled()
})
