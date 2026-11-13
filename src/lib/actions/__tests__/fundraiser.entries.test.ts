/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null), isDemoMode: jest.fn(() => false), DEMO_ERROR: "demo" }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}), logAuditTx: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/fundraiserCheckout", () => ({
  ...jest.requireActual("@/lib/fundraiserCheckout"),
  expireOpenFundraiserCheckouts: jest.fn(async () => 0),
}))

import { addEntry, updateEntryQuantity, deleteEntry, searchFundraiserFamilies } from "@/lib/actions/fundraiser"
import { expireOpenFundraiserCheckouts } from "@/lib/fundraiserCheckout"
import { generateUniqueBankRef } from "@/lib/fundraiserEntry"
import { auth } from "@/auth"
import { logAuditTx } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { revalidatePath } from "next/cache"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"

const prismaMock = {
  fundraiser: { findUnique: jest.fn() },
  family: { findUnique: jest.fn(), findMany: jest.fn() },
  fundraiserEntry: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  fundraiserPayment: { count: jest.fn() },
  checkoutSession: { count: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
}
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, k) => (prismaMock as Record<string | symbol, unknown>)[k] }),
}))

const p2002 = () => Object.assign(new Error("unique"), { code: "P2002" })

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "ADMIN" } })
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock))
  prismaMock.$queryRaw.mockResolvedValue([{ id: 11 }])
  prismaMock.fundraiser.findUnique.mockResolvedValue({ id: 3, eventId: 7, unitPrice: "12.50", refPrefix: "PK" })
  prismaMock.family.findUnique.mockResolvedValue({ id: 2 })
  prismaMock.fundraiserEntry.findMany.mockResolvedValue([])
  // Pre-check (family dup) and bankRef probe both default to "free".
  prismaMock.fundraiserEntry.findUnique.mockResolvedValue(null)
  prismaMock.fundraiserEntry.create.mockResolvedValue({ id: 11 })
})

