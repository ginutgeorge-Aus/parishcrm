/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: {
      create: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    family: {
      findUnique: jest.fn(),
    },
    transaction: {
      count: jest.fn(),
    },
    dgrReceipt: {
      count: jest.fn(),
    },
    pettyCashReceipt: {
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/roleGuard", () => {
  const actual = jest.requireActual("@/lib/roleGuard")
  return {
    ...actual,
    canEdit: jest.fn().mockImplementation(actual.canEdit),
    canSeePastoralNotes: jest.fn().mockImplementation(actual.canSeePastoralNotes),
    isAdmin: jest.fn().mockImplementation(actual.isAdmin),
  }
})
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v.trim()}`),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createPerson, updatePerson, deletePerson } from "@/lib/actions/person"
import { canSeePastoralNotes } from "@/lib/roleGuard"
import { encrypt } from "@/lib/crypto"

const mockSession = auth as jest.Mock
const mockCreate = prisma.person.create as jest.Mock
const mockUpdateMany = prisma.person.updateMany as jest.Mock
const mockDelete = prisma.person.delete as jest.Mock
const mockFindUnique = prisma.person.findUnique as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockTxCount = prisma.transaction.count as jest.Mock
const mockDgrCount = prisma.dgrReceipt.count as jest.Mock
const mockPettyCashCount = prisma.pettyCashReceipt.count as jest.Mock
const mockAudit = prisma.auditLog.create as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => fd.set(k, v))
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  // createPerson validates familyId first — default to it existing.
  mockFamilyFindUnique.mockResolvedValue({ id: 3 })
  // updatePerson uses updateMany for optimistic concurrency — default
  // to a matched row so existing tests that don't care about the guard pass.
  mockUpdateMany.mockResolvedValue({ count: 1 })
  // deletePerson's linked-record guard — default to no linked records
  // so existing delete tests that don't care about the guard still pass. The
  // guard's count+delete run inside a Serializable $transaction, so
  // run the callback against the same prisma mock (tx === prisma here).
  mockTxCount.mockResolvedValue(0)
  mockDgrCount.mockResolvedValue(0)
  mockPettyCashCount.mockResolvedValue(0)
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma))
})

describe("createPerson", () => {
  it("returns Family not found for a missing familyId", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFamilyFindUnique.mockResolvedValue(null)

    const result = await createPerson(
      999,
      undefined,
      makeFormData({ firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )

    expect(result).toEqual({ error: "Family not found" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an archived family", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFamilyFindUnique.mockResolvedValue({ id: 3, archivedAt: new Date("2026-01-01") })

    const result = await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )

    expect(result).toEqual({ error: "Family not found" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates person for PASTOR and redirects to family", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockCreate.mockResolvedValue({ id: 99 })

    await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ firstName: "John", lastName: "Smith", familyId: 3 }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/families/3")
  })

  it("audit-logs PERSON_CREATED with familyId metadata", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "3" } })
    mockCreate.mockResolvedValue({ id: 99 })

    await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )

    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "PERSON_CREATED",
        resourceType: "Person",
        resourceId: 99,
        metadata: { familyId: 3 },
      }),
    })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR (accounting read-only, no people mutations)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns validation error for missing first name", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "", lastName: "Smith", role: "HEAD", classification: "MEMBER" })
    )
    expect(result).toEqual({ error: "First name is required" })
  })

  it("includes pastoralNotes in create payload when role can see pastoral notes (PASTOR)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockCreate.mockResolvedValue({ id: 1 })

    await createPerson(
      3,
      undefined,
      makeFormData({
        firstName: "John",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        pastoralNotes: "private note",
      })
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ familyId: 3, pastoralNotes: "enc:private note" }),
      })
    )
  })

  it("encrypts pastoralNotes before storing", async () => {
    const mockEncrypt = encrypt as jest.Mock
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    mockCreate.mockResolvedValue({ id: 1 })

    await createPerson(
      3,
      undefined,
      makeFormData({
        firstName: "John",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        pastoralNotes: "private note",
      })
    )

    expect(mockEncrypt).toHaveBeenCalledWith("private note")
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pastoralNotes: "enc:private note" }),
      })
    )
  })

  // Person.notes rode through unencrypted while the analogous
  // Family.notes was already encrypted — this closes that gap on both
  // createPerson and updatePerson.
  it("encrypts notes before storing on create", async () => {
    const mockEncrypt = encrypt as jest.Mock
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockCreate.mockResolvedValue({ id: 1 })

    await createPerson(
      3,
      undefined,
      makeFormData({
        firstName: "John",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        notes: "handle with care",
      })
    )

    expect(mockEncrypt).toHaveBeenCalledWith("handle with care")
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: "enc:handle with care" }),
      })
    )
  })

  it("encrypts notes before storing on update", async () => {
    const mockEncrypt = encrypt as jest.Mock
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockUpdateMany.mockResolvedValue({ count: 1 })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({
        firstName: "Jane",
        lastName: "Doe",
        role: "OTHER",
        classification: "MEMBER",
        notes: "updated note",
      })
    )

    expect(mockEncrypt).toHaveBeenCalledWith("updated note")
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: "enc:updated note" }),
      })
    )
  })

  it("encrypts email before storing", async () => {
    const mockEncrypt = encrypt as jest.Mock
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    mockCreate.mockResolvedValue({ id: 1 })

    await createPerson(
      3,
      undefined,
      makeFormData({
        firstName: "John",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        email: "john@example.com",
      })
    )

    expect(mockEncrypt).toHaveBeenCalledWith("john@example.com")
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "enc:john@example.com" }),
      })
    )
  })

  it("stores the email blind index alongside the ciphertext", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    mockCreate.mockResolvedValue({ id: 1 })

    await createPerson(
      3,
      undefined,
      makeFormData({
        firstName: "John",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        email: "John@Example.com",
      })
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailHash: "hash:john@example.com" }),
      })
    )
  })

  it("sets emailHash null when no email is provided", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    mockCreate.mockResolvedValue({ id: 1 })

    await createPerson(
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "OTHER", classification: "MEMBER" })
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailHash: null }) })
    )
  })

  it("passes bankingName through to prisma.create without modification", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreate.mockResolvedValue({ id: 99 })

    await createPerson(
      3,
      undefined,
      makeFormData({
        firstName: "Jonathan",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        bankingName: "JON SMITH",
      })
    )

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankingName: "JON SMITH" }),
      })
    )
  })
})

describe("updatePerson", () => {
  it("rejects when the person does not belong to the bound family (IDOR)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    // Person 7 is actually in family 99, but the bound familyId says 3.
    mockFindUnique.mockResolvedValue({ familyId: 99 })

    const result = await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )

    expect(result).toEqual({ error: "Not found" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects a soft-archived person", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3, archivedAt: new Date("2026-01-01") })

    const result = await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )

    expect(result).toEqual({ error: "Not found" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("updates and redirects to person page", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3, archivedAt: null })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ firstName: "Jane" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/people/7")
  })

  // createPerson and deletePerson both revalidate the family detail
  // page — updatePerson was the odd one out, leaving stale name/dob/email/
  // mobile on that page until an unrelated mutation revalidated it.
  it("revalidates the family detail page", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3, archivedAt: null })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )

    expect(revalidatePath).toHaveBeenCalledWith("/families/3")
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    const result = await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("audit-logs PERSON_UPDATED", async () => {
    mockSession.mockResolvedValue({ user: { id: "3", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )

    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "PERSON_UPDATED",
        resourceType: "Person",
        resourceId: 7,
        metadata: { familyId: 3 },
      }),
    })
  })

  it("encrypts email before storing on update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER", email: "jane@example.com" })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ email: "enc:jane@example.com" }),
    })
  })

  it("includes pastoralNotes and emergency fields when role can see pastoral notes (PASTOR)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      5,
      3,
      undefined,
      makeFormData({
        firstName: "Jane",
        lastName: "Doe",
        role: "SPOUSE",
        classification: "MEMBER",
        pastoralNotes: "secret note",
        emergencyContactName: "Bob",
        emergencyContactPhone: "0400000000",
      })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pastoralNotes: expect.any(String) }),
      })
    )
  })

  it("strips pastoralNotes and emergency fields when role cannot see pastoral notes", async () => {
    // Use ADMIN so canEdit passes, but override canSeePastoralNotes to return false
    // to simulate a future role where edit is permitted but pastoral notes are restricted.
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(canSeePastoralNotes as jest.Mock).mockReturnValueOnce(false)
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      5,
      3,
      undefined,
      makeFormData({
        firstName: "Jane",
        lastName: "Doe",
        role: "SPOUSE",
        classification: "MEMBER",
        pastoralNotes: "secret note",
        emergencyContactName: "Bob",
        emergencyContactPhone: "0400000000",
      })
    )

    const updateCall = mockUpdateMany.mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty("pastoralNotes")
    expect(updateCall.data).not.toHaveProperty("emergencyContactName")
    expect(updateCall.data).not.toHaveProperty("emergencyContactPhone")
  })

  it("clears optional fields to null when submitted empty on update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({
        firstName: "Jane",
        lastName: "Doe",
        role: "OTHER",
        classification: "MEMBER",
        mobile: "",
        email: "",
        dateOfBirth: "",
        membershipDate: "",
        notes: "",
      })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        mobile: null,
        email: null,
        dateOfBirth: null,
        membershipDate: null,
        notes: null,
      }),
    })
  })

  it("clears pastoralNotes/emergency fields to null when a permitted role blanks them", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      5,
      3,
      undefined,
      makeFormData({
        firstName: "Jane",
        lastName: "Doe",
        role: "SPOUSE",
        classification: "MEMBER",
        pastoralNotes: "",
        emergencyContactName: "",
        emergencyContactPhone: "",
      })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        pastoralNotes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      }),
    })
  })

  it("passes bankingName through to prisma.update without modification", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      5,
      3,
      undefined,
      makeFormData({
        firstName: "Jonathan",
        lastName: "Smith",
        role: "HEAD",
        classification: "MEMBER",
        bankingName: "JON SMITH",
      })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankingName: "JON SMITH" }),
      })
    )
  })

  // --- optimistic concurrency ---

  it("guards the update on the submitted last-seen updatedAt", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    const seen = "2026-07-02T10:00:00.000Z"

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER", updatedAt: seen })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 7, updatedAt: new Date(seen) },
      data: expect.any(Object),
    })
  })

  it("returns a reload error when the row changed under it (count 0)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const result = await updatePerson(
      7,
      3,
      undefined,
      makeFormData({
        firstName: "Jane",
        lastName: "Doe",
        role: "SPOUSE",
        classification: "MEMBER",
        updatedAt: "2026-07-02T10:00:00.000Z",
      })
    )

    expect(result).toEqual({ error: expect.stringMatching(/changed by someone else/i) })
    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("falls back to an id-only update when no updatedAt token is submitted", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })

    await updatePerson(
      7,
      3,
      undefined,
      makeFormData({ firstName: "Jane", lastName: "Doe", role: "SPOUSE", classification: "MEMBER" })
    )

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.any(Object),
    })
  })
})

describe("invalid date rejection ()", () => {
  const base = { firstName: "John", lastName: "Smith", role: "HEAD", classification: "MEMBER" }

  describe("createPerson", () => {
    it("rejects invalid membershipDate string and does not call create", async () => {
      mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
      const result = await createPerson(
        3,
        undefined,
        makeFormData({ ...base, membershipDate: "not-a-date" })
      )
      expect(result).toEqual({ error: expect.stringContaining("Invalid") })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it("rejects invalid baptismDate string and does not call create", async () => {
      mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
      const result = await createPerson(
        3,
        undefined,
        makeFormData({ ...base, baptismDate: "not-a-date" })
      )
      expect(result).toEqual({ error: expect.stringContaining("Invalid") })
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe("updatePerson", () => {
    it("rejects invalid membershipDate string and does not call update", async () => {
      mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
      mockFindUnique.mockResolvedValue({ familyId: 3 })
      const result = await updatePerson(
        7,
        3,
        undefined,
        makeFormData({ ...base, membershipDate: "not-a-date" })
      )
      expect(result).toEqual({ error: expect.stringContaining("Invalid") })
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })

    it("rejects invalid baptismDate string and does not call update", async () => {
      mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
      mockFindUnique.mockResolvedValue({ familyId: 3 })
      const result = await updatePerson(
        7,
        3,
        undefined,
        makeFormData({ ...base, baptismDate: "not-a-date" })
      )
      expect(result).toEqual({ error: expect.stringContaining("Invalid") })
      expect(mockUpdateMany).not.toHaveBeenCalled()
    })
  })
})

describe("deletePerson", () => {
  it("allows ADMIN to delete and redirects to family", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockDelete.mockResolvedValue({})

    await deletePerson(7, 3)

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 7 } })
    expect(mockRedirect).toHaveBeenCalledWith("/families/3")
  })

  it("audit-logs PERSON_DELETED", async () => {
    mockSession.mockResolvedValue({ user: { id: "3", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockDelete.mockResolvedValue({})

    await deletePerson(7, 3)

    expect(mockAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        action: "PERSON_DELETED",
        resourceType: "Person",
        resourceId: 7,
        metadata: { familyId: 3 },
      }),
    })
  })

  it("blocks PASTOR from deleting", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deletePerson(7, 3)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error when person does not exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await deletePerson(7, 3)
    expect(result).toEqual({ error: "Person not found" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns error when person belongs to a different family ( IDOR)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 99 })
    const result = await deletePerson(7, 3)
    expect(result).toEqual({ error: "Person not found" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  // Transaction.personId / PettyCashReceipt.personId / DgrReceipt.personId
  // are all SetNull on delete — a hard delete would silently sever donor links
  // on tax-deductible giving/receipt records. Mirror deleteFamily's linked-
  // record guard.
  it("blocks deletion when linked Transaction rows exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockTxCount.mockResolvedValue(2)
    const result = await deletePerson(7, 3)
    expect(result).toEqual({ error: expect.stringContaining("Cannot delete") })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks deletion when linked DgrReceipt rows exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockDgrCount.mockResolvedValue(1)
    const result = await deletePerson(7, 3)
    expect(result).toEqual({ error: expect.stringContaining("Cannot delete") })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks deletion when linked PettyCashReceipt rows exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockPettyCashCount.mockResolvedValue(1)
    const result = await deletePerson(7, 3)
    expect(result).toEqual({ error: expect.stringContaining("Cannot delete") })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("surfaces the friendly error when the Serializable tx aborts on a concurrent write (P2034)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    ;(prisma.$transaction as jest.Mock).mockRejectedValue({ code: "P2034" })
    const result = await deletePerson(7, 3)
    expect(result).toMatchObject({ error: expect.stringContaining("Cannot delete") })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("allows deletion when no linked records exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ familyId: 3 })
    mockDelete.mockResolvedValue({})
    await deletePerson(7, 3)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 7 } })
  })
})
