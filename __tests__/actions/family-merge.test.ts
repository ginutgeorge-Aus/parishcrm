/** @jest-environment node */
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn(), delete: jest.fn() },
    person: { findMany: jest.fn(), updateMany: jest.fn() },
    transaction: { count: jest.fn(), updateMany: jest.fn() },
    familyUpdateSubmission: { count: jest.fn() },
    membershipApplication: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

const mockAuth = auth as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockPersonFindMany = prisma.person.findMany as jest.Mock
const mockTransactionCount = prisma.transaction.count as jest.Mock
const mockPersonUpdateMany = prisma.person.updateMany as jest.Mock
const mockTransactionUpdateMany = prisma.transaction.updateMany as jest.Mock
const mockFamilyDelete = prisma.family.delete as jest.Mock
const mockPrismaTransaction = prisma.$transaction as jest.Mock
const mockSubmissionCount = prisma.familyUpdateSubmission.count as jest.Mock
const mockMembershipUpdateMany = prisma.membershipApplication.updateMany as jest.Mock
// reparent invite + settled submission history to the surviving family.
const mockInviteUpdateMany = jest.fn()
const mockSubmissionUpdateMany = jest.fn()
import { logAudit } from "@/lib/audit"
const mockLogAudit = logAudit as jest.Mock

import { previewMerge, mergeFamilies } from "@/lib/actions/family"
import { revalidatePath } from "next/cache"

const adminSession = { user: { role: "ADMIN", id: "1" } }

describe("previewMerge", () => {
  beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue(adminSession); mockSubmissionCount.mockResolvedValue(0) })

  it("returns error for non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "2" } })
    expect(await previewMerge(1, 2)).toEqual({ error: "Unauthorized" })
  })

  it("returns error for same IDs", async () => {
    expect(await previewMerge(3, 3)).toEqual({ error: "Source and target must be different families." })
  })

  it("returns error when family not found", async () => {
    mockFamilyFindUnique.mockResolvedValue(null)
    expect(await previewMerge(1, 2)).toEqual({ error: "Family not found." })
  })

  it("detects person name conflicts", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "A", memberNo: "C1" })
      .mockResolvedValueOnce({ id: 2, name: "B", memberNo: "C2" })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "John", lastName: "Smith" }])
      .mockResolvedValueOnce([{ firstName: "John", lastName: "Smith" }])
    mockTransactionCount.mockResolvedValue(5)
    const result = await previewMerge(1, 2)
    expect(result).toMatchObject({ conflicts: ["John Smith"], transactionCount: 5 })
  })

  it("returns empty conflicts when no name overlap", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "A", memberNo: "C1" })
      .mockResolvedValueOnce({ id: 2, name: "B", memberNo: "C2" })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "Alice", lastName: "X" }])
      .mockResolvedValueOnce([{ firstName: "Bob", lastName: "X" }])
    mockTransactionCount.mockResolvedValue(3)
    const result = await previewMerge(1, 2)
    expect(result).toMatchObject({ conflicts: [] })
  })
})

