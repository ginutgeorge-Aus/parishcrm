/** @jest-environment node */
import {
  createFamily,
  updateFamily,
  deleteFamily,
  archiveFamily,
  unarchiveFamily,
  previewMerge,
  mergeFamilies,
} from "@/lib/actions/family"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { isFeatureOn } from "@/lib/featureFlags"
import { logAudit } from "@/lib/audit"
import { reassignFundraiserEntriesTx, unlinkFundraiserEntriesTx } from "@/lib/fundraiserFamilyLink"
import { expireOpenFundraiserCheckouts } from "@/lib/fundraiserCheckout"
import { AuditWriteError, AUDIT_FAILED_ERROR } from "@/lib/auditGuard"

// Locks in the guards family.ts fixed by hand with no regression net: the
// canEdit/isAdmin role gates, the unique-constraint messaging (memberNo vs
// name), the archived-family write block, the optimistic-concurrency
// conflict, the delete safety rails (linked txns / cascade members
// / retention floor), archive/unarchive atomicity, and the
// merge conflict / cascade-relink handling (//P2002).

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ minDues: 80 }) }))
jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  logAuditTx: jest.fn().mockResolvedValue(undefined),
  logAuditManyTx: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/fundraiserFamilyLink", () => ({
  ...jest.requireActual("@/lib/fundraiserFamilyLink"),
  reassignFundraiserEntriesTx: jest.fn(),
  unlinkFundraiserEntriesTx: jest.fn(),
}))
jest.mock("@/lib/fundraiserCheckout", () => ({ expireOpenFundraiserCheckouts: jest.fn().mockResolvedValue(0) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("NEXT_REDIRECT")
  }),
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
}))
jest.mock("@/lib/retention", () => ({
  retentionFloor: jest.fn(() => new Date("2030-01-01T00:00:00.000Z")),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    person: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    transaction: { count: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    membershipApplication: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    familyUpdateSubmission: { count: jest.fn() },
    personClearance: { findMany: jest.fn().mockResolvedValue([]) },
    fundraiserEntry: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}))

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const VALID = { name: "Smith Family" }

// The family delete exists only on the transaction client; the global one
// throws, so a delete outside the transaction fails the test.
const familyDeleteTx = jest.fn()
// deleteFamily's eligibility counts likewise exist only on the tx client.
const personCountTx = jest.fn()
const txCountTx = jest.fn()
// mergeFamilies re-reads the source name under the row lock.
const familyNameTx = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  familyDeleteTx.mockResolvedValue({})
  familyNameTx.mockResolvedValue({ name: "Old" })
  ;(unlinkFundraiserEntriesTx as jest.Mock).mockResolvedValue(0)
  ;(reassignFundraiserEntriesTx as jest.Mock).mockResolvedValue({ moved: 0, folded: 0, unlinked: 0, foldedEntryIds: [] })
  ;(prisma.fundraiserEntry.findMany as jest.Mock).mockResolvedValue([])
  for (const m of [prisma.family.delete, prisma.person.count, prisma.transaction.count]) {
    ;(m as jest.Mock).mockImplementation(() => {
      throw new Error("called outside the transaction")
    })
  }
  // Default $transaction: run a callback against a tx proxy, or resolve an array.
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => unknown)({
        // deleteFamily's row locks: the family lock re-reads archivedAt, served
        // from the same findUnique mock the test primed.
        $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
          if (!sql.join("?").includes('FROM "Family"')) return []
          const row = await (prisma.family.findUnique as jest.Mock)()
          return row ? [{ archivedAt: row.archivedAt ?? null, name: row.name ?? "Smith Family" }] : []
        }),
        person: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), count: personCountTx },
        transaction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), count: txCountTx },
        membershipApplication: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        familyUpdateInvite: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        familyUpdateSubmission: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        family: {
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
          findUniqueOrThrow: familyNameTx,
          delete: familyDeleteTx,
        },
        personClearance: prisma.personClearance,
      })
    }
    return Promise.all(arg as unknown[])
  })
})

