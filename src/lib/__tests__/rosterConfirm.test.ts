/** @jest-environment node */
jest.mock("@/lib/prisma", () => {
  const m = {
    rosterAssignment: { findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))

import { prisma } from "@/lib/prisma"
import { logAuditTx as logAuditTxFn } from "@/lib/audit"
import { issueRosterToken } from "@/lib/rosterToken"
import { rosterSecret, previewRosterResponse, applyRosterResponse } from "@/lib/rosterConfirm"
import { __resetRateLimit } from "@/lib/rateLimit"

const findUnique = (prisma as unknown as { rosterAssignment: { findUnique: jest.Mock } }).rosterAssignment.findUnique
const updateMany = (prisma as unknown as { rosterAssignment: { updateMany: jest.Mock } }).rosterAssignment.updateMany
const logAuditTx = logAuditTxFn as jest.Mock
const tx = prisma

const C = { ip: "1.1.1.1", key: "1.1.1.1" }
const NOW = Date.UTC(2026, 10, 1)
const FUTURE = new Date(NOW + 86_400_000)
const tok = (action: "confirm" | "decline", id = "7", ttl = 60_000) =>
  issueRosterToken(id, action, rosterSecret(), NOW, ttl)

const row = (over: Record<string, unknown> = {}) => ({
  id: 7,
  status: "PENDING",
  person: { archivedAt: null },
  slot: { role: { name: "Reader" }, service: { title: "Sunday Divine Liturgy", date: FUTURE, endsAt: FUTURE } },
  ...over,
})

beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret-0123456789abcdef0123456789"
  jest.clearAllMocks()
  __resetRateLimit()
  updateMany.mockResolvedValue({ count: 1 })
})

describe("previewRosterResponse", () => {
  it("returns only role, service and date for a valid token", async () => {
    findUnique.mockResolvedValue(row())
    const r = await previewRosterResponse(tok("confirm"), C, NOW)
    expect(r).toEqual({ ok: true, action: "confirm", role: "Reader", title: "Sunday Divine Liturgy", date: FUTURE, status: "PENDING" })
    expect(JSON.stringify(r)).not.toMatch(/person/)
  })

  it("rejects bad, expired and unknown tokens", async () => {
    expect((await previewRosterResponse("garbage", C, NOW)).ok).toBe(false)
    expect((await previewRosterResponse(tok("confirm"), C, NOW + 120_000)).ok).toBe(false)
    findUnique.mockResolvedValue(null)
    expect((await previewRosterResponse(tok("confirm"), C, NOW)).ok).toBe(false)
  })

  it("rejects non-numeric assignment ids without a DB read", async () => {
    expect((await previewRosterResponse(tok("confirm", "abc"), C, NOW)).ok).toBe(false)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it("rejects archived people and finished services", async () => {
    findUnique.mockResolvedValueOnce(row({ person: { archivedAt: new Date() } }))
    expect((await previewRosterResponse(tok("confirm"), C, NOW)).ok).toBe(false)
    const past = new Date(NOW - 1000)
    findUnique.mockResolvedValueOnce(row({ slot: { role: { name: "R" }, service: { title: "T", date: past, endsAt: past } } }))
    expect((await previewRosterResponse(tok("confirm"), C, NOW)).ok).toBe(false)
  })

  it("rate limits repeated failures per client", async () => {
    let last
    for (let i = 0; i < 31; i++) last = await previewRosterResponse("garbage", { ip: "9.9.9.9", key: "9.9.9.9" }, NOW)
    expect(last).toEqual({ ok: false, limited: true })
  })
})

describe("public path", () => {
  it("exposes only the token page", async () => {
    const { isPublicPath } = await import("@/lib/csp")
    expect(isPublicPath("/roster/respond/abc.def")).toBe(true)
    expect(isPublicPath("/roster/respond/abc")).toBe(false)
    expect(isPublicPath("/roster/respond")).toBe(false)
    expect(isPublicPath("/roster")).toBe(false)
  })
})

describe("applyRosterResponse", () => {
  it("confirms, stamps respondedAt and writes a null-actor audit row", async () => {
    findUnique.mockResolvedValue(row())
    const r = await applyRosterResponse(tok("confirm"), C, NOW)
    expect(r).toEqual({ ok: true, action: "confirm", changed: true })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: { not: "CONFIRMED" } },
      data: { status: "CONFIRMED", respondedAt: new Date(NOW) },
    })
    expect(logAuditTx).toHaveBeenCalledWith(tx, null, "ROSTER_ASSIGNMENT_CONFIRMED", "RosterAssignment", 7, { via: "token" }, "1.1.1.1")
  })

  it("declines", async () => {
    findUnique.mockResolvedValue(row())
    const r = await applyRosterResponse(tok("decline"), C, NOW)
    expect(r).toEqual({ ok: true, action: "decline", changed: true })
    expect(logAuditTx).toHaveBeenCalledWith(tx, null, "ROSTER_ASSIGNMENT_DECLINED", "RosterAssignment", 7, { via: "token" }, "1.1.1.1")
  })

  it("is idempotent: a repeat tap changes nothing and writes no audit row", async () => {
    findUnique.mockResolvedValue(row({ status: "CONFIRMED" }))
    updateMany.mockResolvedValue({ count: 0 })
    const r = await applyRosterResponse(tok("confirm"), C, NOW)
    expect(r).toEqual({ ok: true, action: "confirm", changed: false })
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("never writes for an invalid token", async () => {
    const r = await applyRosterResponse("garbage", C, NOW)
    expect(r.ok).toBe(false)
    expect(updateMany).not.toHaveBeenCalled()
  })
})
