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

// Locks in the guards family.ts fixed by hand with no regression net: the
// canEdit/isAdmin role gates, the unique-constraint messaging (memberNo vs
// name), the archived-family write block, the optimistic-concurrency
// conflict, the delete safety rails (linked txns / cascade members
// / retention floor), archive/unarchive atomicity, and the
// merge conflict / cascade-relink handling (//P2002).

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
    $transaction: jest.fn(),
  },
}))

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const VALID = { name: "Smith Family" }

beforeEach(() => {
  jest.clearAllMocks()
  // Default $transaction: run a callback against a tx proxy, or resolve an array.
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => unknown)({
        person: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        transaction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        membershipApplication: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        familyUpdateInvite: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        familyUpdateSubmission: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        family: {
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
          delete: jest.fn().mockResolvedValue({}),
        },
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
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(2)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("2 transaction(s)") })
    expect(prisma.family.delete).not.toHaveBeenCalled()
  })

  it("blocks deletion when members exist and it is not past the retention floor", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.person.count as jest.Mock).mockResolvedValue(3)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("3 member(s)") })
    expect(prisma.family.delete).not.toHaveBeenCalled()
  })

  it("blocks a past-retention delete while any member is still active", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.person.count as jest.Mock)
      .mockResolvedValueOnce(2) // memberCount
      .mockResolvedValueOnce(1) // activeMemberCount
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("1 active member(s)") })
    expect(prisma.family.delete).not.toHaveBeenCalled()
  })

  it("permanently deletes a past-retention family with only archived members", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.person.count as jest.Mock)
      .mockResolvedValueOnce(2) // memberCount
      .mockResolvedValueOnce(0) // activeMemberCount
    await expect(deleteFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.family.delete).toHaveBeenCalledWith({ where: { id: 3 } })
  })

  it("blocks deleting a zero-member family that is not past the retention floor", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    // Never archived → not past retention; zero members.
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 3, archivedAt: null })
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.person.count as jest.Mock).mockResolvedValue(0)
    const r = await deleteFamily(3)
    expect(r).toMatchObject({ error: expect.stringContaining("7 years") })
    expect(prisma.family.delete).not.toHaveBeenCalled()
  })

  it("permanently deletes a zero-member family once past the retention floor", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      archivedAt: new Date("2020-01-01T00:00:00.000Z"),
    })
    ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.person.count as jest.Mock)
      .mockResolvedValueOnce(0) // memberCount
      .mockResolvedValueOnce(0) // activeMemberCount
    await expect(deleteFamily(3)).rejects.toThrow("NEXT_REDIRECT")
    expect(prisma.family.delete).toHaveBeenCalledWith({ where: { id: 3 } })
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
    expect(r).toEqual({ success: true })
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
        family: { updateMany: jest.fn().mockResolvedValue({ count: 2 }), delete: familyDelete },
      })
    )
    const r = await mergeFamilies(1, 2)
    expect(r).toEqual({ success: true })
    expect(inviteUpdate).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(submissionUpdate).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(familyDelete).toHaveBeenCalledWith({ where: { id: 1 } })
  })
})