describe("createFamily", () => {
  it("rejects a non-editor role before any DB write", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const r = await createFamily(undefined, form(VALID))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.family.create).not.toHaveBeenCalled()
  })

  it("encrypts PII fields on write", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockResolvedValue({ id: 7 })
    await expect(
      createFamily(undefined, form({ ...VALID, address: "1 Church St" }))
    ).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.family.create as jest.Mock).mock.calls[0][0].data
    expect(data.address).toBe("enc:1 Church St")
  })

  it("writes no dues when the dues field is hidden (Subscription dues off), never auto-filling minDues", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockResolvedValue({ id: 7 })
    await expect(createFamily(undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
    expect((prisma.family.create as jest.Mock).mock.calls[0][0].data.monthlyDues).toBeNull()
  })

  it("ignores a submitted dues amount while Subscription dues is off (stale form) and writes no dues", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockResolvedValue({ id: 7 })
    ;(isFeatureOn as jest.Mock).mockResolvedValueOnce(false)
    await expect(createFamily(undefined, form({ ...VALID, monthlyDues: "500" }))).rejects.toThrow("NEXT_REDIRECT")
    expect(isFeatureOn).toHaveBeenCalledWith("dues")
    expect((prisma.family.create as jest.Mock).mock.calls[0][0].data.monthlyDues).toBeNull()
  })

  it("audits the dues actually written, not the absent form value", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockResolvedValue({ id: 7 })
    await expect(createFamily(undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
    expect(logAudit).toHaveBeenCalledWith(1, "FAMILY_CREATED", "Family", 7, { monthlyDues: null })
  })

  it("keeps a blank submitted dues field as no obligation", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockResolvedValue({ id: 7 })
    await expect(createFamily(undefined, form({ ...VALID, monthlyDues: "" }))).rejects.toThrow("NEXT_REDIRECT")
    expect((prisma.family.create as jest.Mock).mock.calls[0][0].data.monthlyDues).toBeNull()
  })

  it("maps a memberNo unique-constraint clash to a clear message", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`memberNo`)")
    )
    const r = await createFamily(undefined, form({ ...VALID, memberNo: "M1" }))
    expect(r).toEqual({ error: "Member number already in use" })
  })

  it("maps a name unique-constraint clash to a clear message", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.create as jest.Mock).mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`name`)")
    )
    const r = await createFamily(undefined, form(VALID))
    expect(r).toEqual({ error: "A family with this name already exists" })
  })
})

