/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    person: {
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createFamily, updateFamily, deleteFamily, archiveFamily, unarchiveFamily } from "@/lib/actions/family"

const mockSession = auth as jest.Mock
const mockCreate = prisma.family.create as jest.Mock
const mockUpdate = prisma.family.update as jest.Mock
const mockUpdateMany = prisma.family.updateMany as jest.Mock
const mockDelete = prisma.family.delete as jest.Mock
const mockFindUnique = prisma.family.findUnique as jest.Mock
const mockAudit = prisma.auditLog.create as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockTxCount = prisma.transaction.count as jest.Mock
const mockPersonUpdateMany = prisma.person.updateMany as jest.Mock
const mockPersonCount = prisma.person.count as jest.Mock
const mockBatch = prisma.$transaction as jest.Mock

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  // updateFamily uses updateMany for optimistic concurrency — default
  // to a matched row so existing tests that don't care about the guard pass.
  mockUpdateMany.mockResolvedValue({ count: 1 })
})

describe("createFamily", () => {
  it("creates family and redirects for PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "3" } })
    mockCreate.mockResolvedValue({ id: 42 })

    await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "C35", monthlyDues: "25" }))

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Smith", status: "ACTIVE", memberNo: "C35" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/families/42")
  })

  it("passes monthlyDues to Prisma as an exact string, not a parsed float", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockCreate.mockResolvedValue({ id: 42 })

    await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", monthlyDues: "60.00" }))

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ monthlyDues: "60.00" }),
    })
  })

  it("audit-logs FAMILY_CREATED with monthlyDues metadata", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockCreate.mockResolvedValue({ id: 42 })

    await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "C35", monthlyDues: "25" }))

    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "FAMILY_CREATED",
        resourceType: "Family",
        resourceId: 42,
        metadata: { monthlyDues: "25" },
      }),
    })
  })

  it("encrypts state and postcode before storing", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockCreate.mockResolvedValue({ id: 42 })
    await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", state: "NSW", postcode: "2300" }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ state: "enc:NSW", postcode: "enc:2300" }),
    })
  })

  it("encrypts every populated PII field before storing", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockCreate.mockResolvedValue({ id: 42 })
    await createFamily(
      undefined,
      makeFormData({
        name: "Smith",
        status: "ACTIVE",
        address: "1 Main St",
        suburb: "Springfield",
        state: "NSW",
        postcode: "2300",
        homePhone: "0249000000",
        notes: "VIP",
      })
    )
    // Dropping any encrypt() call would store plaintext and fail here.
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        address: "enc:1 Main St",
        suburb: "enc:Springfield",
        state: "enc:NSW",
        postcode: "enc:2300",
        homePhone: "enc:0249000000",
        notes: "enc:VIP",
      }),
    })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "C35" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR (accounting read-only, no people/family mutations)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "C35" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns validation error for empty name", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createFamily(undefined, makeFormData({ name: "", status: "ACTIVE", memberNo: "C35" }))
    expect(result).toEqual({ error: "Name is required" })
  })

  it("creates family with null memberNo when missing (non-member family)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreate.mockResolvedValue({ id: 7 })
    await createFamily(undefined, makeFormData({ name: "Alex & Sam", status: "ACTIVE" }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberNo: null }),
    })
  })

  it("creates family with null memberNo when empty string", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreate.mockResolvedValue({ id: 8 })
    await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "" }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberNo: null }),
    })
  })

  it("trims memberNo whitespace to null", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreate.mockResolvedValue({ id: 9 })
    await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "  " }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberNo: null }),
    })
  })

  it("returns error for duplicate memberNo", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreate.mockRejectedValue(new Error("Unique constraint failed on the fields: (`memberNo`)"))
    const result = await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "C90/91" }))
    expect(result).toEqual({ error: "Member number already in use" })
  })

  it("returns error for duplicate family name", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreate.mockRejectedValue(new Error("Unique constraint failed on the fields: (`name`)"))
    const result = await createFamily(undefined, makeFormData({ name: "Smith", status: "ACTIVE", memberNo: "X99" }))
    expect(result).toEqual({ error: "A family with this name already exists" })
  })
})

