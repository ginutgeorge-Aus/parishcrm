/** @jest-environment node */
import { approveMembershipApplication, rejectMembershipApplication } from "@/lib/actions/membership"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v.trim()}`),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null }) }))
jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({ signerTitle: "" }) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    membershipApplication: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const payload = {
  personal: { name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com", mobile: "0400111222",
    address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000", qualificationProfession: "Engineer",
    motherParish: "Grace", addressInIndia: "Chennai", dateOfArrivalNsw: "2015-03-01", maritalStatus: "MARRIED", transferCertFurnished: true },
  spouse: { name: "Mary Miller", dateOfBirth: "1982-05-06", dateOfMarriage: "2005-06-07", parish: "Grace", working: true, email: "mary@example.com" },
  children: [{ name: "Anna Miller", sex: "F", dateOfBirth: "2010-01-01", occupation: null, phoneEmail: null }],
  dependents: [],
  relativesInAustralia: [{ name: "Sam", place: "Sydney", relationship: "Brother", phoneEmail: "sam@x.com" }],
  subscription: { monthlyAmount: 80 },
  declaration: { place: "Springfield", date: "2026-07-09" },
}

const adminSession = { user: { id: "9", role: "ADMIN" } }

function makeApp(over: Record<string, unknown> = {}) {
  return { id: 1, status: "PENDING", payload: JSON.stringify(payload), monthlyDues: "80", linkedFamilyId: null, ...over }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue(adminSession)
})

describe("approveMembershipApplication — create", () => {
  it("creates a family (unique name) + all persons with encrypted PII and mapped columns", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    const tx = {
      family: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 5 }) },
      person: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
      membershipApplication: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx))

    const r = await approveMembershipApplication(1, { mode: "create" })
    expect(r).toEqual({ success: "Application approved" })

    const fam = tx.family.create.mock.calls[0][0].data
    expect(fam.name).toBe("Miller")
    expect(fam.address).toBe("enc:1 Example St") // encrypted
    expect(fam.notes).toContain("enc:") // notes block encrypted
    expect(fam.monthlyDues).toBe("80")

    expect(tx.person.createMany).toHaveBeenCalledTimes(1)   // one batched insert
    const persons = tx.person.createMany.mock.calls[0][0].data
    expect(persons).toHaveLength(3) // HEAD + SPOUSE + 1 CHILD
    const head = persons[0]
    expect(head).toMatchObject({ firstName: "John", lastName: "Miller", role: "HEAD", gender: "MALE", profession: "Engineer", motherParish: "Grace", maritalStatus: "MARRIED" })
    expect(head.email).toBe("enc:john@example.com")
    expect(head.emailHash).toBe("hash:john@example.com")
    expect(head.dateOfBirth).toBe("enc:1980-01-02")
    expect(head.mobile).toBe("enc:0400111222")
    expect(head.mobileHash).toBe("mhash:0400111222") // blind index set on approve

    // Atomic claim flips status; final update only links the family.
    expect(tx.membershipApplication.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 1, status: "PENDING" },
      data: { status: "APPROVED", reviewedById: 9 },
    })
    expect(tx.membershipApplication.update.mock.calls[0][0].data).toEqual({ linkedFamilyId: 5 })
  })

  it("disambiguates a colliding family name", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    const findFirst = jest.fn()
      .mockResolvedValueOnce({ id: 2 }) // "Miller" taken
      .mockResolvedValueOnce(null) // "John Miller" free
    const tx = {
      family: { findFirst, create: jest.fn().mockResolvedValue({ id: 6 }) },
      person: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
      membershipApplication: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx))

    await approveMembershipApplication(1, { mode: "create" })
    expect(tx.family.create.mock.calls[0][0].data.name).toBe("John Miller")
  })
})

describe("approveMembershipApplication — merge", () => {
  it("fills only blank family fields, appends notes, and adds only missing persons", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    const tx = {
      family: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, address: "enc:existing", suburb: null, state: null, postcode: null, marriageDate: null, monthlyDues: null, notes: "enc:old note" }),
        update: jest.fn().mockResolvedValue({}),
      },
      person: {
        findMany: jest.fn().mockResolvedValue([{ firstName: "John", lastName: "Miller" }]), // HEAD already present
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      membershipApplication: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx))

    const r = await approveMembershipApplication(1, { mode: "merge", familyId: 7 })
    expect(r).toEqual({ success: "Application approved" })

    const patch = tx.family.update.mock.calls[0][0].data
    expect(patch.address).toBeUndefined() // existing kept
    expect(patch.suburb).toBe("enc:Sampletown") // blank filled + encrypted
    expect(patch.monthlyDues).toBe("80")
    // existing (encrypted) note is decrypted, appended, and re-encrypted
    expect(patch.notes.startsWith("enc:")).toBe(true) // stored encrypted at rest
    expect(patch.notes.replace(/^enc:/, "").startsWith("old note\n\n")).toBe(true) // appended, not clobbered

    expect(tx.person.createMany).toHaveBeenCalledTimes(1)
    expect(tx.person.createMany.mock.calls[0][0].data).toHaveLength(2) // SPOUSE + CHILD (HEAD skipped)
  })

  it("does not let an ARCHIVED same-name person suppress creating the active member", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    const findMany = jest.fn().mockResolvedValue([]) // no ACTIVE persons; a same-name archived one exists
    const tx = {
      family: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, address: null, suburb: null, state: null, postcode: null, marriageDate: null, monthlyDues: null, notes: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      person: { findMany, createMany: jest.fn().mockResolvedValue({ count: 3 }) },
      membershipApplication: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx))

    const r = await approveMembershipApplication(1, { mode: "merge", familyId: 7 })
    expect(r).toEqual({ success: "Application approved" })

    // The existing-person lookup must exclude archived rows...
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ familyId: 7, archivedAt: null }) }))
    // ...so the applicant (HEAD) is created, not silently dropped as "already present".
    expect(tx.person.createMany.mock.calls[0][0].data).toHaveLength(3) // HEAD + SPOUSE + CHILD
  })

  it("refuses to merge into an archived family", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    const tx = {
      family: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, archivedAt: new Date("2020-01-01"), address: null, suburb: null, state: null, postcode: null, marriageDate: null, monthlyDues: null, notes: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      person: { findMany: jest.fn(), createMany: jest.fn() },
      membershipApplication: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx))

    const r = await approveMembershipApplication(1, { mode: "merge", familyId: 7 })
    expect(r).toEqual({ error: "That family is archived — restore it before merging, or create a new family." })
    expect(tx.family.update).not.toHaveBeenCalled()
    expect(tx.person.createMany).not.toHaveBeenCalled()
  })
})

describe("guards", () => {
  it("rejects a non-editor role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
    const r = await approveMembershipApplication(1, { mode: "create" })
    expect(r).toEqual({ error: "Not authorized" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns error when application missing", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await approveMembershipApplication(99, { mode: "create" })).toEqual({ error: "Application not found" })
  })

  it("is idempotent on an already-approved application", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp({ status: "APPROVED", linkedFamilyId: 5 }))
    const r = await approveMembershipApplication(1, { mode: "create" })
    expect(r).toEqual({ success: "Already approved" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("refuses to approve a rejected application", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp({ status: "REJECTED" }))
    const r = await approveMembershipApplication(1, { mode: "create" })
    expect(r).toEqual({ error: "This application has already been reviewed." })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("aborts when the atomic claim loses a concurrent race", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    const tx = {
      family: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 5 }) },
      person: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
      membershipApplication: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    }
    ;(prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx))
    const r = await approveMembershipApplication(1, { mode: "create" })
    expect(r).toEqual({ error: "This application has already been reviewed." })
    expect(tx.family.create).not.toHaveBeenCalled()
  })
})

describe("rejectMembershipApplication", () => {
  it("sets REJECTED with the note via a guarded updateMany", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp())
    ;(prisma.membershipApplication.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const r = await rejectMembershipApplication(1, "duplicate")
    expect(r).toEqual({ success: "Application rejected" })
    expect((prisma.membershipApplication.updateMany as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 1, status: "PENDING" },
      data: { status: "REJECTED", reviewNote: "duplicate", reviewedById: 9 },
    })
  })

  it("refuses to reject a non-pending application", async () => {
    ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(makeApp({ status: "APPROVED", linkedFamilyId: 5 }))
    const r = await rejectMembershipApplication(1)
    expect(r).toEqual({ error: "This application has already been reviewed." })
    expect(prisma.membershipApplication.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a non-editor role", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
    expect(await rejectMembershipApplication(1)).toEqual({ error: "Not authorized" })
  })
})