describe("updateFamily", () => {
  it("rejects a non-editor role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    const r = await updateFamily(3, undefined, form(VALID))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.family.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a missing family", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue(null)
    const r = await updateFamily(3, undefined, form(VALID))
    expect(r).toEqual({ error: "Not found" })
    expect(prisma.family.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a direct write to an archived family", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: new Date() })
    const r = await updateFamily(3, undefined, form(VALID))
    expect(r).toEqual({ error: "Not found" })
    expect(prisma.family.updateMany).not.toHaveBeenCalled()
  })

  describe("optimistic concurrency", () => {
    beforeEach(() => {
      ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
      ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    })

    it("returns a reload prompt when the guarded update matches 0 rows", async () => {
      ;(prisma.family.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
      const r = await updateFamily(3, undefined, form({ ...VALID, updatedAt: "2026-01-01T00:00:00.000Z" }))
      expect(r).toMatchObject({ error: expect.stringContaining("changed by someone else") })
    })

    it("scopes the update on the submitted updatedAt", async () => {
      ;(prisma.family.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
      await expect(
        updateFamily(3, undefined, form({ ...VALID, updatedAt: "2026-01-01T00:00:00.000Z" }))
      ).rejects.toThrow("NEXT_REDIRECT")
      const arg = (prisma.family.updateMany as jest.Mock).mock.calls[0][0]
      expect(arg.where).toEqual({ id: 3, updatedAt: new Date("2026-01-01T00:00:00.000Z") })
    })

    it("keeps stored dues when the dues field is absent (Subscription dues off)", async () => {
      ;(prisma.family.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
      await expect(updateFamily(3, undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
      const arg = (prisma.family.updateMany as jest.Mock).mock.calls[0][0]
      expect("monthlyDues" in arg.data).toBe(false)
    })

    it("keeps stored dues when a stale form submits an amount while Subscription dues is off", async () => {
      ;(prisma.family.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
      ;(isFeatureOn as jest.Mock).mockResolvedValueOnce(false)
      await expect(updateFamily(3, undefined, form({ ...VALID, monthlyDues: "500" }))).rejects.toThrow("NEXT_REDIRECT")
      expect(isFeatureOn).toHaveBeenCalledWith("dues")
      const arg = (prisma.family.updateMany as jest.Mock).mock.calls[0][0]
      expect("monthlyDues" in arg.data).toBe(false)
    })

    it("clears dues when the field is submitted blank", async () => {
      ;(prisma.family.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
      await expect(updateFamily(3, undefined, form({ ...VALID, monthlyDues: "" }))).rejects.toThrow("NEXT_REDIRECT")
      const arg = (prisma.family.updateMany as jest.Mock).mock.calls[0][0]
      expect(arg.data.monthlyDues).toBeNull()
    })

    it("falls back to an id-only update when no updatedAt is submitted", async () => {
      ;(prisma.family.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
      await expect(updateFamily(3, undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
      const arg = (prisma.family.updateMany as jest.Mock).mock.calls[0][0]
      expect(arg.where).toEqual({ id: 3 })
    })
  })
})

describe("deleteFamily", () => {
  it("requires ADMIN — a PASTOR (who may edit) cannot delete", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
    const r = await deleteFamily(3)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.family.findUnique).not.toHaveBeenCalled()
  })

  it("blocks deletion when transactions are linked, steering to archive", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    ;txCountTx.mockResolvedValue(2)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("2 transaction(s)") })
    expect(familyDeleteTx).not.toHaveBeenCalled()
  })

  it("blocks deletion when members exist and it is not past the retention floor", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(3)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("3 member(s)") })
    expect(familyDeleteTx).not.toHaveBeenCalled()
  })

  it("blocks a past-retention delete while any member is still active", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx
      .mockResolvedValueOnce(2) // memberCount
      .mockResolvedValueOnce(1) // activeMemberCount
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("1 active member(s)") })
    expect(familyDeleteTx).not.toHaveBeenCalled()
  })

  it("permanently deletes a past-retention family with only archived members", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx
      .mockResolvedValueOnce(2) // memberCount
      .mockResolvedValueOnce(0) // activeMemberCount
    await expect(deleteFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(familyDeleteTx).toHaveBeenCalledWith({ where: { id: 3 } })
  })

  it("unlinks fundraiser entries, keeping the family name, before a past-retention delete", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      name: "Kurian Family",
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(0)
    ;(unlinkFundraiserEntriesTx as jest.Mock).mockResolvedValue(2)
    await expect(deleteFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(unlinkFundraiserEntriesTx).toHaveBeenCalledWith(expect.anything(), 3, "Kurian Family", 1)
    expect(familyDeleteTx).toHaveBeenCalledWith({ where: { id: 3 } })
    // Unlink must run before the delete, or the Restrict FK fails it.
    expect((unlinkFundraiserEntriesTx as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(familyDeleteTx.mock.invocationCallOrder[0])
  })

  it("does not unlink fundraiser entries when the delete is refused", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(0)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("7 years") })
    expect(unlinkFundraiserEntriesTx).not.toHaveBeenCalled()
  })

  it("reports a failed fundraiser-unlink audit write as an audit failure, not a linked-records error", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: new Date("2020-01-01T00:00:00.000Z") })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(0)
    ;(unlinkFundraiserEntriesTx as jest.Mock).mockRejectedValue(new AuditWriteError(new Error("audit down")))
    expect(await deleteFamily(3)).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(familyDeleteTx).not.toHaveBeenCalled()
  })

  it("maps a P2034 write conflict to a retryable error, not a 500", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: new Date("2020-01-01T00:00:00.000Z") })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(0)
    familyDeleteTx.mockRejectedValue({ code: "P2034" })
    expect(await deleteFamily(3)).toEqual({ error: expect.stringContaining("try again") })
  })

  it("maps a P2003 FK failure on the delete to a friendly linked-records error, not a 500", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(0)
    familyDeleteTx.mockRejectedValue({ code: "P2003" })
    const r = await deleteFamily(3)
    expect(r).toEqual({ error: "Cannot delete — other records still reference this family. Archive it instead." })
  })

  it("blocks deleting a zero-member family that is not past the retention floor", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    // Never archived → not past retention; zero members.
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx.mockResolvedValue(0)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("7 years") })
    expect(familyDeleteTx).not.toHaveBeenCalled()
  })

  it("permanently deletes a zero-member family once past the retention floor", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;txCountTx.mockResolvedValue(0)
    ;personCountTx
      .mockResolvedValueOnce(0) // memberCount
      .mockResolvedValueOnce(0) // activeMemberCount
    await expect(deleteFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(familyDeleteTx).toHaveBeenCalledWith({ where: { id: 3 } })
  })
})

