/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null), isDemoMode: jest.fn(() => false) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    personClearance: { findMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { revalidatePath } from "next/cache"
import { verifyClearancesBulk } from "@/lib/actions/clearance"

const mockAuth = auth as jest.Mock
const findMany = prisma.personClearance.findMany as jest.Mock
const updateMany = prisma.personClearance.updateMany as jest.Mock
const transaction = prisma.$transaction as jest.Mock

const T = "2026-09-30T01:02:03.000Z"
const it1 = (id: string) => ({ id, seenUpdatedAt: T })
const found = [
  { id: "c11", personId: 1, type: "WWCC", number: "enc:x" },
  { id: "c12", personId: 2, type: "WWCC", number: "enc:y" },
]

describe("verifyClearancesBulk", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "7" } })
    findMany.mockResolvedValue(found)
    updateMany.mockResolvedValue({ count: 2 })
    transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({ personClearance: { updateMany } }))
  })

  it("is blocked in demo mode before anything else", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "demo" })
    expect(await verifyClearancesBulk([it1("c11")])).toEqual({ error: "demo" })
    expect(mockAuth).not.toHaveBeenCalled()
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    expect(await verifyClearancesBulk([it1("c11")])).toEqual({ error: "Unauthorized" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)
    expect(await verifyClearancesBulk([it1("c11")])).toEqual({ error: "Unauthorized" })
  })

  it("rejects an empty selection, a non-id and an oversize selection", async () => {
    expect(await verifyClearancesBulk([])).toEqual({ error: "Select at least one clearance" })
    expect(await verifyClearancesBulk([it1("c11"), it1("")])).toEqual({ error: "Invalid selection" })
    expect(await verifyClearancesBulk([it1("c11"), { id: 5 as unknown as string, seenUpdatedAt: T }])).toEqual({ error: "Invalid selection" })
    const many = Array.from({ length: 201 }, (_, i) => it1(`c${i}`))
    expect(await verifyClearancesBulk(many)).toEqual({ error: "Select at most 200 clearances at a time" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects ids that are not cuid-shaped (spaces, operators, punctuation)", async () => {
    for (const bad of ["c 11", "c11'; --", "{\"$ne\":1}", "a/b", "x".repeat(65)]) {
      expect(await verifyClearancesBulk([it1(bad)])).toEqual({ error: "Invalid selection" })
    }
    expect(findMany).not.toHaveBeenCalled()
  })

  it("writes one audit entry per clearance concurrently (all started before any resolves)", async () => {
    const resolvers: (() => void)[] = []
    ;(logAudit as jest.Mock).mockImplementation(() => new Promise<void>((r) => resolvers.push(r)))
    const pending = verifyClearancesBulk([it1("c11"), it1("c12")])
    await new Promise((r) => setTimeout(r, 0))
    expect(logAudit).toHaveBeenCalledTimes(2)
    resolvers.forEach((r) => r())
    expect(await pending).toEqual({ success: "Marked 2 clearance(s) verified" })
    ;(logAudit as jest.Mock).mockResolvedValue(undefined)
  })

  it("rejects a note over 500 characters", async () => {
    expect(await verifyClearancesBulk([it1("c11")], "x".repeat(501))).toEqual({ error: "Note is too long (max 500 characters)" })
  })

  it("fails the whole batch when an id no longer exists (IDOR / stale selection)", async () => {
    findMany.mockResolvedValue([found[0]])
    expect(await verifyClearancesBulk([it1("c11"), it1("c12")])).toEqual({ error: "Some selected clearances no longer exist" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("refuses WWCC rows that have no number", async () => {
    findMany.mockResolvedValue([found[0], { ...found[1], number: null }])
    expect(await verifyClearancesBulk([it1("c11"), it1("c12")])).toEqual({
      error: "1 selected WWCC record(s) have no WWC number — add it before verifying",
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("refuses non-WWCC clearances (e.g. Safe Ministry) without writing", async () => {
    findMany.mockResolvedValue([found[0], { ...found[1], type: "SAFE_MINISTRY" }])
    expect(await verifyClearancesBulk([it1("c11"), it1("c12")])).toEqual({ error: "Only WWCC clearances can be verified in bulk" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("verifies the de-duplicated set with actor, time and trimmed note, audits each, revalidates", async () => {
    const res = await verifyClearancesBulk([it1("c11"), it1("c12"), it1("c11")], "  OCG: current  ")
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["c11", "c12"] }, person: { archivedAt: null } },
      select: { id: true, personId: true, type: true, number: true },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "c11", updatedAt: new Date(T) }, { id: "c12", updatedAt: new Date(T) }],
        verifiedAt: null,
        type: "WWCC",
        person: { archivedAt: null },
      },
      data: { verifiedAt: expect.any(Date), verifiedById: 7, verificationNote: "enc:OCG: current" },
    })
    expect(logAudit).toHaveBeenCalledTimes(2)
    expect(logAudit).toHaveBeenCalledWith(7, "CLEARANCE_VERIFIED", "Person", 1, { clearanceId: "c11", type: "WWCC", bulk: true, hasNote: true })
    expect(revalidatePath).toHaveBeenCalledWith("/people/clearances")
    expect(revalidatePath).toHaveBeenCalledWith("/people/1")
    expect(res).toEqual({ success: "Marked 2 clearance(s) verified" })
  })

  it("stores a blank note as null", async () => {
    findMany.mockResolvedValue([found[0]])
    updateMany.mockResolvedValue({ count: 1 })
    await verifyClearancesBulk([it1("c11")], "   ")
    expect(updateMany.mock.calls[0][0].data.verificationNote).toBeNull()
  })

  it("fails whole batch and audits nothing when a row was verified since load", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    expect(await verifyClearancesBulk([it1("c11"), it1("c12")])).toEqual({
      error: "This clearance changed. Refresh and try again.",
    })
    expect(logAudit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects a missing or malformed seenUpdatedAt without writing", async () => {
    expect(await verifyClearancesBulk([{ id: "c11", seenUpdatedAt: "" }])).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(await verifyClearancesBulk([{ id: "c11", seenUpdatedAt: "nope" }])).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("fails with a stale error and writes nothing when a row was edited since load", async () => {
    updateMany.mockResolvedValue({ count: 1 }) // the edited row no longer matches its seen updatedAt
    expect(await verifyClearancesBulk([it1("c11"), it1("c12")])).toEqual({ error: "This clearance changed. Refresh and try again." })
    expect(logAudit).not.toHaveBeenCalled()
  })
})