describe("mergeFamilies", () => {
  beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue(adminSession); mockSubmissionCount.mockResolvedValue(0) })

  it("returns error for non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "2" } })
    expect(await mergeFamilies(1, 2)).toEqual({ error: "Unauthorized" })
  })

  it("returns error for same IDs", async () => {
    expect(await mergeFamilies(3, 3)).toEqual({ error: "Source and target must be different families." })
  })

  it("returns conflicts when names overlap", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "A", memberNo: null })
      .mockResolvedValueOnce({ id: 2, name: "B", memberNo: null })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "John", lastName: "Smith" }])
      .mockResolvedValueOnce([{ firstName: "John", lastName: "Smith" }])
    mockTransactionCount.mockResolvedValue(0)
    expect(await mergeFamilies(1, 2)).toEqual({ conflicts: ["John Smith"] })
  })

  it("blocks the merge when the source family has pending self-update submissions", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "Source", memberNo: null })
      .mockResolvedValueOnce({ id: 2, name: "Target", memberNo: null })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "Alice", lastName: "X" }])
      .mockResolvedValueOnce([{ firstName: "Bob", lastName: "X" }])
    mockTransactionCount.mockResolvedValue(0)
    mockSubmissionCount.mockResolvedValue(2)
    const result = await mergeFamilies(1, 2)
    expect(result.conflicts?.[0]).toContain("2 pending self-update submissions")
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("runs $transaction and returns success on clean merge", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "Source", memberNo: "C1" })
      .mockResolvedValueOnce({ id: 2, name: "Target", memberNo: "C2" })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "Alice", lastName: "X" }])
      .mockResolvedValueOnce([{ firstName: "Bob", lastName: "X" }])
    mockTransactionCount.mockResolvedValue(2)
    mockPrismaTransaction.mockImplementation(async (fn: Function) =>
      fn({
        person: { updateMany: mockPersonUpdateMany },
        transaction: { updateMany: mockTransactionUpdateMany },
        membershipApplication: { updateMany: mockMembershipUpdateMany },
        familyUpdateInvite: { updateMany: mockInviteUpdateMany },
        familyUpdateSubmission: { updateMany: mockSubmissionUpdateMany },
        family: { updateMany: jest.fn().mockResolvedValue({ count: 2 }), delete: mockFamilyDelete },
      })
    )
    mockPersonUpdateMany.mockResolvedValue({ count: 1 })
    mockTransactionUpdateMany.mockResolvedValue({ count: 2 })
    mockMembershipUpdateMany.mockResolvedValue({ count: 0 })
    mockFamilyDelete.mockResolvedValue({})
    expect(await mergeFamilies(1, 2)).toEqual({ success: true })
    expect(mockPersonUpdateMany).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(mockTransactionUpdateMany).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    // invite + submission history reparented to the target, not cascade-deleted.
    expect(mockInviteUpdateMany).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(mockSubmissionUpdateMany).toHaveBeenCalledWith({ where: { familyId: 1 }, data: { familyId: 2 } })
    expect(mockFamilyDelete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("relinks membership applications from source to target before deleting", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "Source", memberNo: "C1" })
      .mockResolvedValueOnce({ id: 2, name: "Target", memberNo: "C2" })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "Alice", lastName: "X" }])
      .mockResolvedValueOnce([{ firstName: "Bob", lastName: "X" }])
    mockTransactionCount.mockResolvedValue(0)
    mockPrismaTransaction.mockImplementation(async (fn: Function) =>
      fn({
        person: { updateMany: mockPersonUpdateMany },
        transaction: { updateMany: mockTransactionUpdateMany },
        membershipApplication: { updateMany: mockMembershipUpdateMany },
        familyUpdateInvite: { updateMany: mockInviteUpdateMany },
        familyUpdateSubmission: { updateMany: mockSubmissionUpdateMany },
        family: { updateMany: jest.fn().mockResolvedValue({ count: 2 }), delete: mockFamilyDelete },
      })
    )
    mockPersonUpdateMany.mockResolvedValue({ count: 1 })
    mockTransactionUpdateMany.mockResolvedValue({ count: 0 })
    mockMembershipUpdateMany.mockResolvedValue({ count: 2 })
    mockFamilyDelete.mockResolvedValue({})
    expect(await mergeFamilies(1, 2)).toEqual({ success: true })
    expect(mockMembershipUpdateMany).toHaveBeenCalledWith({
      where: { linkedFamilyId: 1 },
      data: { linkedFamilyId: 2 },
    })
  })

  // a tab open on the target or source family detail page otherwise
  // keeps showing stale pre-merge members/giving.
  it("revalidates both the target and source family detail pages", async () => {
    mockFamilyFindUnique
      .mockResolvedValueOnce({ id: 1, name: "Source", memberNo: "C1" })
      .mockResolvedValueOnce({ id: 2, name: "Target", memberNo: "C2" })
    mockPersonFindMany
      .mockResolvedValueOnce([{ firstName: "Alice", lastName: "X" }])
      .mockResolvedValueOnce([{ firstName: "Bob", lastName: "X" }])
    mockTransactionCount.mockResolvedValue(0)
    mockPrismaTransaction.mockImplementation(async (fn: Function) =>
      fn({
        person: { updateMany: mockPersonUpdateMany },
        transaction: { updateMany: mockTransactionUpdateMany },
        membershipApplication: { updateMany: mockMembershipUpdateMany },
        familyUpdateInvite: { updateMany: mockInviteUpdateMany },
        familyUpdateSubmission: { updateMany: mockSubmissionUpdateMany },
        family: { updateMany: jest.fn().mockResolvedValue({ count: 2 }), delete: mockFamilyDelete },
      })
    )
    mockPersonUpdateMany.mockResolvedValue({ count: 1 })
    mockTransactionUpdateMany.mockResolvedValue({ count: 0 })
    mockMembershipUpdateMany.mockResolvedValue({ count: 0 })
    mockFamilyDelete.mockResolvedValue({})
    expect(await mergeFamilies(1, 2)).toEqual({ success: true })
    expect(revalidatePath).toHaveBeenCalledWith("/families/2")
    expect(revalidatePath).toHaveBeenCalledWith("/families/1")
  })
})
