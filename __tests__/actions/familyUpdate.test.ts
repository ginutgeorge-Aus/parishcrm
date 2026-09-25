import { sendFamilyUpdateInvite } from "@/lib/actions/familyUpdate"
import { prisma } from "@/lib/prisma"
import { sendFamilyUpdateInviteEmail } from "@/lib/email"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn(), update: jest.fn() },
    person: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    familyUpdateInvite: { updateMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    familyUpdateSubmission: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/email", () => ({ sendFamilyUpdateInviteEmail: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v.trim()}`),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/formToken", () => ({ verifyFormToken: jest.fn(() => "ok") }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/headers", () => ({ headers: async () => new Map() }))

import { auth } from "@/auth"
import { verifyFormToken } from "@/lib/formToken"
import { rateLimit } from "@/lib/rateLimit"
const mockAuth = auth as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTH_URL = "https://crm.test"
})

describe("sendFamilyUpdateInvite", () => {
  it("rejects non-editors", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    expect(await sendFamilyUpdateInvite(1, "f@x.com")).toEqual({ error: "Unauthorized" })
  })
  it("rejects a missing family", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await sendFamilyUpdateInvite(99, "f@x.com")).toEqual({ error: "Family not found" })
  })
  it("rejects an invalid email", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "Smith" })
    expect(await sendFamilyUpdateInvite(1, "not-an-email")).toEqual({ error: "A valid email address is required" })
  })
  it("revokes prior SENT invites, creates one, emails the link", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "Smith" })
    ;(prisma.familyUpdateInvite.create as jest.Mock).mockResolvedValue({ id: 7 })
    const res = await sendFamilyUpdateInvite(1, "f@x.com")
    expect(prisma.familyUpdateInvite.updateMany).toHaveBeenCalledWith({
      where: { familyId: 1, status: "SENT" }, data: { status: "REVOKED" },
    })
    const createArg = (prisma.familyUpdateInvite.create as jest.Mock).mock.calls[0][0]
    expect(createArg.data.email).toBe("enc:f@x.com")
    expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(sendFamilyUpdateInviteEmail).toHaveBeenCalledWith("f@x.com", expect.stringContaining("https://crm.test/family/update/"), "Smith")
    expect(res).toEqual({ success: "Invite sent" })
  })
  it("blocks a new invite while a submission is still awaiting review", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "Smith" })
    ;(prisma.familyUpdateSubmission.findFirst as jest.Mock).mockResolvedValueOnce({ id: 42 })
    const res = await sendFamilyUpdateInvite(1, "f@x.com")
    expect(res).toEqual({ error: expect.stringMatching(/awaiting review/i) })
    expect(prisma.familyUpdateSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ familyId: 1, status: "PENDING" }) }))
    // No invite churn while a submission is unreviewed.
    expect(prisma.familyUpdateInvite.updateMany).not.toHaveBeenCalled()
    expect(prisma.familyUpdateInvite.create).not.toHaveBeenCalled()
    expect(sendFamilyUpdateInviteEmail).not.toHaveBeenCalled()
  })
  it("errors without revoking when AUTH_URL is unset", async () => {
    const prev = process.env.AUTH_URL
    delete process.env.AUTH_URL
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "Smith" })
    const res = await sendFamilyUpdateInvite(1, "f@x.com")
    expect(res).toEqual({ error: "Server misconfiguration: AUTH_URL is not set or invalid" })
    expect(prisma.familyUpdateInvite.updateMany).not.toHaveBeenCalled()
    expect(prisma.familyUpdateInvite.create).not.toHaveBeenCalled()
    expect(sendFamilyUpdateInviteEmail).not.toHaveBeenCalled()
    process.env.AUTH_URL = prev
  })
})

import { submitFamilyUpdate } from "@/lib/actions/familyUpdate"

const goodInput = {
  token: "rawtoken", ip: "1.2.3.4", website: "", formToken: "ts.sig",
  payload: { family: { address: "1 St" }, members: [{ firstName: "Jon", lastName: "Smith" }] },
}