describe("archiveFamily / unarchiveFamily", () => {
  it("archiveFamily requires ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const r = await archiveFamily(3)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("archiveFamily archives the family and its members in one transaction", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    await expect(archiveFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.family.update).toHaveBeenCalled()
    expect(prisma.person.updateMany).toHaveBeenCalledWith({
      where: { familyId: 3 },
      data: { archivedAt: expect.any(Date) },
    })
  })

  it("archiveFamily locks the members in id order before updating them", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    await expect(archiveFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    const [sql, familyId] = (prisma.$queryRaw as jest.Mock).mock.calls[0]
    expect(sql.join("?")).toMatch(/FROM "Person" WHERE "familyId" = \? ORDER BY id FOR UPDATE/)
    expect(familyId).toBe(3)
    const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0] as unknown[]
    expect(ops).toHaveLength(3)
    expect((prisma.$queryRaw as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (prisma.person.updateMany as jest.Mock).mock.invocationCallOrder[0]
    )
  })

  it("unarchiveFamily requires ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const r = await unarchiveFamily(3)
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("unarchiveFamily clears archivedAt on the family and its members", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    await unarchiveFamily(3)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.person.updateMany).toHaveBeenCalledWith({
      where: { familyId: 3 },
      data: { archivedAt: null },
    })
  })

  // parity with updateFamily, which revalidates both the list and the
  // detail page — archive/unarchive were the odd ones out.
  it("archiveFamily revalidates the family detail page", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    await expect(archiveFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(revalidatePath).toHaveBeenCalledWith("/families/3")
  })

  it("unarchiveFamily revalidates the family detail page", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3 })
    await unarchiveFamily(3)
    expect(revalidatePath).toHaveBeenCalledWith("/families/3")
  })
})

