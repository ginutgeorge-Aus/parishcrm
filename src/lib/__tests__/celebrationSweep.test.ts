/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findMany: jest.fn(async () => []) },
    family: { findMany: jest.fn(async () => []) },
    celebrationSend: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(async () => {}),
  // Mirror the real classifier (email.ts): post-submission socket errors are ambiguous.
  isAmbiguousDeliveryError: (e: unknown) =>
    typeof (e as { code?: string })?.code === "string" &&
    ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "EPIPE"].includes((e as { code: string }).code),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/celebrationSettings", () => ({
  readAutoEmailFlags: jest.fn(async () => ({ birthday: false, anniversary: false })),
  readBirthdayTemplate: jest.fn(async () => ({ subject: "Birthday {firstName}", body: "Bless {firstName}, guide {them}." })),
  readAnniversaryTemplate: jest.fn(async () => ({ subject: "Anniversary {names}", body: "Bless {names}, {years} years." })),
}))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))

import { sendDueCelebrations } from "@/lib/celebrationSweep"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"
import { readAutoEmailFlags } from "@/lib/celebrationSettings"
import { logger } from "@/lib/logger"

const NOW = new Date("2026-06-15T02:00:00.000Z") // Sydney 2026-06-15 (UTC+10)
const flags = readAutoEmailFlags as jest.Mock
const create = prisma.celebrationSend.create as jest.Mock
const updateMany = prisma.celebrationSend.updateMany as jest.Mock
const update = prisma.celebrationSend.update as jest.Mock

function p2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = "s3cret"
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([])
  flags.mockResolvedValue({ birthday: false, anniversary: false })
  create.mockResolvedValue({ id: 1 })
  updateMany.mockResolvedValue({ count: 0 })
  update.mockResolvedValue({})
})

test("503 when CRON_SECRET unset", async () => {
  delete process.env.CRON_SECRET
  const res = await sendDueCelebrations("Bearer s3cret", NOW)
  expect(res.status).toBe(503)
  expect(sendEmail).not.toHaveBeenCalled()
})

test("401 on bad bearer", async () => {
  const res = await sendDueCelebrations("Bearer wrong", NOW)
  expect(res.status).toBe(401)
  expect(sendEmail).not.toHaveBeenCalled()
})

test("logs a loud error when every due birthday send fails — SMTP-outage signal, no silent failure", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
    { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } },
  ])
  ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error("SMTP down"))
  const errSpy = jest.spyOn(logger, "error").mockImplementation(() => {})

  const res = await sendDueCelebrations("Bearer s3cret", NOW)

  expect(res.body).toMatchObject({ birthdays: { sent: 0, failed: 1 } })
  expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/birthday.*fail/i))
  // The failed send resolves the claim to FAILED (retryable next run), not left PENDING forever.
  expect(update).toHaveBeenCalledWith({
    where: { personId_action_sendDate: { personId: 1, action: "BIRTHDAY_EMAIL_SENT", sendDate: "2026-06-15" } },
    data: { status: "FAILED" },
  })
  errSpy.mockRestore()
})

test("both toggles off ⇒ no queries beyond the flag read", async () => {
  const res = await sendDueCelebrations("Bearer s3cret", NOW)
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ birthdays: { sent: 0, skipped: 0, failed: 0 }, anniversaries: { sent: 0, skipped: 0, failed: 0 } })
  expect(prisma.person.findMany).not.toHaveBeenCalled()
  expect(prisma.family.findMany).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})

test("sends today's birthday, consent-gated, with gendered pronoun — claims BEFORE sending", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
    { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } },
    { id: 2, firstName: "No", lastName: "Consent", dateOfBirth: "1990-06-15T00:00:00.000Z", email: "enc:no@x.com", emailConsent: false, gender: "FEMALE", family: { name: "Fam" } },
  ])
  const res = await sendDueCelebrations("Bearer s3cret", NOW)
  expect(res.body).toMatchObject({ birthdays: { sent: 1, skipped: 1, failed: 0 } })
  expect(sendEmail).toHaveBeenCalledTimes(1)
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("guide him") // MALE → him
  expect(logAudit).toHaveBeenCalledWith(null, "BIRTHDAY_EMAIL_SENT", "Person", 1)
  // Claim created before the send, resolved to SENT after.
  expect(create).toHaveBeenCalledWith({
    data: { personId: 1, action: "BIRTHDAY_EMAIL_SENT", sendDate: "2026-06-15", status: "PENDING" },
  })
  const createOrder = create.mock.invocationCallOrder[0]
  const sendOrder = (sendEmail as jest.Mock).mock.invocationCallOrder[0]
  expect(createOrder).toBeLessThan(sendOrder)
  expect(update).toHaveBeenCalledWith({
    where: { personId_action_sendDate: { personId: 1, action: "BIRTHDAY_EMAIL_SENT", sendDate: "2026-06-15" } },
    data: { status: "SENT" },
  })
})

