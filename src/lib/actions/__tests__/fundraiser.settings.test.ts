/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null), isDemoMode: jest.fn(() => false), DEMO_ERROR: "demo" }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}), logAuditTx: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))

import { saveFundraiser } from "@/lib/actions/fundraiser"
import { getFundraiserView } from "@/lib/fundraiserQueries"
import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"

const prismaMock = {
  event: { findUnique: jest.fn() },
  fundraiser: { upsert: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
}
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, k) => (prismaMock as Record<string | symbol, unknown>)[k] }),
}))

const input = { name: "Packets", unitLabel: "packet", unitPrice: "12.50", refPrefix: "pk" }

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "ADMIN" } })
  prismaMock.event.findUnique.mockResolvedValue({ id: 7 })
  prismaMock.fundraiser.upsert.mockResolvedValue({ id: 3 })
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock))
})

describe("saveFundraiser", () => {
  it("rejects no session", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect(await saveFundraiser(7, input)).toEqual({ error: "Unauthorized" })
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("blocks %s", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role } })
    expect(await saveFundraiser(7, input)).toEqual({ error: "Unauthorized" })
    expect(prismaMock.fundraiser.upsert).not.toHaveBeenCalled()
  })

  it.each(["abc", "0", "0.00", "1.234", "-1", ""])("rejects unitPrice %p", async (unitPrice) => {
    const r = await saveFundraiser(7, { ...input, unitPrice })
    expect(r?.error).toBeTruthy()
    expect(prismaMock.fundraiser.upsert).not.toHaveBeenCalled()
  })

  it.each(["1000000.00", "99999999999999999999.99"])("rejects an oversized unitPrice %p with a form error", async (unitPrice) => {
    expect(await saveFundraiser(7, { ...input, unitPrice })).toEqual({ error: "Unit price is too large (max $999,999.99)" })
    expect(prismaMock.fundraiser.upsert).not.toHaveBeenCalled()
  })

  it("accepts the maximum unitPrice", async () => {
    expect(await saveFundraiser(7, { ...input, unitPrice: "999999.99" })).toBeUndefined()
  })

  it("rejects blank name", async () => {
    expect((await saveFundraiser(7, { ...input, name: "  " }))?.error).toBeTruthy()
  })

  it("rejects missing event", async () => {
    prismaMock.event.findUnique.mockResolvedValue(null)
    expect(await saveFundraiser(7, input)).toEqual({ error: "Event not found" })
  })

  it("an audit write failure rolls the save back and returns AUDIT_FAILED_ERROR", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await saveFundraiser(7, input)).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("upserts on eventId and audits", async () => {
    expect(await saveFundraiser(7, input)).toBeUndefined()
    const arg = prismaMock.fundraiser.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ eventId: 7 })
    expect(arg.create).toMatchObject({ eventId: 7, name: "Packets", unitLabel: "packet", unitPrice: "12.50", refPrefix: "PK" })
    expect(revalidatePath).toHaveBeenCalledWith("/events/7/fundraiser")
    expect(revalidatePath).toHaveBeenCalledWith("/events")
    expect(logAuditTx).toHaveBeenCalledWith(prismaMock, 5, "FUNDRAISER_SAVE", "Fundraiser", 3, expect.any(Object))
  })
})

describe("getFundraiserView", () => {
  const fundraiser = {
    id: 3, eventId: 7, name: "Packets", unitLabel: "packet", unitPrice: "10.00", refPrefix: null,
    entries: [
      {
        id: 1, familyId: 2, family: { name: "Smith", people: [{ email: "enc:SECRET-P", emailConsent: true }] }, outsideName: null,
        outsideEmail: "enc:SECRET-EMAIL", outsidePhone: "enc:SECRET-PHONE",
        quantity: 2, unitPrice: "10.00", bankRef: "FR0001", publicToken: "tok-secret",
        payments: [{ id: 41, amount: "5.00", method: "CASH", paidAt: new Date("2026-11-01T00:00:00Z"), note: null }],
      },
      {
        id: 2, familyId: null, family: null, outsideName: "Visitor",
        outsideEmail: "enc:SECRET-EMAIL2", outsidePhone: null,
        quantity: 1, unitPrice: "10.00", bankRef: "FR0002", publicToken: "tok2",
        payments: [],
      },
    ],
  }
  beforeEach(() => prismaMock.fundraiser.findUnique.mockResolvedValue(fundraiser))

  it("returns null fundraiser when none", async () => {
    prismaMock.fundraiser.findUnique.mockResolvedValue(null)
    expect(await getFundraiserView(7, "ADMIN" as never)).toBeNull()
  })

  it("returns null for roles without view", async () => {
    expect(await getFundraiserView(7, "VIEWER" as never)).toBeNull()
  })

  it("ADMIN gets rows and totals; no encrypted values leak", async () => {
    const v = await getFundraiserView(7, "ADMIN" as never)
    expect(v!.rows).toHaveLength(2)
    expect(v!.rows[0]).toMatchObject({ name: "Smith", remainingCents: 1500, status: "PART" })
    expect(v!.rows[1]).toMatchObject({ name: "Visitor" })
    expect(v!.totals).toEqual({ expectedCents: 3000, collectedCents: 500, outstandingCents: 2500 })
    // Payments come from the same query, keyed by entry (no second payments query).
    expect(v!.payments).toEqual({ 1: [{ id: 41, amountCents: 500, method: "CASH", paidAt: "2026-11-01", note: null }] })
    const s = JSON.stringify(v)
    expect(s).not.toContain("SECRET")
    // The pay-link token is a bearer secret: neither its value nor its key may leak.
    expect(s).not.toContain("tok-secret")
    expect(s).not.toContain("publicToken")
    expect(s).not.toContain("outsideEmail")
    expect(s).not.toContain("outsidePhone")
  })

  it("AUDITOR gets totals and empty rows", async () => {
    const v = await getFundraiserView(7, "AUDITOR" as never)
    expect(v!.rows).toEqual([])
    expect(v!.payments).toEqual({})
    expect(v!.totals.expectedCents).toBe(3000)
    expect(JSON.stringify(v)).not.toContain("SECRET")
  })
})