describe("submitFamilyUpdate", () => {
  const liveInvite = { id: 7, familyId: 1, status: "SENT", expiresAt: new Date(Date.now() + 1000), tokenHash: "x" }

  it("rejects when the honeypot is filled", async () => {
    expect(await submitFamilyUpdate({ ...goodInput, website: "bot" })).toEqual({ error: "Submission failed" })
  })
  it("rejects when rate-limited", async () => {
    ;(rateLimit as jest.Mock).mockReturnValueOnce(false)
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "Too many requests" })
  })
  it("rejects a forged/expired timing token", async () => {
    ;(verifyFormToken as jest.Mock).mockReturnValueOnce("expired")
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "Your session expired. Please refresh and try again." })
  })
  it("rejects an unknown token", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "This link is no longer valid." })
  })
  it("rejects an already-submitted invite", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue({ ...liveInvite, status: "SUBMITTED" })
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "This link is no longer valid." })
  })
  it("rejects an expired invite", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue({ ...liveInvite, expiresAt: new Date(Date.now() - 1000) })
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "This link is no longer valid." })
  })
  // a stale invite link must not accept a submission for a family that
  // has since been archived — an admin approving it could resurrect PII into
  // a soft-deleted family.
  it("rejects a submission when the target family is archived", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue({
      ...liveInvite, family: { archivedAt: new Date() },
    })
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "This link is no longer valid." })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it("rejects an invalid payload", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue(liveInvite)
    expect(await submitFamilyUpdate({ ...goodInput, payload: { family: {}, members: [{ firstName: "" }] } }))
      .toEqual({ error: "Please check the form — some required fields are missing." })
  })
  it("stores a PENDING submission and marks the invite SUBMITTED on success", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue(liveInvite)
    ;(prisma.familyUpdateInvite.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    const res = await submitFamilyUpdate(goodInput)
    expect(prisma.familyUpdateSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ familyId: 1, inviteId: 7, status: "PENDING" }) })
    )
    // status flips SENT→SUBMITTED atomically via a guarded updateMany.
    expect(prisma.familyUpdateInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, status: "SENT" }, data: expect.objectContaining({ status: "SUBMITTED" }) })
    )
    expect(res).toEqual({ success: "submitted" })
  })

  it("stores the payload encrypted at rest", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue(liveInvite)
    ;(prisma.familyUpdateInvite.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    await submitFamilyUpdate(goodInput)
    const data = (prisma.familyUpdateSubmission.create as jest.Mock).mock.calls[0][0].data
    expect(typeof data.payload).toBe("string")
    expect((data.payload as string).startsWith("enc:")).toBe(true)
  })

  // the concurrent double-submit loser. The invite still reads SENT at the
  // pre-check (passes findUnique), but inside the transaction the guarded
  // SENT→SUBMITTED updateMany matches 0 rows because a concurrent request already
  // flipped it. The loser must NOT create a submission and must return the
  // generic "no longer valid" error.
  it("rejects the concurrent double-submit loser when the guarded flip matches 0 rows", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock).mockResolvedValue(liveInvite)
    ;(prisma.familyUpdateInvite.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    const res = await submitFamilyUpdate(goodInput)
    expect(res).toEqual({ error: "This link is no longer valid." })
    expect(prisma.familyUpdateInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, status: "SENT" }, data: expect.objectContaining({ status: "SUBMITTED" }) })
    )
    // The losing request must not have written a submission row.
    expect(prisma.familyUpdateSubmission.create).not.toHaveBeenCalled()
  })

  // a merge can reparent the invite (and delete its source family)
  // between the pre-check read and the claim. The submission must use the
  // invite's CURRENT familyId, re-read inside the transaction.
  it("uses the invite's current familyId when a merge reparented it after the pre-check", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock)
      .mockResolvedValueOnce(liveInvite)
      .mockResolvedValueOnce({ familyId: 2, family: { archivedAt: null } })
    ;(prisma.familyUpdateInvite.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    expect(await submitFamilyUpdate(goodInput)).toEqual({ success: "submitted" })
    expect(prisma.familyUpdateSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ familyId: 2, inviteId: 7 }) })
    )
  })

  it("rolls back the claim when the invite's family was archived after the pre-check", async () => {
    ;(prisma.familyUpdateInvite.findUnique as jest.Mock)
      .mockResolvedValueOnce(liveInvite)
      .mockResolvedValueOnce({ familyId: 1, family: { archivedAt: new Date() } })
    ;(prisma.familyUpdateInvite.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    expect(await submitFamilyUpdate(goodInput)).toEqual({ error: "This link is no longer valid." })
    expect(prisma.familyUpdateSubmission.create).not.toHaveBeenCalled()
  })
})

