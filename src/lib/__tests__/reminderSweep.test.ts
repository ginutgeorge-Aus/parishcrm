jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: jest.fn(), updateMany: jest.fn() },
  },
}))
jest.mock("@/lib/email", () => ({ sendEventReminderEmail: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: (v: string) => `dec:${v}` }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))

import { sendDueReminders } from "@/lib/reminderSweep"
import { prisma } from "@/lib/prisma"
import { sendEventReminderEmail } from "@/lib/email"

const findMany = prisma.event.findMany as jest.Mock
const updateMany = prisma.event.updateMany as jest.Mock
const send = sendEventReminderEmail as jest.Mock

const now = new Date("2026-07-13T09:00:00Z")

const dueEvent = {
  id: 1,
  title: "Carols",
  kind: "one_off",
  isPublished: true,
  reminderDaysBefore: 3,
  reminderSentAt: null,
  reminderClaimedAt: null,
  date: new Date("2026-07-15T09:00:00Z"), // 2 days after now → due
  location: "Hall",
  registrations: [
    { firstName: "Ann", lastName: "B", email: "e1" },
    { firstName: "Cy", lastName: "D", email: "e2" },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = "s3cret"
  // Wall clock == request time unless a test advances it.
  jest.spyOn(Date, "now").mockReturnValue(now.getTime())
})
afterEach(() => jest.restoreAllMocks())

it("fail-closes (503) + logs when CRON_SECRET is unset", async () => {
  delete process.env.CRON_SECRET
  const err = jest.spyOn(console, "error").mockImplementation(() => {})
  const res = await sendDueReminders("Bearer whatever", now)
  expect(res).toEqual({ status: 503, body: { error: "CRON_SECRET unset — reminders disabled" } })
  expect(findMany).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalled()
  err.mockRestore()
})

it("401s on missing bearer", async () => {
  expect((await sendDueReminders(null, now)).status).toBe(401)
})

it("401s on wrong bearer", async () => {
  expect((await sendDueReminders("Bearer nope", now)).status).toBe(401)
})

it("sends to every registration of a due event, claims a lease, then sets the durable sent marker", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 1 })
  const res = await sendDueReminders("Bearer s3cret", now)
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ eventsReminded: 1, emailsSent: 2, emailsFailed: 0 })
  expect(send).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenCalledWith("dec:e1", expect.objectContaining({ firstName: "Ann", eventTitle: "Carols" }))
  // Claim: a recoverable lease, not the durable marker.
  expect(updateMany).toHaveBeenNthCalledWith(1, {
    where: {
      id: 1,
      reminderSentAt: null,
      OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } }],
    },
    data: { reminderClaimedAt: now },
  })
  // Durable marker set only after delivery work completes, lease released.
  expect(updateMany).toHaveBeenNthCalledWith(2, {
    where: { id: 1, reminderClaimedAt: now },
    data: { reminderSentAt: now, reminderClaimedAt: null },
  })
  expect(updateMany).toHaveBeenCalledTimes(2)
})

it(" retries the durable sent-marker write on a transient DB error so a blip can't strand delivery for resend", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany
    .mockResolvedValueOnce({ count: 1 }) // claim
    .mockRejectedValueOnce(new Error("db blip")) // marker attempt 1 fails
    .mockResolvedValueOnce({ count: 1 }) // marker attempt 2 succeeds
  send.mockResolvedValue(undefined)

  const res = await sendDueReminders("Bearer s3cret", now)

  expect(res.body).toEqual({ eventsReminded: 1, emailsSent: 2, emailsFailed: 0 })
  // claim + marker(fail) + marker(retry) = 3 writes; last carries the durable marker.
  expect(updateMany).toHaveBeenCalledTimes(3)
  expect(updateMany).toHaveBeenLastCalledWith({
    where: { id: 1, reminderClaimedAt: now },
    data: { reminderSentAt: now, reminderClaimedAt: null },
  })
})

it(" loud-logs and does not count the event when the lease was reclaimed before the durable marker", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany
    .mockResolvedValueOnce({ count: 1 }) // claim
    .mockResolvedValueOnce({ count: 0 }) // marker: another sweep reclaimed the stale lease
  const err = jest.spyOn(console, "error").mockImplementation(() => {})
  const res = await sendDueReminders("Bearer s3cret", now)
  expect(res.body).toEqual({ eventsReminded: 0, emailsSent: 2, emailsFailed: 0 })
  expect(updateMany).toHaveBeenCalledTimes(2)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/lease lost before the durable sent marker/))
  err.mockRestore()
})