describe("addEntry", () => {
  it("member entry snapshots the fundraiser unit price", async () => {
    expect(await addEntry(3, { familyId: 2, quantity: "4" })).toBeUndefined()
    const data = prismaMock.fundraiserEntry.create.mock.calls[0][0].data
    expect(data).toMatchObject({ fundraiserId: 3, familyId: 2, quantity: 4, unitPrice: "12.50", bankRef: "PK0001" })
    expect(data.publicToken).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(logAuditTx).toHaveBeenCalledWith(prismaMock, 5, "FUNDRAISER_ENTRY_ADD", "FundraiserEntry", 11, expect.any(Object))
    expect(revalidatePath).toHaveBeenCalledWith("/events/7/fundraiser")
    expect(revalidatePath).toHaveBeenCalledWith("/events")
  })

  it("rejects an entry whose total owed exceeds the cap (form error, no write)", async () => {
    prismaMock.fundraiser.findUnique.mockResolvedValue({ id: 3, eventId: 7, unitPrice: "500.00", refPrefix: "PK" })
    expect(await addEntry(3, { familyId: 2, quantity: "2001" })).toEqual({ error: "Total owed is too large (max $999,999.99 per entry)" })
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
    expect(await addEntry(3, { familyId: 2, quantity: "1999" })).toBeUndefined()
  })

  it("an audit write failure rolls the add back and returns AUDIT_FAILED_ERROR", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await addEntry(3, { familyId: 2, quantity: "1" })).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("an audit write failure on a quantity edit or delete returns AUDIT_FAILED_ERROR", async () => {
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue({
      id: 11, quantity: 4, unitPrice: "10.00", fundraiserId: 3, familyId: 2, fundraiser: { eventId: 7 }, payments: [],
    })
    prismaMock.fundraiserPayment.count.mockResolvedValue(0)
    prismaMock.checkoutSession.count.mockResolvedValue(0)
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await updateEntryQuantity(11, "5")).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(expireOpenFundraiserCheckouts).not.toHaveBeenCalled()
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await deleteEntry(11)).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("rejects an archived family", async () => {
    // Family row lock (FOR SHARE) inside the create tx sees it archived.
    prismaMock.$queryRaw.mockResolvedValue([{ archivedAt: new Date() }])
    expect(await addEntry(3, { familyId: 2, quantity: "1" })).toEqual({ error: "Family is archived" })
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })

  it("second add of the same family errors (pre-check)", async () => {
    prismaMock.fundraiserEntry.findUnique.mockImplementation(async (a: { where: Record<string, unknown> }) =>
      a.where.fundraiserId_familyId ? { id: 9 } : null,
    )
    expect(await addEntry(3, { familyId: 2, quantity: "1" })).toEqual({ error: "Already on this fundraiser" })
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })

  it("second add of the same family errors (race: P2002 on create)", async () => {
    let dupVisible = false
    prismaMock.fundraiserEntry.findUnique.mockImplementation(async (a: { where: Record<string, unknown> }) =>
      a.where.fundraiserId_familyId && dupVisible ? { id: 9 } : null,
    )
    prismaMock.fundraiserEntry.create.mockImplementation(async () => {
      dupVisible = true
      throw p2002()
    })
    expect(await addEntry(3, { familyId: 2, quantity: "1" })).toEqual({ error: "Already on this fundraiser" })
  })

  it("retries a bankRef collision and gives up after 5 attempts", async () => {
    prismaMock.fundraiserEntry.create.mockRejectedValue(p2002())
    const r = await addEntry(3, { outsideName: "Visitor", quantity: "1" })
    expect(r).toEqual({ error: "Busy, please try again" })
    expect(prismaMock.fundraiserEntry.create).toHaveBeenCalledTimes(5)
  })

  it("returns busy (no throw) when no free bank reference is found", async () => {
    // Every probed ref is taken.
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue({ id: 1 })
    expect(await addEntry(3, { outsideName: "Visitor", quantity: "1" })).toEqual({ error: "Busy, please try again" })
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })

  it("outside entry stores encrypted email/phone, never plaintext", async () => {
    expect(
      await addEntry(3, { outsideName: "Visitor", outsideEmail: "visitor@example.com", outsidePhone: "0400000000", quantity: "2" }),
    ).toBeUndefined()
    expect(encrypt).toHaveBeenCalledWith("visitor@example.com")
    expect(encrypt).toHaveBeenCalledWith("0400000000")
    const data = prismaMock.fundraiserEntry.create.mock.calls[0][0].data
    expect(data).toMatchObject({ outsideName: "Visitor", familyId: null, outsideEmail: "enc:visitor@example.com" })
    const plain = JSON.stringify(prismaMock.fundraiserEntry.create.mock.calls[0][0]).replace(/enc:[^"]*/g, "")
    expect(plain).not.toContain("visitor@example.com")
    expect(JSON.stringify((logAuditTx as jest.Mock).mock.calls)).not.toContain("visitor@example.com")
  })

  it("blank outside email accepted (stored null)", async () => {
    expect(await addEntry(3, { outsideName: "Visitor", outsideEmail: "  ", quantity: "1" })).toBeUndefined()
    const data = prismaMock.fundraiserEntry.create.mock.calls[0][0].data
    expect(data.outsideEmail).toBeNull()
    expect(encrypt).not.toHaveBeenCalled()
  })

  it("rejects an invalid outside email", async () => {
    expect((await addEntry(3, { outsideName: "Visitor", outsideEmail: "nope", quantity: "1" }))?.error).toBeTruthy()
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })

  it.each([
    [{ quantity: "1" }],
    [{ familyId: 2, outsideName: "Visitor", quantity: "1" }],
  ])("requires exactly one of familyId / outsideName: %j", async (input) => {
    expect((await addEntry(3, input))?.error).toBeTruthy()
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })

  it.each(["0", "00", "abc", "1.5", "-1", "12345", ""])("rejects quantity %p", async (quantity) => {
    expect((await addEntry(3, { familyId: 2, quantity }))?.error).toBeTruthy()
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })

  it("OFFICE_ADMIN allowed", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "OFFICE_ADMIN" } })
    expect(await addEntry(3, { familyId: 2, quantity: "1" })).toBeUndefined()
  })

  it.each(["AUDITOR", "VIEWER", "EVENT_ORGANISER"])("blocks %s", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role } })
    expect(await addEntry(3, { familyId: 2, quantity: "1" })).toEqual({ error: "Unauthorized" })
    expect(prismaMock.fundraiserEntry.create).not.toHaveBeenCalled()
  })
})