import { approveFamilyUpdate, rejectFamilyUpdate } from "@/lib/actions/familyUpdate"

describe("approveFamilyUpdate", () => {
  const submission = {
    id: 3, familyId: 1, status: "PENDING",
    payload: {
      family: { address: "2 New St", suburb: null, state: null, postcode: null, homePhone: null },
      members: [
        { personId: 5, firstName: "Jon", lastName: "Smith", email: "new@x.com", title: null, middleName: null,
          suffix: null, gender: "MALE", dateOfBirth: null, mobile: null, workPhone: null, homePhone: null },
        { firstName: "Baby", lastName: "Smith", title: null, middleName: null, suffix: null, gender: null,
          dateOfBirth: null, email: null, mobile: null, workPhone: null, homePhone: null },
      ],
    },
  }
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue(submission)
    ;(prisma.familyUpdateSubmission.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
  })
  it("rejects non-editors", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    expect(await approveFamilyUpdate(3)).toEqual({ error: "Unauthorized" })
  })
  it("updates family contact, updates existing member, creates new member — all encrypted", async () => {
    const res = await approveFamilyUpdate(3)
    expect(prisma.family.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ address: "enc:2 New St" }) })
    )
    expect(prisma.person.update).toHaveBeenCalledWith(
      expect.objectContaining({
        // scoped to active members — archivedAt: null blocks overwriting a
        // soft-archived Person whose id was smuggled into the payload.
        where: { id: 5, familyId: 1, archivedAt: null },
        data: expect.objectContaining({ email: "enc:new@x.com", emailHash: "hash:new@x.com" }),
      })
    )
    expect(prisma.person.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ familyId: 1, firstName: "Baby", lastName: "Smith" }) })
    )
    // status flips PENDING→APPROVED atomically via a guarded updateMany.
    expect(prisma.familyUpdateSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, status: "PENDING" }, data: expect.objectContaining({ status: "APPROVED" }) })
    )
    expect(res).toEqual({ success: "Changes applied" })
  })
  // a personId pointing at an archived member matches 0 rows under the
  // archivedAt: null guard → Prisma P2025 → the "no longer exist" error, so the
  // archived record's PII is never overwritten.
  it("returns 'no longer exist' when the member update targets an archived person (P2025)", async () => {
    ;(prisma.person.update as jest.Mock).mockRejectedValueOnce({ code: "P2025" })
    expect(await approveFamilyUpdate(3)).toEqual({
      error: "One or more people in this update no longer exist. Ask the family to resubmit.",
    })
  })
  // the atomic claim matches 0 rows because a concurrent approval already
  // won — abort before inserting members so they aren't duplicated.
  it("aborts when the atomic claim loses a concurrent race", async () => {
    ;(prisma.familyUpdateSubmission.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await approveFamilyUpdate(3)).toEqual({ error: "This submission has already been reviewed." })
    expect(prisma.person.create).not.toHaveBeenCalled()
  })
  it("applies marriageDate as a UTC-midnight Date", async () => {
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
      id: 3, familyId: 1, status: "PENDING",
      payload: { family: { address: null, suburb: null, state: null, postcode: null, homePhone: null, marriageDate: "1990-02-01" }, members: [{ personId: 5, firstName: "Jon", lastName: "Smith" }] },
    })
    await approveFamilyUpdate(3)
    const famData = (prisma.family.update as jest.Mock).mock.calls[0][0].data
    expect(famData.marriageDate).toEqual(new Date("1990-02-01T00:00:00.000Z"))
  })
  it("applies null marriageDate when blank or invalid", async () => {
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
      id: 3, familyId: 1, status: "PENDING",
      payload: { family: { address: null, suburb: null, state: null, postcode: null, homePhone: null, marriageDate: null }, members: [{ personId: 5, firstName: "Jon", lastName: "Smith" }] },
    })
    await approveFamilyUpdate(3)
    const famData = (prisma.family.update as jest.Mock).mock.calls[0][0].data
    expect(famData.marriageDate).toBeNull()
  })
  it("decrypts and applies an encrypted-string payload", async () => {
    // Same payload as the legacy-object case, but stored as an encrypted string.
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
      id: 3, familyId: 1, status: "PENDING", payload: "enc:" + JSON.stringify(submission.payload),
    })
    const res = await approveFamilyUpdate(3)
    expect(prisma.family.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ address: "enc:2 New St" }) })
    )
    expect(res).toEqual({ success: "Changes applied" })
  })

  it("never persists a disallowed field even if present in the stored payload", async () => {
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
      ...submission,
      payload: {
        family: { address: "2 New St", monthlyDues: 999, memberNo: "C9/9" },
        members: [{ personId: 5, firstName: "Jon", lastName: "Smith", pastoralNotes: "leak", role: "HEAD" }],
      },
    })
    await approveFamilyUpdate(3)
    const famData = (prisma.family.update as jest.Mock).mock.calls[0][0].data
    expect(famData).not.toHaveProperty("monthlyDues")
    expect(famData).not.toHaveProperty("memberNo")
    const personData = (prisma.person.update as jest.Mock).mock.calls[0][0].data
    expect(personData).not.toHaveProperty("pastoralNotes")
    expect(personData).not.toHaveProperty("role")
  })
  it("returns a friendly error on a unique-name collision (P2002)", async () => {
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(Object.assign(new Error("Unique"), { code: "P2002" }))
    expect(await approveFamilyUpdate(3)).toEqual({ error: "A member with the same name already exists in this family. Resolve it before approving." })
  })
  // a Person referenced by the submission's diff can be deleted or
  // reassigned to a different family between submission and approval —
  // the transaction's ownership-guarded person.update then matches 0 rows
  // and Prisma throws P2025. Must surface a clean error, never crash.
  it("returns a friendly error when a referenced person no longer exists (P2025)", async () => {
    ;(prisma.$transaction as jest.Mock).mockRejectedValue(Object.assign(new Error("Record not found"), { code: "P2025" }))
    expect(await approveFamilyUpdate(3)).toEqual({
      error: "One or more people in this update no longer exist. Ask the family to resubmit.",
    })
  })
  it("rejects an already-reviewed submission", async () => {
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({ ...submission, status: "APPROVED" })
    expect(await approveFamilyUpdate(3)).toEqual({ error: "This submission has already been reviewed." })
  })
  // defense in depth — even if a submission was created before the
  // family was archived mid-flight, approval must not resurrect PII into a
  // soft-deleted family.
  it("rejects approval when the family is archived", async () => {
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
      ...submission, family: { archivedAt: new Date() },
    })
    expect(await approveFamilyUpdate(3)).toEqual({
      error: "This family has been archived and can no longer be updated.",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("rejectFamilyUpdate", () => {
  it("marks the submission REJECTED with a note via a guarded updateMany", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({ id: 3, familyId: 1, inviteId: 9, status: "PENDING" })
    ;(prisma.familyUpdateSubmission.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    const res = await rejectFamilyUpdate(3, "Duplicate")
    // the write is guarded on status PENDING so it can't clobber a
    // concurrent approval that already moved the row off PENDING.
    expect(prisma.familyUpdateSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, status: "PENDING" }, data: expect.objectContaining({ status: "REJECTED", reviewNote: "Duplicate" }) })
    )
    expect(res).toEqual({ success: "Submission rejected" })
  })

  // rejecting must revoke the invite so the public link stops showing
  // "awaiting review" forever and can't be resubmitted against a settled decision.
  it("revokes the invite token on reject", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({ id: 3, familyId: 1, inviteId: 9, status: "PENDING" })
    ;(prisma.familyUpdateSubmission.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    await rejectFamilyUpdate(3, "Duplicate")
    expect(prisma.familyUpdateInvite.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: "REVOKED" },
    })
  })

  it("does not overwrite a submission a concurrent approval already claimed", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    // findUnique still sees PENDING (read before the concurrent approve committed),
    // but the guarded updateMany matches 0 rows because it is now APPROVED.
    ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({ id: 3, familyId: 1, inviteId: 9, status: "PENDING" })
    ;(prisma.familyUpdateSubmission.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(prisma))
    const res = await rejectFamilyUpdate(3, "Duplicate")
    expect(res).toEqual({ error: "This submission has already been reviewed." })
    expect(prisma.familyUpdateInvite.update).not.toHaveBeenCalled()
  })
})
