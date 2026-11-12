/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    groupMessage: { findUnique: jest.fn(), findMany: jest.fn() },
    groupMessageRecipient: { updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    person: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Test Church" })) }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), isAmbiguousDeliveryError: jest.fn(() => false) }))

import { prisma } from "@/lib/prisma"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import {
  claimGroupRecipient, deliverGroupMessage, renderGroupMessageText, runGroupMessageSweep, MAX_DELIVERY_ATTEMPTS,
} from "@/lib/groupMessageDeliver"

const p = prisma as unknown as {
  groupMessage: { findUnique: jest.Mock; findMany: jest.Mock }
  groupMessageRecipient: { updateMany: jest.Mock; update: jest.Mock; findMany: jest.Mock }
  person: { findUnique: jest.Mock }
}
const send = sendEmail as jest.Mock
const statuses = () => p.groupMessageRecipient.update.mock.calls.map((c) => c[0].data.status)

beforeEach(() => {
  jest.clearAllMocks()
  p.groupMessage.findUnique.mockResolvedValue({ subject: "Hi", body: "Rehearsal at 7", group: { name: "Choir" } })
  p.groupMessageRecipient.findMany.mockResolvedValue([{ id: 11, personId: 1 }])
  p.groupMessageRecipient.updateMany.mockResolvedValue({ count: 1 })
  p.groupMessageRecipient.update.mockResolvedValue({})
  p.person.findUnique.mockResolvedValue({ firstName: "Ann", email: "enc:ann@example.com", emailConsent: true, archivedAt: null })
  send.mockResolvedValue(undefined)
  ;(isAmbiguousDeliveryError as jest.Mock).mockReturnValue(false)
})

describe("renderGroupMessageText", () => {
  it("greets by first name and brands with group + church", () => {
    expect(renderGroupMessageText("Ann", "  Body  ", "Choir", "Test Church")).toBe("Hello Ann,\n\nBody\n\n—\nChoir\nTest Church")
  })
})

describe("claimGroupRecipient", () => {
  it("claims only queued/stale-PENDING/retryable-FAILED rows with attempts left", async () => {
    const now = new Date("2026-11-13T00:00:00Z")
    expect(await claimGroupRecipient(5, now)).toBe(true)
    const arg = p.groupMessageRecipient.updateMany.mock.calls[0][0]
    expect(arg.where.attempts).toEqual({ lt: MAX_DELIVERY_ATTEMPTS })
    expect(arg.where.OR).toEqual([
      { status: "FAILED" },
      { status: "PENDING", OR: [{ claimedAt: null }, { claimedAt: { lt: new Date("2026-11-12T23:50:00Z") } }] },
    ])
    expect(arg.data.attempts).toEqual({ increment: 1 })
  })
  it("loses when the row is SENT/UNKNOWN or held by a fresh claim (count 0)", async () => {
    p.groupMessageRecipient.updateMany.mockResolvedValue({ count: 0 })
    expect(await claimGroupRecipient(5)).toBe(false)
  })
})

describe("deliverGroupMessage", () => {
  it("SENT: delivers with plain text + html and records SENT", async () => {
    const c = await deliverGroupMessage(1)
    expect(c).toEqual({ sent: 1, failed: 0, unknown: 0, inFlight: 0 })
    expect(send).toHaveBeenCalledWith("ann@example.com", "Hi", expect.stringContaining("Rehearsal at 7"), expect.stringContaining("Test Church"))
    expect(statuses()).toEqual(["SENT"])
  })

  it("FAILED (retryable): clean pre-delivery error", async () => {
    send.mockRejectedValue(new Error("535 auth"))
    expect(await deliverGroupMessage(1)).toMatchObject({ sent: 0, failed: 1, unknown: 0 })
    expect(statuses()).toEqual(["FAILED"])
  })

  it("UNKNOWN (terminal): ambiguous post-submission error", async () => {
    send.mockRejectedValue(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
    ;(isAmbiguousDeliveryError as jest.Mock).mockReturnValue(true)
    expect(await deliverGroupMessage(1)).toMatchObject({ unknown: 1, failed: 0 })
    expect(statuses()).toEqual(["UNKNOWN"])
  })

  it("UNKNOWN: delivered but the SENT write fails, never a retryable FAILED", async () => {
    p.groupMessageRecipient.update.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({})
    expect(await deliverGroupMessage(1)).toMatchObject({ unknown: 1, sent: 0, failed: 0 })
    expect(statuses()).toEqual(["SENT", "UNKNOWN"])
  })

  it("lost claim: not sent, counted in flight", async () => {
    p.groupMessageRecipient.updateMany.mockResolvedValue({ count: 0 })
    expect(await deliverGroupMessage(1)).toMatchObject({ sent: 0, inFlight: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ["opted out since queueing", { emailConsent: false }],
    ["archived since queueing", { archivedAt: new Date() }],
    ["address removed", { email: null }],
  ])("terminal FAILED without sending when the person is %s", async (_n, patch) => {
    p.person.findUnique.mockResolvedValue({ firstName: "Ann", email: "enc:ann@example.com", emailConsent: true, archivedAt: null, ...patch })
    expect(await deliverGroupMessage(1)).toMatchObject({ failed: 1, sent: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(p.groupMessageRecipient.update.mock.calls[0][0].data).toEqual({ status: "FAILED", attempts: MAX_DELIVERY_ATTEMPTS })
  })

  it("only selects PENDING/FAILED recipients with attempts left (SENT/UNKNOWN never reclaimed)", async () => {
    await deliverGroupMessage(1)
    expect(p.groupMessageRecipient.findMany.mock.calls[0][0].where).toEqual({
      messageId: 1, status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_DELIVERY_ATTEMPTS },
    })
  })

  it("no-ops for a missing message", async () => {
    p.groupMessage.findUnique.mockResolvedValue(null)
    expect(await deliverGroupMessage(9)).toEqual({ sent: 0, failed: 0, unknown: 0, inFlight: 0 })
  })
})

describe("runGroupMessageSweep", () => {
  it("drains each recent message with open recipients and sums the counts", async () => {
    p.groupMessage.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
    const r = await runGroupMessageSweep(new Date("2026-11-13T00:00:00Z"))
    expect(r).toEqual({ sent: 2, failed: 0, unknown: 0, inFlight: 0, messages: 2 })
  })
})