describe("generateUniqueBankRef", () => {
  it("uses max existing suffix + 1 for the prefix, skipping taken refs", async () => {
    prismaMock.fundraiserEntry.findMany.mockResolvedValue([{ bankRef: "PK0007" }, { bankRef: "PK0002" }, { bankRef: "PKX0099" }])
    prismaMock.fundraiserEntry.findUnique.mockResolvedValueOnce({ id: 1 }).mockResolvedValue(null)
    expect(await generateUniqueBankRef(prismaMock as never, "pk")).toBe("PK0009")
  })

  it("ignores refs of a longer prefix that merely start with this prefix (FR vs FR1)", async () => {
    prismaMock.fundraiserEntry.findMany.mockResolvedValue([{ bankRef: "FR0003" }, { bankRef: "FR10001" }])
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue(null)
    expect(await generateUniqueBankRef(prismaMock as never, "FR")).toBe("FR0004")
    prismaMock.fundraiserEntry.findMany.mockResolvedValue([{ bankRef: "FR10001" }, { bankRef: "FR0003" }])
    expect(await generateUniqueBankRef(prismaMock as never, "FR1")).toBe("FR10002")
  })

  it("keeps counting past 9999 (5+ digit suffixes) instead of sticking at FR10000", async () => {
    prismaMock.fundraiserEntry.findMany.mockResolvedValue([{ bankRef: "FR9999" }, { bankRef: "FR10000" }, { bankRef: "FR10001" }])
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue(null)
    expect(await generateUniqueBankRef(prismaMock as never, "FR")).toBe("FR10002")
  })

  it("default prefix starts at 1", async () => {
    expect(await generateUniqueBankRef(prismaMock as never, null)).toBe("FR0001")
  })
})

describe("updateEntryQuantity", () => {
  beforeEach(() => {
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue({
      id: 11, quantity: 4, unitPrice: "10.00", fundraiser: { eventId: 7 }, payments: [{ amount: "25.00" }],
    })
  })

  it("rejects a quantity whose total is below what is already paid", async () => {
    expect(await updateEntryQuantity(11, "2")).toEqual({ error: "Quantity total is below the amount already paid" })
    expect(prismaMock.fundraiserEntry.update).not.toHaveBeenCalled()
  })

  it("rejects a quantity whose total owed exceeds the cap", async () => {
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue({
      id: 11, quantity: 4, unitPrice: "500.00", fundraiser: { eventId: 7 }, payments: [],
    })
    expect(await updateEntryQuantity(11, "2001")).toEqual({ error: "Total owed is too large (max $999,999.99 per entry)" })
    expect(prismaMock.fundraiserEntry.update).not.toHaveBeenCalled()
  })

  it("updates when quantity covers paid; locks the row first", async () => {
    expect(await updateEntryQuantity(11, "3")).toBeUndefined()
    expect(prismaMock.$queryRaw).toHaveBeenCalled()
    expect(prismaMock.fundraiserEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11 }, data: { quantity: 3 } }))
    expect(logAuditTx).toHaveBeenCalledWith(prismaMock, 5, "FUNDRAISER_ENTRY_QUANTITY", "FundraiserEntry", 11, { from: 4, to: 3 })
  })

  it("expires open card checkouts staged for the old amount when quantity changes", async () => {
    expect(await updateEntryQuantity(11, "3")).toBeUndefined()
    expect(expireOpenFundraiserCheckouts).toHaveBeenCalledWith(11)
  })

  it("leaves open checkouts alone when quantity is unchanged or the update is rejected", async () => {
    expect(await updateEntryQuantity(11, "4")).toBeUndefined()
    expect(await updateEntryQuantity(11, "2")).toEqual({ error: "Quantity total is below the amount already paid" })
    expect(expireOpenFundraiserCheckouts).not.toHaveBeenCalled()
  })

  it("rejects bad quantity and missing entry", async () => {
    expect((await updateEntryQuantity(11, "0"))?.error).toBeTruthy()
    prismaMock.$queryRaw.mockResolvedValue([])
    expect(await updateEntryQuantity(11, "3")).toEqual({ error: "Entry not found" })
  })

  it("blocks VIEWER", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "VIEWER" } })
    expect(await updateEntryQuantity(11, "3")).toEqual({ error: "Unauthorized" })
  })
})