describe("previewMerge / mergeFamilies", () => {
  const src = { id: 1, name: "Old", memberNo: "M1" }
  const tgt = { id: 2, name: "New", memberNo: "M2" }

  function stubPreview({
    sourcePeople = [] as { firstName: string; lastName: string }[],
    targetPeople = [] as { firstName: string; lastName: string }[],
    txCount = 0,
    pending = 0,
  } = {}) {
    ;(prisma.family.findUnique as jest.Mock)
      .mockResolvedValueOnce(src) // source
      .mockResolvedValueOnce(tgt) // target
    ;(prisma.person.findMany as jest.Mock)
      .mockResolvedValueOnce(sourcePeople)
      .mockResolvedValueOnce(targetPeople)
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(txCount)
    ;(prisma.familyUpdateSubmission.count as jest.Mock).mockResolvedValue(pending)
  }

  it("previewMerge requires ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const r = await previewMerge(1, 2)
    expect(r).toEqual({ error: "Unauthorized" })
  })

  it("previewMerge flags duplicate member names as conflicts", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview({
      sourcePeople: [{ firstName: "Jane", lastName: "Doe" }],
      targetPeople: [{ firstName: "Jane", lastName: "Doe" }],
    })
    const r = await previewMerge(1, 2)
    expect(r).toMatchObject({ conflicts: ["Jane Doe"] })
  })

  it("previewMerge flags a pending self-update submission", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview({ pending: 1 })
    const r = (await previewMerge(1, 2)) as { conflicts: string[] }
    expect(r.conflicts.some((c) => c.includes("pending self-update"))).toBe(true)
  })

  it("previewMerge counts the source's fundraiser entries and the ones that will stay separate", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(prisma.fundraiserEntry.findMany as jest.Mock).mockResolvedValue([
      { id: 10, fundraiserId: 5, familyId: 1, quantity: 1, unitPrice: "5.00" }, // moves
      { id: 11, fundraiserId: 6, familyId: 1, quantity: 1, unitPrice: "5.00" }, // price differs: separate
      { id: 20, fundraiserId: 6, familyId: 2, quantity: 1, unitPrice: "6.00" },
    ])
    const r = await previewMerge(1, 2)
    expect(r).toMatchObject({ fundraiserEntryCount: 2, fundraiserEntriesKeptSeparate: 1, conflicts: [] })
    expect(prisma.fundraiserEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: { in: [1, 2] } } }))
  })

  it("mergeFamilies re-homes the source's fundraiser entries before deleting it, and returns + audits the counts", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(reassignFundraiserEntriesTx as jest.Mock).mockResolvedValue({ moved: 1, folded: 1, unlinked: 1, foldedEntryIds: [20] })
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ success: true, fundraiser: { moved: 1, folded: 1, unlinked: 1 } })
    expect(reassignFundraiserEntriesTx).toHaveBeenCalledWith(expect.anything(), 1, 2, "Old", 1)
    expect((reassignFundraiserEntriesTx as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(familyDeleteTx.mock.invocationCallOrder[0])
    expect(logAudit).toHaveBeenCalledWith(1, "FAMILY_MERGED", "Family", 2, {
      sourceId: 1, sourceName: "Old", fundraiserEntries: { moved: 1, folded: 1, unlinked: 1 },
    })
  })

  it("mergeFamilies expires open card checkouts on every folded-into entry, after commit", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(reassignFundraiserEntriesTx as jest.Mock).mockResolvedValue({ moved: 0, folded: 2, unlinked: 0, foldedEntryIds: [20, 21] })
    await mergeFamilies(1, 2)
    expect(expireOpenFundraiserCheckouts).toHaveBeenCalledTimes(2)
    expect(expireOpenFundraiserCheckouts).toHaveBeenCalledWith(20)
    expect(expireOpenFundraiserCheckouts).toHaveBeenCalledWith(21)
    expect((expireOpenFundraiserCheckouts as jest.Mock).mock.invocationCallOrder[0])
      .toBeGreaterThan(familyDeleteTx.mock.invocationCallOrder[0])
  })

  it("mergeFamilies does not expire checkouts when nothing was folded", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    await mergeFamilies(1, 2)
    expect(expireOpenFundraiserCheckouts).not.toHaveBeenCalled()
  })

  it("mergeFamilies reports a failed audit write as an audit failure, not a linked-records P2003", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(reassignFundraiserEntriesTx as jest.Mock).mockRejectedValue(new AuditWriteError(Object.assign(new Error("fk"), { code: "P2003" })))
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(familyDeleteTx).not.toHaveBeenCalled()
    expect(expireOpenFundraiserCheckouts).not.toHaveBeenCalled()
  })

  it("mergeFamilies keeps the source name read under the row lock, not the preview's (renamed meanwhile)", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    familyNameTx.mockResolvedValue({ name: "Renamed" })
    await mergeFamilies(1, 2)
    expect(familyNameTx).toHaveBeenCalledWith({ where: { id: 1 }, select: { name: true } })
    expect(reassignFundraiserEntriesTx).toHaveBeenCalledWith(expect.anything(), 1, 2, "Renamed", 1)
    expect(logAudit).toHaveBeenCalledWith(1, "FAMILY_MERGED", "Family", 2, expect.objectContaining({ sourceName: "Renamed" }))
  })

  it("mergeFamilies maps a P2034 write conflict to a retryable error, not a 500", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: "P2034" })
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ error: expect.stringContaining("try again") })
    expect(expireOpenFundraiserCheckouts).not.toHaveBeenCalled()
  })

  it("mergeFamilies maps a P2003 FK failure to a friendly error", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: "P2003" })
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ error: "Merge failed — other records still reference the source family. Please re-run preview." })
  })

  it("mergeFamilies rejects merging a family into itself", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    const r = await mergeFamilies(1, 1)
    expect(r).toMatchObject({ error: expect.stringContaining("must be different") })
  })

  it("mergeFamilies returns conflicts and does not delete when preview is dirty", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview({
      sourcePeople: [{ firstName: "Jane", lastName: "Doe" }],
      targetPeople: [{ firstName: "Jane", lastName: "Doe" }],
    })
    const r = await mergeFamilies(1, 2)
    expect(r).toMatchObject({ conflicts: ["Jane Doe"] })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("mergeFamilies relinks people/txns/applications and deletes the source on a clean merge", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ success: true, fundraiser: { moved: 0, folded: 0, unlinked: 0 } })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  // a tab open on the target (or source) family detail page otherwise
  // keeps showing stale pre-merge members/giving.
  it("mergeFamilies revalidates both the target and source family detail pages", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    await mergeFamilies(1, 2)
    expect(revalidatePath).toHaveBeenCalledWith("/families/2")
    expect(revalidatePath).toHaveBeenCalledWith("/families/1")
  })

  it("previewMerge refuses when either family is archived", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock)
      .mockResolvedValueOnce({ ...src, archivedAt: new Date() })
      .mockResolvedValueOnce({ ...tgt, archivedAt: null })
    const r = await previewMerge(1, 2)
    expect(r).toMatchObject({ error: expect.stringContaining("unarchive first") })
  })

  it("mergeFamilies aborts without deleting when a family is archived after preview", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    const del = jest.fn()
    ;(prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        family: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), delete: del },
        person: { updateMany: jest.fn() },
      })
    )
    const r = await mergeFamilies(1, 2)
    expect(r).toMatchObject({ error: expect.stringContaining("unarchive first") })
    expect(del).not.toHaveBeenCalled()
  })

  it("mergeFamilies converts a P2002 race into a re-run-preview conflict", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce({ code: "P2002" })
    const r = (await mergeFamilies(1, 2)) as { conflicts: string[] }
    expect(r.conflicts[0]).toContain("duplicate person name")
  })

  it("previewMerge scans people WITHOUT the archivedAt filter so archived name collisions are caught", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    await previewMerge(1, 2)
    const wheres = (prisma.person.findMany as jest.Mock).mock.calls.map((c) => c[0].where)
    expect(wheres).toEqual([{ familyId: 1 }, { familyId: 2 }])
    // No archivedAt key — the non-partial unique blocks archived collisions too.
    for (const w of wheres) expect(w).not.toHaveProperty("archivedAt")
  })

  it("mergeFamilies reparents FamilyUpdateInvite + submission history to the target before deleting source", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    stubPreview()
    const inviteUpdate = jest.fn().mockResolvedValue({ count: 1 })
    const submissionUpdate = jest.fn().mockResolvedValue({ count: 2 })
    const familyDelete = jest.fn().mockResolvedValue({})
    ;(prisma.$transaction as jest.Mock).mockImplementationOnce(async (arg: unknown) =>
      (arg as (tx: unknown) => unknown)({
        person: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        transaction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        membershipApplication: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        familyUpdateInvite: { updateMany: inviteUpdate },
        familyUpdateSubmission: { updateMany: submissionUpdate },
        family: { updateMany: jest.fn().mockResolvedValue({ count: 2 }), findUniqueOrThrow: familyNameTx, delete: familyDelete },
      })
    )
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ success: true, fundraiser: { moved: 0, folded: 0, unlinked: 0 } })
    expect(inviteUpdate).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(submissionUpdate).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(familyDelete).toHaveBeenCalledWith({ where: { id: 1 } })
  })
})