describe("updateFamily", () => {
  it("updates and redirects for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })

    await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36" }))

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ name: "Jones", memberNo: "G36" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/families/5")
  })

  it("audit-logs FAMILY_UPDATED with monthlyDues metadata", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })

    await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36", monthlyDues: "40" }))

    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "FAMILY_UPDATED",
        resourceType: "Family",
        resourceId: 5,
        metadata: { monthlyDues: "40" },
      }),
    })
  })

  it("clears optional fields to null when submitted empty on update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })

    await updateFamily(
      5,
      undefined,
      makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36", address: "", homePhone: "", notes: "" })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ address: null, homePhone: null, notes: null }),
    })
  })

  it("encrypts state and postcode before storing", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", state: "VIC", postcode: "3000" }))
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ state: "enc:VIC", postcode: "enc:3000" }),
    })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36" }))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("returns error for duplicate memberNo on update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdateMany.mockRejectedValue(new Error("Unique constraint failed on the fields: (`memberNo`)"))
    const result = await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "C90/91" }))
    expect(result).toEqual({ error: "Member number already in use" })
  })

  // --- optimistic concurrency ---

  it("guards the update on the submitted last-seen updatedAt", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    const seen = "2026-07-02T10:00:00.000Z"

    await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36", updatedAt: seen }))

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 5, updatedAt: new Date(seen) },
      data: expect.any(Object),
    })
  })

  it("returns a reload error when the row changed under it (count 0)", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const result = await updateFamily(
      5,
      undefined,
      makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36", updatedAt: "2026-07-02T10:00:00.000Z" })
    )

    expect(result).toEqual({ error: expect.stringMatching(/changed by someone else/i) })
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("falls back to an id-only update when no updatedAt token is submitted", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })

    await updateFamily(5, undefined, makeFormData({ name: "Jones", status: "ACTIVE", memberNo: "G36" }))

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.any(Object),
    })
  })
})

describe("deleteFamily", () => {
  it("allows ADMIN to delete a past-retention archived family with no transactions or members", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    // The retention floor applies regardless of member count: a family
    // must be archived past the 7-year floor before hard delete, even with 0
    // members (it still holds its own encrypted PII).
    const eightYearsAgo = new Date()
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8)
    mockFindUnique.mockResolvedValueOnce({ id: 5, archivedAt: eightYearsAgo })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount.mockResolvedValue(0)
    mockDelete.mockResolvedValue({})
    await deleteFamily(5)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 5 } })
    expect(mockRedirect).toHaveBeenCalledWith("/families")
  })

  it("blocks deleting a zero-member family that is not past the retention floor", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValueOnce({ id: 5, archivedAt: null })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount.mockResolvedValue(0)
    const result = await deleteFamily(5)
    expect(result).toMatchObject({ error: expect.stringContaining("7 years") })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks delete when family has giving history", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockTxCount.mockResolvedValue(3)
    const result = await deleteFamily(5)
    expect(result).toEqual({
      error: "Cannot delete — 3 transaction(s) linked to this family. Archive it instead.",
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks delete when family has members — Person cascade would destroy them", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount.mockResolvedValue(2)
    const result = await deleteFamily(5)
    expect(result).toEqual({
      error: "Cannot delete — 2 member(s) in this family. Archive it instead.",
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("permanently deletes an archived family past the 7-year ATO retention floor despite archived members", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const eightYearsAgo = new Date()
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8)
    mockFindUnique.mockResolvedValueOnce({ id: 5, archivedAt: eightYearsAgo })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount
      .mockResolvedValueOnce(3) // total members — all archived alongside the family
      .mockResolvedValueOnce(0) // active (non-archived) members
    mockDelete.mockResolvedValue({})
    await deleteFamily(5)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 5 } })
    expect(mockRedirect).toHaveBeenCalledWith("/families")
  })

  it("still blocks delete when a past-retention archived family has an active member", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const eightYearsAgo = new Date()
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8)
    mockFindUnique.mockResolvedValueOnce({ id: 5, archivedAt: eightYearsAgo })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
    const result = await deleteFamily(5)
    expect(result).toEqual({
      error: "Cannot delete — 1 active member(s) in this family. Archive it instead.",
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("still blocks delete when the archived family has NOT reached the 7-year retention floor", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    mockFindUnique.mockResolvedValueOnce({ id: 5, archivedAt: oneYearAgo })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount.mockResolvedValueOnce(2)
    const result = await deleteFamily(5)
    expect(result).toEqual({
      error: "Cannot delete — 2 member(s) in this family. Archive it instead.",
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks PASTOR from delete", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteFamily(5)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("audit-logs FAMILY_DELETED", async () => {
    mockSession.mockResolvedValue({ user: { id: "3", role: "ADMIN" } })
    const eightYearsAgo = new Date()
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8)
    mockFindUnique.mockResolvedValueOnce({ id: 5, archivedAt: eightYearsAgo })
    mockTxCount.mockResolvedValue(0)
    mockPersonCount.mockResolvedValue(0)
    mockDelete.mockResolvedValue({})
    await deleteFamily(5)
    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "FAMILY_DELETED",
        resourceType: "Family",
        resourceId: 5,
      }),
    })
  })
})