test(" an ambiguous post-submission send error resolves to UNKNOWN (terminal), never a retryable FAILED", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
    { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } },
  ])
  // ESOCKET after DATA: the mail may already be delivered — retrying would double-send.
  ;(sendEmail as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ESOCKET" }))

  await sendDueCelebrations("Bearer s3cret", NOW)

  expect(update).toHaveBeenCalledWith({
    where: { personId_action_sendDate: { personId: 1, action: "BIRTHDAY_EMAIL_SENT", sendDate: "2026-06-15" } },
    data: { status: "UNKNOWN" },
  })
  expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }))
})

test(" a delivered send whose SENT write fails is marked UNKNOWN (not left reclaimable), and logs loudly", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
    { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } },
  ])
  // sendEmail succeeds (default mock), but persisting SENT fails; the fallback UNKNOWN write succeeds.
  update.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({})
  const errSpy = jest.spyOn(logger, "error").mockImplementation(() => {})

  const res = await sendDueCelebrations("Bearer s3cret", NOW)

  // Delivered — counted as sent, and audited.
  expect(res.body).toMatchObject({ birthdays: { sent: 1 } })
  expect(logAudit).toHaveBeenCalledWith(null, "BIRTHDAY_EMAIL_SENT", "Person", 1)
  // First tried SENT, then fell back to terminal UNKNOWN so a later stale-lease reclaim can't resend.
  expect(update).toHaveBeenNthCalledWith(1, {
    where: { personId_action_sendDate: { personId: 1, action: "BIRTHDAY_EMAIL_SENT", sendDate: "2026-06-15" } },
    data: { status: "SENT" },
  })
  expect(update).toHaveBeenNthCalledWith(2, {
    where: { personId_action_sendDate: { personId: 1, action: "BIRTHDAY_EMAIL_SENT", sendDate: "2026-06-15" } },
    data: { status: "UNKNOWN" },
  })
  expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/deliver|SENT|UNKNOWN/i))
  errSpy.mockRestore()
})

test("sends today's anniversary to both spouses, names both", async () => {
  flags.mockResolvedValue({ birthday: false, anniversary: true })
  ;(prisma.family.findMany as jest.Mock).mockResolvedValue([
    {
      id: 10, name: "Fam", marriageDate: new Date("2020-06-15T00:00:00.000Z"),
      people: [
        { id: 1, firstName: "Sam", role: "HEAD", email: "enc:sam@x.com", emailConsent: true },
        { id: 2, firstName: "Pat", role: "SPOUSE", email: "enc:pat@x.com", emailConsent: true },
      ],
    },
  ])
  const res = await sendDueCelebrations("Bearer s3cret", NOW)
  expect(res.body).toMatchObject({ anniversaries: { sent: 2, skipped: 0, failed: 0 } })
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("Bless Sam and Pat, 6 years")
  expect(logAudit).toHaveBeenCalledWith(null, "ANNIVERSARY_EMAIL_SENT", "Person", 1)
})

test("dedupe: a claim collision (P2002) on an already-SENT slot is skipped, not re-sent", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
    { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } },
  ])
  // Simulates another invocation (cron re-run, or manual send) already having
  // claimed/resolved today's slot: the create() collides, and the reclaim
  // (which only matches a FAILED row) finds nothing to take over.
  create.mockRejectedValueOnce(p2002())
  updateMany.mockResolvedValueOnce({ count: 0 })
  const res = await sendDueCelebrations("Bearer s3cret", NOW)
  expect(res.body).toMatchObject({ birthdays: { sent: 0, skipped: 1, failed: 0 } })
  expect(sendEmail).not.toHaveBeenCalled()
})

test(" a claim collision on a previously-FAILED slot is reclaimed and resent", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([
    { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } },
  ])
  create.mockRejectedValueOnce(p2002())
  updateMany.mockResolvedValueOnce({ count: 1 }) // reclaimed a FAILED row
  const res = await sendDueCelebrations("Bearer s3cret", NOW)
  expect(res.body).toMatchObject({ birthdays: { sent: 1, skipped: 0, failed: 0 } })
  expect(sendEmail).toHaveBeenCalledTimes(1)
})

test(" two overlapping invocations racing the same person: only the create() winner sends", async () => {
  flags.mockResolvedValue({ birthday: true, anniversary: false })
  const person = { id: 1, firstName: "Sam", lastName: "X", dateOfBirth: "2000-06-15T00:00:00.000Z", email: "enc:sam@x.com", emailConsent: true, gender: "MALE", family: { name: "Fam" } }
  ;(prisma.person.findMany as jest.Mock).mockResolvedValue([person])

  // Invocation A: create() succeeds — it sends.
  create.mockResolvedValueOnce({ id: 1 })
  const runA = await sendDueCelebrations("Bearer s3cret", NOW)

  // Invocation B (racing overlap): create() collides (A already holds/resolved
  // the slot); the reclaim only matches a FAILED row, which doesn't exist yet
  // since A's send hasn't failed — B must not send.
  create.mockRejectedValueOnce(p2002())
  updateMany.mockResolvedValueOnce({ count: 0 })
  const runB = await sendDueCelebrations("Bearer s3cret", NOW)

  expect(runA.body).toMatchObject({ birthdays: { sent: 1 } })
  expect(runB.body).toMatchObject({ birthdays: { sent: 0, skipped: 1 } })
  expect(sendEmail).toHaveBeenCalledTimes(1)
})
