import { sendPaymentReminders, lastRemindedAtByRegistration } from "@/lib/actions/registration"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/eventManager", () => ({ canManageEvent: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendPaymentReminderEmail: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    registration: { findMany: jest.fn() },
    paymentReminderSend: { create: jest.fn(), groupBy: jest.fn() },
  },
}))

import { auth } from "@/auth"
import { canManageEvent } from "@/lib/eventManager"
import { sendPaymentReminderEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

const mAuth = auth as jest.Mock
const mCanManage = canManageEvent as jest.Mock
const mSend = sendPaymentReminderEmail as jest.Mock
const mEvent = prisma.event.findUnique as jest.Mock
const mRegs = prisma.registration.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mCanManage.mockResolvedValue(true)
  mSend.mockResolvedValue(undefined)
  mEvent.mockResolvedValue({ id: 10, title: "Retreat", slug: "retreat" })
  process.env.AUTH_URL = "https://app.example.org"
})

function pendingRow(id: number) {
  return { id, firstName: "Anna", email: "enc:anna@x.org", paymentStatus: "PENDING", totalAmount: "25.00", publicToken: `tok-${id}` }
}

test("rejects when caller cannot manage the event", async () => {
  mCanManage.mockResolvedValue(false)
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }], "Body")
  expect(res).toEqual({ error: "Unauthorized" })
  expect(mSend).not.toHaveBeenCalled()
})

test("sends to PENDING rows scoped to the event and counts sent", async () => {
  mRegs.mockResolvedValue([pendingRow(1), pendingRow(2)])
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }, { registrationId: 2 }], "Body")
  expect(mSend).toHaveBeenCalledTimes(2)
  expect(res).toMatchObject({ sent: 2, failed: 0 })
  // event-scoped fetch (IDOR guard)
  expect(mRegs).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: { in: [1, 2] }, eventId: 10 }),
  }))
  expect(logAudit).toHaveBeenCalledWith(1, "EVENT_PAYMENT_REMINDER_SENT", "Event", 10, { sent: 2, failed: 0 })
})

test("links each recipient to their own success page via ?ref=<publicToken>", async () => {
  mRegs.mockResolvedValue([pendingRow(1), pendingRow(2)])
  await sendPaymentReminders(10, [{ registrationId: 1 }, { registrationId: 2 }], "Body")
  const urls = mSend.mock.calls.map((c) => c[1].eventUrl)
  expect(urls).toContain("https://app.example.org/e/retreat/success?ref=tok-1")
  expect(urls).toContain("https://app.example.org/e/retreat/success?ref=tok-2")
})

test("skips a row that is no longer PENDING (client stale)", async () => {
  mRegs.mockResolvedValue([{ ...pendingRow(1), paymentStatus: "PAID" }])
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }], "Body")
  expect(mSend).not.toHaveBeenCalled()
  expect(res).toMatchObject({ sent: 0, failed: 1 })
})

test("skips a row with no email", async () => {
  mRegs.mockResolvedValue([{ ...pendingRow(1), email: null }])
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }], "Body")
  expect(mSend).not.toHaveBeenCalled()
  expect(res).toMatchObject({ sent: 0, failed: 1 })
})

test("continues the batch on a send failure and records FAILED without leaking the address", async () => {
  mRegs.mockResolvedValue([pendingRow(1), pendingRow(2)])
  mSend.mockRejectedValueOnce(new Error("SMTP 550 anna@x.org rejected"))
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }, { registrationId: 2 }], "Body")
  expect(res).toMatchObject({ sent: 1, failed: 1 })
  const failWrite = (prisma.paymentReminderSend.create as jest.Mock).mock.calls
    .find((c) => c[0].data.status === "FAILED")
  expect(failWrite[0].data.errorMessage).toBe("Email delivery failed")
  // the raw SMTP error embeds the recipient address — it must never
  // reach the logs. Assert no logged payload contains the email.
  const logged = JSON.stringify((logger.error as jest.Mock).mock.calls)
  expect(logged).not.toContain("anna@x.org")
})

test("dedupes a repeated registrationId and sends only once", async () => {
  mRegs.mockResolvedValue([pendingRow(1)])
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }, { registrationId: 1 }], "Body")
  expect(mSend).toHaveBeenCalledTimes(1)
  expect(res).toMatchObject({ sent: 1, failed: 0 })
})

test("rejects an oversized batch", async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ registrationId: i + 1 }))
  const res = await sendPaymentReminders(10, rows, "Body")
  expect(res).toEqual({ error: "Max 200 per batch" })
})

test("rejects an empty message", async () => {
  expect(await sendPaymentReminders(10, [{ registrationId: 1 }], "")).toHaveProperty("error")
})

test("counts a delivered email as sent even if its SUCCESS tracking write fails, and never aborts the batch", async () => {
  mRegs.mockResolvedValue([pendingRow(1), pendingRow(2)])
  // First SUCCESS-row insert throws; the email already went out, so the row must
  // still count as sent (not misclassified failed) and the batch must continue.
  ;(prisma.paymentReminderSend.create as jest.Mock).mockRejectedValueOnce(new Error("db down"))
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }, { registrationId: 2 }], "Body")
  expect(mSend).toHaveBeenCalledTimes(2)
  expect(res).toMatchObject({ sent: 2, failed: 0 })
  expect(logAudit).toHaveBeenCalledWith(1, "EVENT_PAYMENT_REMINDER_SENT", "Event", 10, { sent: 2, failed: 0 })
})

test("a FAILED-row write error does not abort the batch or skip the audit", async () => {
  mRegs.mockResolvedValue([pendingRow(1), pendingRow(2)])
  mSend.mockRejectedValueOnce(new Error("SMTP 550 rejected")) // reg1 delivery fails
  ;(prisma.paymentReminderSend.create as jest.Mock).mockRejectedValueOnce(new Error("db down")) // FAILED write fails too
  const res = await sendPaymentReminders(10, [{ registrationId: 1 }, { registrationId: 2 }], "Body")
  expect(res).toMatchObject({ sent: 1, failed: 1 })
  expect(logAudit).toHaveBeenCalledWith(1, "EVENT_PAYMENT_REMINDER_SENT", "Event", 10, { sent: 1, failed: 1 })
})

describe("lastRemindedAtByRegistration", () => {
  const mGroupBy = prisma.paymentReminderSend.groupBy as jest.Mock

  test("returns empty and never queries when caller cannot manage the event", async () => {
    mCanManage.mockResolvedValue(false)
    const res = await lastRemindedAtByRegistration(10)
    expect(res).toEqual({})
    expect(mGroupBy).not.toHaveBeenCalled()
  })

  test("maps registrationId to the latest SUCCESS timestamp for an authorised caller", async () => {
    const sentAt = new Date("2026-09-06T02:00:00.000Z")
    mGroupBy.mockResolvedValue([{ registrationId: 7, _max: { sentAt } }])
    const res = await lastRemindedAtByRegistration(10)
    expect(res).toEqual({ 7: sentAt.toISOString() })
  })
})