describe("archiveFamily", () => {
  it("archives family and members atomically", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdate.mockResolvedValue({})
    mockPersonUpdateMany.mockResolvedValue({})
    await archiveFamily(5)
    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }))
    expect(mockPersonUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: 5 } }))
  })

  it("audit-logs FAMILY_ARCHIVED", async () => {
    mockSession.mockResolvedValue({ user: { id: "3", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdate.mockResolvedValue({})
    mockPersonUpdateMany.mockResolvedValue({})
    await archiveFamily(5)
    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "FAMILY_ARCHIVED",
        resourceType: "Family",
        resourceId: 5,
      }),
    })
  })

  // parity with updateFamily, which revalidates both the list and the
  // detail page.
  it("revalidates the family detail page", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdate.mockResolvedValue({})
    mockPersonUpdateMany.mockResolvedValue({})
    await archiveFamily(5)
    expect(revalidatePath).toHaveBeenCalledWith("/families/5")
  })
})

describe("unarchiveFamily", () => {
  it("unarchives family and members atomically", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdate.mockResolvedValue({})
    mockPersonUpdateMany.mockResolvedValue({})
    await unarchiveFamily(5)
    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { archivedAt: null } }))
    expect(mockPersonUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { archivedAt: null } }))
  })

  it("audit-logs FAMILY_UNARCHIVED", async () => {
    mockSession.mockResolvedValue({ user: { id: "3", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdate.mockResolvedValue({})
    mockPersonUpdateMany.mockResolvedValue({})
    await unarchiveFamily(5)
    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "FAMILY_UNARCHIVED",
        resourceType: "Family",
        resourceId: 5,
      }),
    })
  })

  // parity with updateFamily, which revalidates both the list and the
  // detail page.
  it("revalidates the family detail page", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    mockUpdate.mockResolvedValue({})
    mockPersonUpdateMany.mockResolvedValue({})
    await unarchiveFamily(5)
    expect(revalidatePath).toHaveBeenCalledWith("/families/5")
  })
})

describe("invalid date rejection", () => {
  const base = { name: "Smith", status: "ACTIVE" }

  it("createFamily rejects invalid joinedDate and does not call create", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    const result = await createFamily(undefined, makeFormData({ ...base, joinedDate: "not-a-date" }))
    expect(result).toEqual({ error: expect.stringContaining("Invalid") })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("createFamily rejects invalid marriageDate and does not call create", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    const result = await createFamily(undefined, makeFormData({ ...base, marriageDate: "not-a-date" }))
    expect(result).toEqual({ error: expect.stringContaining("Invalid") })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("updateFamily rejects invalid joinedDate and does not call update", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    const result = await updateFamily(5, undefined, makeFormData({ ...base, joinedDate: "not-a-date" }))
    expect(result).toEqual({ error: expect.stringContaining("Invalid") })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("updateFamily rejects invalid marriageDate and does not call update", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockFindUnique.mockResolvedValue({ id: 5 })
    const result = await updateFamily(5, undefined, makeFormData({ ...base, marriageDate: "not-a-date" }))
    expect(result).toEqual({ error: expect.stringContaining("Invalid") })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