it(" loud-logs and does not throw when the durable marker write keeps failing", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany
    .mockResolvedValueOnce({ count: 1 }) // claim
    .mockRejectedValue(new Error("db down")) // every marker attempt fails
  send.mockResolvedValue(undefined)
  const err = jest.spyOn(console, "error").mockImplementation(() => {})

  const res = await sendDueReminders("Bearer s3cret", now)

  expect(res.status).toBe(200) // sweep completes, doesn't abort remaining events
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/marker|durable|sent/i))
  err.mockRestore()
})

it("skips an event that isReminderDue rejects (already reminded) — no send, no mark", async () => {
  findMany.mockResolvedValue([{ ...dueEvent, reminderSentAt: new Date() }])
  const res = await sendDueReminders("Bearer s3cret", now)
  expect(res.body).toEqual({ eventsReminded: 0, emailsSent: 0, emailsFailed: 0 })
  expect(send).not.toHaveBeenCalled()
  expect(updateMany).not.toHaveBeenCalled()
})

it("counts a failed send but still sets the durable marker (partial delivery)", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 1 })
  send.mockRejectedValueOnce(new Error("smtp")).mockResolvedValueOnce(undefined)
  jest.spyOn(console, "error").mockImplementation(() => {})
  const res = await sendDueReminders("Bearer s3cret", now)
  expect(res.body).toEqual({ eventsReminded: 1, emailsSent: 1, emailsFailed: 1 })
  // claim + durable-mark = 2 calls (no release, partial success keeps it).
  expect(updateMany).toHaveBeenCalledTimes(2)
  expect(updateMany).toHaveBeenLastCalledWith({
    where: { id: 1, reminderClaimedAt: now },
    data: { reminderSentAt: now, reminderClaimedAt: null },
  })
})

it("logs a structured line on partial delivery failure", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 1 })
  // One of two registrations bounces → partial failure (durable marker still set).
  send.mockRejectedValueOnce(new Error("smtp")).mockResolvedValueOnce(undefined)
  const err = jest.spyOn(console, "error").mockImplementation(() => {})
  const res = await sendDueReminders("Bearer s3cret", now)
  expect(res.body).toEqual({ eventsReminded: 1, emailsSent: 1, emailsFailed: 1 })
  // The partial-failure branch surfaced it (previously silent on 200).
  expect(err).toHaveBeenCalledWith(
    expect.stringContaining("partial reminder delivery — 1 sent, 1 failed")
  )
  err.mockRestore()
})

it("releases the lease (not a durable marker, since none was set) for retry when every send fails", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 1 })
  send.mockRejectedValueOnce(new Error("smtp")).mockRejectedValueOnce(new Error("smtp")) // both registrations fail
  jest.spyOn(console, "error").mockImplementation(() => {})
  const res = await sendDueReminders("Bearer s3cret", now)
  // Nothing delivered → not counted as reminded.
  expect(res.body).toEqual({ eventsReminded: 0, emailsSent: 0, emailsFailed: 2 })
  // Two updateMany calls: the claim, then the lease release (reminderSentAt
  // is never touched — it was never set before delivery, matching).
  expect(updateMany).toHaveBeenCalledTimes(2)
  expect(updateMany).toHaveBeenLastCalledWith({
    where: { id: 1, reminderClaimedAt: now },
    data: { reminderClaimedAt: null },
  })
})

it("does not double-send when a second overlapping run's claim loses the race", async () => {
  // Both "runs" see the same not-yet-marked event via findMany (the race
  // window this bug exploited). The first run's atomic claim (updateMany
  // conditioned on no active/stale lease) matches and takes the lease; the
  // second run's identical claim now matches 0 rows and must skip sending.
  findMany.mockResolvedValue([dueEvent])
  updateMany
    .mockResolvedValueOnce({ count: 1 }) // run 1 wins the claim
    .mockResolvedValueOnce({ count: 1 }) // run 1's durable-mark update
    .mockResolvedValueOnce({ count: 0 }) // run 2 loses the claim — already leased/sent

  const run1 = await sendDueReminders("Bearer s3cret", now)
  const run2 = await sendDueReminders("Bearer s3cret", now)

  expect(run1.body).toEqual({ eventsReminded: 1, emailsSent: 2, emailsFailed: 0 })
  expect(run2.body).toEqual({ eventsReminded: 0, emailsSent: 0, emailsFailed: 0 })
  // Only run 1's 2 registrations were ever emailed — no duplicate sends.
  expect(send).toHaveBeenCalledTimes(2)
})

it(" a crash mid-send-loop (uncaught synchronous throw) leaves the lease claimed but never sets the durable sent marker", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 1 }) // claim succeeds
  // Simulate a crash: sendEventReminderEmail throws synchronously (not a
  // rejected promise), which escapes chunk.map() before Promise.allSettled
  // can wrap it — mirroring an unhandled exception/timeout mid-loop.
  send.mockImplementationOnce(() => {
    throw new Error("simulated crash")
  })

  await expect(sendDueReminders("Bearer s3cret", now)).rejects.toThrow("simulated crash")

  // Only the claim ran — the durable reminderSentAt marker was never set,
  // because the crash happened before delivery work completed.
  expect(updateMany).toHaveBeenCalledTimes(1)
  expect(updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { reminderClaimedAt: now } })
  )
})

