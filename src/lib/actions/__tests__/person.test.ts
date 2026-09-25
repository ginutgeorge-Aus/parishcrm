/** @jest-environment node */
import { createPerson, updatePerson, deletePerson } from "@/lib/actions/person"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { revalidatePath } from "next/cache"

// Locks in the guards person.ts fixed by hand with no regression net: the
// canEdit/isAdmin role gates, the family-scope IDOR checks, the
// archived-record rejection, the optimistic-concurrency conflict
//, and the pastoral-notes role strip.

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v.trim()}`),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    person: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    transaction: { count: jest.fn() },
    dgrReceipt: { count: jest.fn() },
    pettyCashReceipt: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}))

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const VALID = { firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" }

beforeEach(() => {
  jest.clearAllMocks()
  // deletePerson's linked-record guard — default to no linked
  // records so existing delete tests that don't care about the guard pass.
  // Guard's count+delete run inside a Serializable $transaction, so
  // run the callback against the same prisma mock (tx === prisma here).
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.dgrReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma))
})

describe("createPerson", () => {
  it("rejects a non-editor role before any DB read", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const r = await createPerson(5, undefined, form(VALID))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.family.findUnique).not.toHaveBeenCalled()
    expect(prisma.person.create).not.toHaveBeenCalled()
  })

  it("rejects a missing family (stale bound id)", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue(null)
    const r = await createPerson(5, undefined, form(VALID))
    expect(r).toEqual({ error: "Family not found" })
    expect(prisma.person.create).not.toHaveBeenCalled()
  })

  it("rejects an archived family", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 5, archivedAt: new Date() })
    const r = await createPerson(5, undefined, form(VALID))
    expect(r).toEqual({ error: "Family not found" })
    expect(prisma.person.create).not.toHaveBeenCalled()
  })

  it("returns a friendly error on a duplicate-name P2002 instead of throwing", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 5, archivedAt: null })
    ;(prisma.person.create as jest.Mock).mockRejectedValue({ code: "P2002" })
    const r = await createPerson(5, undefined, form(VALID))
    expect(r).toMatchObject({ error: expect.stringContaining("already exists in this family") })
  })
})

describe("updatePerson — role & scope guards", () => {
  it("rejects a non-editor role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    const r = await updatePerson(3, 5, undefined, form(VALID))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.person.findUnique).not.toHaveBeenCalled()
  })

  it("rejects when the person's familyId does not match the bound familyId (IDOR)", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 99, archivedAt: null })
    const r = await updatePerson(3, 5, undefined, form(VALID))
    expect(r).toEqual({ error: "Not found" })
    expect(prisma.person.updateMany).not.toHaveBeenCalled()
  })

  it("rejects editing a soft-archived person", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: new Date() })
    const r = await updatePerson(3, 5, undefined, form(VALID))
    expect(r).toEqual({ error: "Not found" })
    expect(prisma.person.updateMany).not.toHaveBeenCalled()
  })

  it("returns a friendly error on a duplicate-name P2002 instead of throwing", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: null })
    ;(prisma.person.updateMany as jest.Mock).mockRejectedValue({ code: "P2002" })
    const r = await updatePerson(3, 5, undefined, form(VALID))
    expect(r).toMatchObject({ error: expect.stringContaining("already exists in this family") })
  })

  // createPerson and deletePerson both revalidate the family detail
  // page — updatePerson was the odd one out.
  it("revalidates the family detail page on success", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: null })
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(updatePerson(3, 5, undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
    expect(revalidatePath).toHaveBeenCalledWith("/families/5")
  })
})

describe("updatePerson — optimistic concurrency", () => {
  beforeEach(() => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: null })
  })

  it("returns a reload prompt when the guarded update matches 0 rows", async () => {
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    const r = await updatePerson(3, 5, undefined, form({ ...VALID, updatedAt: "2026-01-01T00:00:00.000Z" }))
    expect(r).toMatchObject({ error: expect.stringContaining("changed by someone else") })
  })

  it("scopes the update on the submitted updatedAt", async () => {
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(
      updatePerson(3, 5, undefined, form({ ...VALID, updatedAt: "2026-01-01T00:00:00.000Z" }))
    ).rejects.toThrow("NEXT_REDIRECT")
    const arg = (prisma.person.updateMany as jest.Mock).mock.calls[0][0]
    expect(arg.where).toEqual({ id: 3, updatedAt: new Date("2026-01-01T00:00:00.000Z") })
  })

  it("falls back to an id-only update when no updatedAt is submitted", async () => {
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(updatePerson(3, 5, undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
    const arg = (prisma.person.updateMany as jest.Mock).mock.calls[0][0]
    expect(arg.where).toEqual({ id: 3 })
  })
})

describe("updatePerson — pastoral-notes role strip", () => {
  it("drops pastoralNotes / emergency-contact from an OFFICE_ADMIN write", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: null })
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(
      updatePerson(3, 5, undefined, form({ ...VALID, pastoralNotes: "secret", emergencyContactName: "Jane" }))
    ).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.person.updateMany as jest.Mock).mock.calls[0][0].data
    expect(data).not.toHaveProperty("pastoralNotes")
    expect(data).not.toHaveProperty("emergencyContactName")
  })

  it("keeps pastoralNotes (encrypted) for a PASTOR write", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: null })
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    await expect(
      updatePerson(3, 5, undefined, form({ ...VALID, pastoralNotes: "care history" }))
    ).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.person.updateMany as jest.Mock).mock.calls[0][0].data
    expect(data.pastoralNotes).toBe("enc:care history")
  })
})

describe("deletePerson", () => {
  it("requires ADMIN — a PASTOR (who may edit) cannot delete", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
    const r = await deletePerson(3, 5)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.person.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a familyId mismatch (IDOR) without deleting", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 99 })
    const r = await deletePerson(3, 5)
    expect(r).toEqual({ error: "Person not found" })
    expect(prisma.person.delete).not.toHaveBeenCalled()
  })

  // Transaction.personId / PettyCashReceipt.personId / DgrReceipt.personId
  // are all SetNull on delete — a hard delete would silently sever donor links
  // on tax-deductible giving/receipt records. Mirror deleteFamily's guard.
  it("blocks deletion when linked giving/receipt records exist", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5 })
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(1)
    const r = await deletePerson(3, 5)
    expect(r).toMatchObject({ error: expect.stringContaining("Cannot delete") })
    expect(prisma.person.delete).not.toHaveBeenCalled()
  })

  it("surfaces the friendly error when the Serializable tx aborts on a concurrent write (P2034)", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5 })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue({ code: "P2034" })
    const r = await deletePerson(3, 5)
    expect(r).toMatchObject({ error: expect.stringContaining("Cannot delete") })
    expect(prisma.person.delete).not.toHaveBeenCalled()
  })

  it("allows deletion when no linked records exist", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5 })
    ;(prisma.person.delete as jest.Mock).mockResolvedValue({})
    await expect(deletePerson(3, 5)).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.person.delete).toHaveBeenCalledWith({ where: { id: 3 } })
  })
})