describe("deleteEntry", () => {
  beforeEach(() => {
    prismaMock.fundraiserEntry.findUnique.mockResolvedValue({ id: 11, fundraiser: { eventId: 7 } })
  })

  it("rejects when payments exist", async () => {
    prismaMock.fundraiserPayment.count.mockResolvedValue(1)
    expect(await deleteEntry(11)).toEqual({ error: "Cannot delete an entry that has payments" })
    expect(prismaMock.fundraiserEntry.delete).not.toHaveBeenCalled()
  })

  it("rejects while an OPEN checkout session exists for the entry", async () => {
    prismaMock.fundraiserPayment.count.mockResolvedValue(0)
    prismaMock.checkoutSession.count.mockResolvedValue(1)
    expect(await deleteEntry(11)).toEqual({ error: "Payment in progress" })
    expect(prismaMock.checkoutSession.count).toHaveBeenCalledWith({ where: { fundraiserEntryId: 11, status: "OPEN" } })
    expect(prismaMock.fundraiserEntry.delete).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("deletes and audits when no payments", async () => {
    prismaMock.fundraiserPayment.count.mockResolvedValue(0)
    prismaMock.checkoutSession.count.mockResolvedValue(0)
    expect(await deleteEntry(11)).toBeUndefined()
    expect(prismaMock.fundraiserEntry.delete).toHaveBeenCalledWith({ where: { id: 11 } })
    expect(logAuditTx).toHaveBeenCalledWith(prismaMock, 5, "FUNDRAISER_ENTRY_DELETE", "FundraiserEntry", 11, expect.any(Object))
  })

  it("blocks AUDITOR", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "AUDITOR" } })
    expect(await deleteEntry(11)).toEqual({ error: "Unauthorized" })
  })
})

describe("searchFundraiserFamilies", () => {
  it("searches live families by name, excludes ones already on the fundraiser, caps at 20", async () => {
    prismaMock.family.findMany.mockResolvedValue([{ id: 2, name: "Example Family" }])
    expect(await searchFundraiserFamilies(3, "  exam ")).toEqual({ families: [{ id: 2, name: "Example Family" }] })
    expect(prismaMock.family.findMany).toHaveBeenCalledWith({
      where: { archivedAt: null, name: { contains: "exam", mode: "insensitive" }, fundraiserEntries: { none: { fundraiserId: 3 } } },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 20,
    })
  })

  it("returns no results for a query under 2 characters, without a DB call", async () => {
    expect(await searchFundraiserFamilies(3, " e ")).toEqual({ families: [] })
    expect(prismaMock.family.findMany).not.toHaveBeenCalled()
  })

  it("refuses a role that cannot manage fundraisers", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "VIEWER" } })
    expect(await searchFundraiserFamilies(3, "exam")).toEqual({ error: "Unauthorized" })
    expect(prismaMock.family.findMany).not.toHaveBeenCalled()
  })

  it("rejects an invalid fundraiser id", async () => {
    expect(await searchFundraiserFamilies(0, "exam")).toEqual({ error: "Invalid fundraiser" })
  })
})