it(" a later sweep reclaims a stale lease left by a crashed run and delivers", async () => {
  const staleClaimedAt = new Date(now.getTime() - 11 * 60 * 1000) // past the 10-min lease
  findMany.mockResolvedValue([{ ...dueEvent, reminderClaimedAt: staleClaimedAt }])
  updateMany.mockResolvedValue({ count: 1 })

  const res = await sendDueReminders("Bearer s3cret", now)

  expect(res.body).toEqual({ eventsReminded: 1, emailsSent: 2, emailsFailed: 0 })
  expect(send).toHaveBeenCalledTimes(2)
  // The claim's WHERE allows a stale (past-lease) reminderClaimedAt through.
  expect(updateMany).toHaveBeenNthCalledWith(1, {
    where: {
      id: 1,
      reminderSentAt: null,
      OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } }],
    },
    data: { reminderClaimedAt: now },
  })
})

it(" an active (non-stale) lease held by an in-flight run is not reclaimed", async () => {
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 0 }) // the DB WHERE clause itself rejects the still-active lease
  const res = await sendDueReminders("Bearer s3cret", now)
  expect(res.body).toEqual({ eventsReminded: 0, emailsSent: 0, emailsFailed: 0 })
  expect(send).not.toHaveBeenCalled()
})

describe(" lease renewal across a long send loop", () => {
  const bigEvent = {
    ...dueEvent,
    registrations: Array.from({ length: 25 }, (_, i) => ({ firstName: `F${i}`, lastName: "L", email: `e${i}` })),
  }

  it("renews the lease before each later chunk and fences the durable mark on the latest lease", async () => {
    findMany.mockResolvedValue([bigEvent])
    updateMany.mockResolvedValue({ count: 1 })
    const res = await sendDueReminders("Bearer s3cret", now)
    expect(res.body).toEqual({ eventsReminded: 1, emailsSent: 25, emailsFailed: 0 })
    // claim + 2 renewals (chunks 2 and 3 of 10/10/5) + durable mark.
    expect(updateMany).toHaveBeenCalledTimes(4)
    const renew1 = updateMany.mock.calls[1][0]
    const renew2 = updateMany.mock.calls[2][0]
    expect(renew1.where).toEqual({ id: 1, reminderSentAt: null, reminderClaimedAt: now })
    expect(renew1.data.reminderClaimedAt.getTime()).toBeGreaterThan(now.getTime())
    expect(renew2.where.reminderClaimedAt).toEqual(renew1.data.reminderClaimedAt)
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 1, reminderClaimedAt: renew2.data.reminderClaimedAt },
      data: { reminderSentAt: now, reminderClaimedAt: null },
    })
  })

  it("stops sending and never marks sent once another run has reclaimed the lease", async () => {
    findMany.mockResolvedValue([bigEvent])
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }) // renewal before chunk 2 — lease lost
    const err = jest.spyOn(console, "error").mockImplementation(() => {})
    const res = await sendDueReminders("Bearer s3cret", now)
    expect(send).toHaveBeenCalledTimes(10) // chunk 1 only
    expect(updateMany).toHaveBeenCalledTimes(2) // no durable mark — the reclaiming run owns it
    expect(res.body).toEqual({ eventsReminded: 0, emailsSent: 10, emailsFailed: 0 })
    expect(err).toHaveBeenCalledWith(expect.stringContaining("lease lost"))
    err.mockRestore()
  })
})

it(" claims each event with a fresh wall-clock lease, not the request-start time", async () => {
  // Sweep started 15 min ago (slow earlier events) — a `now`-stamped claim
  // would already be past REMINDER_LEASE_MS and instantly reclaimable.
  const later = now.getTime() + 15 * 60 * 1000
  ;(Date.now as jest.Mock).mockReturnValue(later)
  findMany.mockResolvedValue([dueEvent])
  updateMany.mockResolvedValue({ count: 1 })
  await sendDueReminders("Bearer s3cret", now)
  expect(updateMany).toHaveBeenNthCalledWith(1, {
    where: {
      id: 1,
      reminderSentAt: null,
      OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: new Date(later - 10 * 60 * 1000) } }],
    },
    data: { reminderClaimedAt: new Date(later) },
  })
  expect(updateMany).toHaveBeenLastCalledWith({
    where: { id: 1, reminderClaimedAt: new Date(later) },
    data: { reminderSentAt: now, reminderClaimedAt: null },
  })
})
