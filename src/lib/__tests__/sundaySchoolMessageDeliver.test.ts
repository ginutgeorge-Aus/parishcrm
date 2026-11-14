/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    sundaySchoolMessage: { findUnique: jest.fn(), findMany: jest.fn() },
    sundaySchoolMessageRecipient: { updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    person: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Test Church" })) }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), isAmbiguousDeliveryError: jest.fn(() => false) }))

import { prisma } from "@/lib/prisma"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { MAX_DELIVERY_ATTEMPTS } from "@/lib/groupMessageDeliver"
import { claimSsRecipient, deliverSsMessage, runSsMessageSweep } from "@/lib/sundaySchoolMessageDeliver"

const p = prisma as unknown as {
  sundaySchoolMessage: { findUnique: jest.Mock; findMany: jest.Mock }
  sundaySchoolMessageRecipient: { updateMany: jest.Mock; update: jest.Mock; findMany: jest.Mock }
  person: { findUnique: jest.Mock }
}
const send = sendEmail as jest.Mock
const updates = () => p.sundaySchoolMessageRecipient.update.mock.calls.map((c) => c[0].data)

beforeEach(() => {
  jest.clearAllMocks()
  p.sundaySchoolMessage.findUnique.mockResolvedValue({ subject: "No class", body: "See you next week", class: { name: "Year 3" } })
  p.sundaySchoolMessageRecipient.findMany.mockResolvedValue([{ id: 11, personId: 1, status: "PENDING", claimedAt: null }])
  p.sundaySchoolMessageRecipient.updateMany.mockResolvedValue({ count: 1 })
  p.sundaySchoolMessageRecipient.update.mockResolvedValue({})
  p.person.findUnique.mockResolvedValue({ firstName: "Ann", email: "enc:ann@example.com", emailConsent: true, archivedAt: null, role: "HEAD" })
  send.mockResolvedValue(undefined)
  ;(isAmbiguousDeliveryError as jest.Mock).mockReturnValue(false)
})

describe("claimSsRecipient", () => {
  it("closes a stale claim as UNKNOWN, then claims only queued PENDING or retryable FAILED", async () => {
    expect(await claimSsRecipient(5)).toBe(true)
    expect(p.sundaySchoolMessageRecipient.updateMany.mock.calls[0][0].data).toEqual({ status: "UNKNOWN" })
    const arg = p.sundaySchoolMessageRecipient.updateMany.mock.calls[1][0]
    expect(arg.where).toEqual({ id: 5, OR: [{ status: "FAILED", attempts: { lt: MAX_DELIVERY_ATTEMPTS } }, { status: "PENDING", claimedAt: null }] })
    expect(arg.data.attempts).toEqual({ increment: 1 })
  })

  it("loses when another pass holds the row", async () => {
    p.sundaySchoolMessageRecipient.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 })
    expect(await claimSsRecipient(5)).toBe(false)
  })
})

describe("deliverSsMessage", () => {
  it("sends greeting the parent, signs with class + church, records SENT", async () => {
    expect(await deliverSsMessage(7)).toEqual({ sent: 1, failed: 0, unknown: 0, inFlight: 0 })
    expect(send).toHaveBeenCalledWith("ann@example.com", "No class", expect.any(String), "Hello Ann,\n\nSee you next week\n\n—\nYear 3\nTest Church")
    expect(updates()).toEqual([{ status: "SENT" }])
  })

  it("clean send failure is retryable FAILED; ambiguous is terminal UNKNOWN", async () => {
    send.mockRejectedValueOnce(new Error("refused"))
    expect((await deliverSsMessage(7)).failed).toBe(1)
    expect(updates()).toEqual([{ status: "FAILED" }])
    jest.clearAllMocks()
    send.mockRejectedValueOnce(new Error("timeout"))
    ;(isAmbiguousDeliveryError as jest.Mock).mockReturnValue(true)
    expect((await deliverSsMessage(7)).unknown).toBe(1)
  })

  it.each([
    ["opted out", { emailConsent: false }],
    ["archived", { archivedAt: new Date() }],
    ["no longer a parent", { role: "CHILD" }],
    ["address gone", { email: null }],
  ])("a parent %s since queueing is closed as terminal FAILED without sending", async (_n, patch) => {
    p.person.findUnique.mockResolvedValue({ firstName: "Ann", email: "enc:ann@example.com", emailConsent: true, archivedAt: null, role: "HEAD", ...patch })
    await deliverSsMessage(7)
    expect(send).not.toHaveBeenCalled()
    expect(updates()).toEqual([{ status: "FAILED", attempts: MAX_DELIVERY_ATTEMPTS }])
  })

  it("SENT write failing after delivery marks UNKNOWN (never resent)", async () => {
    p.sundaySchoolMessageRecipient.update.mockRejectedValueOnce(new Error("db")).mockResolvedValue({})
    expect((await deliverSsMessage(7)).unknown).toBe(1)
    expect(updates()).toEqual([{ status: "SENT" }, { status: "UNKNOWN" }])
  })

  it("stops after 3 consecutive clean failures (SMTP down)", async () => {
    p.sundaySchoolMessageRecipient.findMany.mockResolvedValue([1, 2, 3, 4].map((id) => ({ id, personId: id, status: "PENDING", claimedAt: null })))
    send.mockRejectedValue(new Error("down"))
    const c = await deliverSsMessage(7)
    expect(c.aborted).toBe(true)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it("missing message is a no-op", async () => {
    p.sundaySchoolMessage.findUnique.mockResolvedValue(null)
    expect(await deliverSsMessage(7)).toEqual({ sent: 0, failed: 0, unknown: 0, inFlight: 0 })
  })
})

describe("runSsMessageSweep", () => {
  it("drains recent messages with open recipients and sums the counts", async () => {
    p.sundaySchoolMessage.findMany.mockResolvedValue([{ id: 7 }, { id: 8 }])
    const now = new Date("2026-11-14T00:00:00Z")
    expect(await runSsMessageSweep(now)).toEqual({ sent: 2, failed: 0, unknown: 0, inFlight: 0, messages: 2 })
    expect(p.sundaySchoolMessage.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: new Date("2026-11-07T00:00:00Z") })
  })
})
