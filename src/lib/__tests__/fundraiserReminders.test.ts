/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null), isDemoMode: jest.fn(() => false), DEMO_ERROR: "demo" }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/email", () => ({ sendFundraiserReminderEmail: jest.fn() }))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn(async () => "Example Church") }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn(async () => ({ gstRegistered: false, paymentDetails: "BSB 000-000 Acc 12345678" })) }))
jest.mock("@/lib/cardFeeSettings", () => ({ getCardFeeConfig: jest.fn(async () => ({ pct: 1.7, fixedCents: 30 })) }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: jest.fn(() => true) }))

import { sendFundraiserReminders } from "@/lib/actions/fundraiser"
import { planReminders, resolveRecipient } from "@/lib/fundraiserReminders"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendFundraiserReminderEmail } from "@/lib/email"
import { stripeConfigured } from "@/lib/stripe"

const prismaMock: Record<string, unknown> & {
  fundraiser: { findUnique: jest.Mock }
  fundraiserReminderSend: { create: jest.Mock; update: jest.Mock; count: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock }
  $transaction: jest.Mock
} = {
  fundraiser: { findUnique: jest.fn() },
  fundraiserReminderSend: {
    create: jest.fn(async (a: { data: { entryId: number } }) => ({ id: 100 + a.data.entryId })),
    update: jest.fn(async () => ({})),
    count: jest.fn(async () => 0),
    aggregate: jest.fn(async () => ({ _max: { sentAt: null } })),
    findMany: jest.fn(async () => []),
  },
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prismaMock)),
}
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, k) => (prismaMock as Record<string | symbol, unknown>)[k] }),
}))

const mSend = sendFundraiserReminderEmail as jest.Mock

type E = Record<string, unknown>
function entry(id: number, o: E = {}): E {
  return {
    id, familyId: null, outsideName: `Buyer ${id}`, outsideEmail: `enc:b${id}@example.org`, quantity: 2, unitPrice: "10.00",
    bankRef: `REF-${id}`, publicToken: `tok-${id}`, family: null, payments: [], ...o,
  }
}
function setEntries(entries: E[], event: E = {}) {
  prismaMock.fundraiser.findUnique.mockResolvedValue({
    id: 3, eventId: 7, unitLabel: "Raffle book",
    event: { title: "Spring Raffle", onlinePaymentEnabled: true, passCardFee: true, ...event },
    entries,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTH_URL = "https://app.example.org"
  ;(stripeConfigured as jest.Mock).mockReturnValue(true)
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "ADMIN" } })
  mSend.mockResolvedValue(undefined)
})

test("AUDITOR blocked", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "AUDITOR" } })
  expect(await sendFundraiserReminders(3)).toEqual({ error: "Unauthorized" })
  expect(mSend).not.toHaveBeenCalled()
})

test("skips PAID, OVERPAID and 0-owed; sends to UNPAID and PART", async () => {
  setEntries([
    entry(1, { payments: [{ amount: "20.00" }] }),
    entry(2, { payments: [{ amount: "25.00" }] }),
    entry(3, { quantity: 1, unitPrice: "0.00" }),
    entry(4),
    entry(5, { payments: [{ amount: "5.00" }] }),
  ])
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 2, failed: 0, skippedNoEmail: 0, skippedRecent: 0, deferred: 0 })
  expect(mSend).toHaveBeenCalledTimes(2)
  expect(mSend.mock.calls[1][1]).toMatchObject({ paid: "$5.00", remaining: "$15.00" })
})

test("outside blank email skipped and counted; member without consent skipped", async () => {
  setEntries([
    entry(1, { outsideEmail: null }),
    entry(2, { familyId: 9, outsideName: null, outsideEmail: null, family: { name: "Fam", people: [{ email: "enc:m@example.org", emailConsent: false, role: "HEAD" }] } }),
    entry(3),
  ])
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 1, failed: 0, skippedNoEmail: 2, skippedRecent: 0, deferred: 0 })
})

test("one send rejection does not abort others; FAILED row logged", async () => {
  setEntries([entry(1), entry(2), entry(3)])
  mSend.mockRejectedValueOnce(new Error("smtp b1@example.org"))
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 2, failed: 1, skippedNoEmail: 0, skippedRecent: 0, deferred: 0 })
  const rows = prismaMock.fundraiserReminderSend.update.mock.calls.map((c) => (c as unknown as [{ data: E }])[0].data)
  expect(rows.map((r) => r.status)).toEqual(["FAILED", "SUCCESS", "SUCCESS"])
  expect(JSON.stringify(rows)).not.toContain("smtp")
})

test("sentTo stored via encrypt; audit once with counts", async () => {
  setEntries([entry(1)])
  await sendFundraiserReminders(3)
  expect(encrypt).toHaveBeenCalledWith("b1@example.org")
  expect(prismaMock.fundraiserReminderSend.create).toHaveBeenCalledWith({
    data: { entryId: 1, sentTo: "enc:b1@example.org", sentById: 5, status: "PENDING" },
    select: { id: true },
  })
  expect(prismaMock.fundraiserReminderSend.update).toHaveBeenCalledWith({
    where: { id: 101 }, data: { status: "SUCCESS", errorMessage: undefined },
  })
  expect(logAudit).toHaveBeenCalledTimes(1)
  expect(logAudit).toHaveBeenCalledWith(expect.anything(), "FUNDRAISER_REMINDERS_SENT", "Fundraiser", 3, { sent: 1, failed: 0, skippedNoEmail: 0, skippedRecent: 0, deferred: 0 })
})

test("payUrl and cardFee present when Stripe on, event online and passCardFee", async () => {
  setEntries([entry(1)])
  await sendFundraiserReminders(3)
  expect(mSend.mock.calls[0][1]).toMatchObject({
    payUrl: "https://app.example.org/pay/fundraiser/tok-1",
    bankRef: "REF-1",
    bankDetails: "BSB 000-000 Acc 12345678",
    unitPrice: "$10.00",
  })
  expect(mSend.mock.calls[0][1].cardFee).toMatch(/^\$\d+\.\d\d$/)
})

test("no payUrl or cardFee when Stripe unconfigured; no cardFee when passCardFee off", async () => {
  ;(stripeConfigured as jest.Mock).mockReturnValue(false)
  setEntries([entry(1)])
  await sendFundraiserReminders(3)
  expect(mSend.mock.calls[0][1]).toMatchObject({ payUrl: null, cardFee: null })
  mSend.mockClear()
  ;(stripeConfigured as jest.Mock).mockReturnValue(true)
  setEntries([entry(1)], { passCardFee: false })
  await sendFundraiserReminders(3)
  expect(mSend.mock.calls[0][1]).toMatchObject({ cardFee: null })
  expect(mSend.mock.calls[0][1].payUrl).toContain("/pay/fundraiser/tok-1")
})

test("resolveRecipient prefers head with consent", async () => {
  const e = {
    familyId: 1, outsideEmail: null,
    family: { people: [
      { email: "enc:a@example.org", emailConsent: true, role: "SPOUSE" },
      { email: "enc:h@example.org", emailConsent: true, role: "HEAD" },
    ] },
  }
  expect(await resolveRecipient(e)).toBe("h@example.org")
})

test("resolveRecipient falls back to a valid spouse when the head address is invalid", async () => {
  const e = {
    familyId: 1, outsideEmail: null,
    family: { people: [
      { email: "enc:not-an-email", emailConsent: true, role: "HEAD" },
      { email: "enc:s@example.org", emailConsent: true, role: "SPOUSE" },
    ] },
  }
  expect(await resolveRecipient(e)).toBe("s@example.org")
})

test("loadReminderCandidates only selects non-archived family people", async () => {
  setEntries([entry(1)])
  await planReminders(3)
  const sel = prismaMock.fundraiser.findUnique.mock.calls[0][0].select.entries.select.family.select.people
  expect(sel.where).toEqual({ archivedAt: null })
})

test("card fee in the email uses the checkout surcharge (rounded)", async () => {
  setEntries([entry(1)])
  await sendFundraiserReminders(3)
  const { fundraiserSurchargeCents } = await import("@/lib/fundraiserCheckout")
  const expected = await fundraiserSurchargeCents(2000, true)
  expect(mSend.mock.calls[0][1].cardFee).toBe(`$${(expected / 100).toFixed(2)}`)
})

test("reminder origin falls back to APP_URL like checkout, never NEXTAUTH_URL", async () => {
  Reflect.deleteProperty(process.env, "AUTH_URL")
  process.env.APP_URL = "https://app2.example.org"
  process.env.NEXTAUTH_URL = "https://wrong.example.org"
  setEntries([entry(1)])
  await sendFundraiserReminders(3)
  expect(mSend.mock.calls[0][1].payUrl).toBe("https://app2.example.org/pay/fundraiser/tok-1")
  Reflect.deleteProperty(process.env, "APP_URL")
  Reflect.deleteProperty(process.env, "NEXTAUTH_URL")
})

test("planReminders counts and last-sent date", async () => {
  setEntries([entry(1, { payments: [{ amount: "20.00" }] }), entry(2, { outsideEmail: null }), entry(3)])
  const when = new Date("2026-11-01T00:00:00Z")
  prismaMock.fundraiserReminderSend.aggregate.mockResolvedValueOnce({ _max: { sentAt: when } } as never)
  expect(await planReminders(3)).toEqual({ sendable: 1, skippedPaid: 1, skippedNoEmail: 1, skippedRecent: 0, deferred: 0, lastSentAt: when })
})

test("claims each send Serializable; skips entries reminded within 10 minutes", async () => {
  setEntries([entry(1), entry(2)])
  prismaMock.fundraiserReminderSend.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
  // Frozen clock: the dedupe window is checked exactly, not within a timing tolerance.
  const now = new Date("2026-11-12T01:00:00Z")
  jest.useFakeTimers({ now })
  try {
    const res = await sendFundraiserReminders(3)
    expect(res).toEqual({ sent: 1, failed: 0, skippedNoEmail: 0, skippedRecent: 1, deferred: 0 })
  } finally {
    jest.useRealTimers()
  }
  expect(mSend).toHaveBeenCalledTimes(1)
  expect(mSend.mock.calls[0][0]).toBe("b2@example.org")
  expect(prismaMock.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: "Serializable" })
  const where = prismaMock.fundraiserReminderSend.count.mock.calls[0][0].where
  expect(where).toMatchObject({ entryId: 1, status: { in: ["PENDING", "SUCCESS"] } })
  expect(where.sentAt.gte.getTime()).toBe(now.getTime() - 10 * 60 * 1000)
})

test("offline-only reminder with no bank details configured is refused, nothing sent", async () => {
  ;(stripeConfigured as jest.Mock).mockReturnValue(false)
  const { getInvoiceSettings } = await import("@/lib/invoiceSettings")
  ;(getInvoiceSettings as jest.Mock).mockResolvedValueOnce({ gstRegistered: false, paymentDetails: "   " })
  setEntries([entry(1)])
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ error: expect.stringMatching(/payment details/i) })
  expect(mSend).not.toHaveBeenCalled()
  expect(prismaMock.fundraiserReminderSend.create).not.toHaveBeenCalled()
})

test("a claim lost to a concurrent run (P2034, retried) is skipped, not double-sent", async () => {
  setEntries([entry(1)])
  // First attempt aborts on the SSI conflict; the retry sees the winner's PENDING row.
  prismaMock.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }))
  prismaMock.fundraiserReminderSend.count.mockResolvedValueOnce(1)
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 0, failed: 0, skippedNoEmail: 0, skippedRecent: 1, deferred: 0 })
  expect(mSend).not.toHaveBeenCalled()
})

test("a claim still contended after its retries is retried sequentially and sent, not counted as recent", async () => {
  setEntries([entry(1)])
  const p2034 = () => Object.assign(new Error("conflict"), { code: "P2034" })
  // All 3 attempts of the parallel pass conflict (false positive from a sibling claim).
  prismaMock.$transaction
    .mockRejectedValueOnce(p2034())
    .mockRejectedValueOnce(p2034())
    .mockRejectedValueOnce(p2034())
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 1, failed: 0, skippedNoEmail: 0, skippedRecent: 0, deferred: 0 })
  expect(mSend).toHaveBeenCalledTimes(1)
})

test("a claim contended on the sequential retry too counts as failed, never as recently reminded", async () => {
  setEntries([entry(1)])
  const p2034 = () => Object.assign(new Error("conflict"), { code: "P2034" })
  for (let i = 0; i < 6; i++) prismaMock.$transaction.mockRejectedValueOnce(p2034())
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 0, failed: 1, skippedNoEmail: 0, skippedRecent: 0, deferred: 0 })
  expect(mSend).not.toHaveBeenCalled()
})

test("a claim that cannot be written is not sent untracked", async () => {
  setEntries([entry(1)])
  prismaMock.$transaction.mockRejectedValueOnce(new Error("db down"))
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 0, failed: 1, skippedNoEmail: 0, skippedRecent: 0, deferred: 0 })
  expect(mSend).not.toHaveBeenCalled()
})

test("sends in bounded parallel chunks (at most 5 in flight) and still sends everyone", async () => {
  setEntries(Array.from({ length: 12 }, (_, i) => entry(i + 1)))
  let inFlight = 0
  let peak = 0
  mSend.mockImplementation(async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
  })
  const res = await sendFundraiserReminders(3)
  expect(res).toMatchObject({ sent: 12, failed: 0 })
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(5)
})

test("getReminderPlan returns counts with a formatted last-sent label; non-managers refused", async () => {
  const { getReminderPlan } = await import("@/lib/actions/fundraiser")
  setEntries([entry(1), entry(2, { payments: [{ amount: "20.00" }] })])
  expect(await getReminderPlan(3)).toEqual({ sendable: 1, skippedNoEmail: 0, skippedRecent: 0, deferred: 0, lastSentAt: null })
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "AUDITOR" } })
  expect(await getReminderPlan(3)).toEqual({ error: "Unauthorized" })
})

test("card fee config is read once per run, not per entry", async () => {
  const { getCardFeeConfig } = await import("@/lib/cardFeeSettings")
  setEntries([entry(1), entry(2), entry(3)])
  await sendFundraiserReminders(3)
  expect(getCardFeeConfig).toHaveBeenCalledTimes(1)
})

test("planReminders excludes entries reminded within the dedupe window", async () => {
  setEntries([entry(1), entry(2)])
  prismaMock.fundraiserReminderSend.findMany.mockResolvedValueOnce([{ entryId: 1 }])
  const plan = await planReminders(3)
  expect(plan).toMatchObject({ sendable: 1, skippedRecent: 1, deferred: 0 })
  const where = prismaMock.fundraiserReminderSend.findMany.mock.calls[0][0].where
  expect(where).toMatchObject({ status: { in: ["PENDING", "SUCCESS"] }, entry: { fundraiserId: 3 } })
})

test("a run emails at most REMINDER_MAX_PER_RUN and defers the rest; plan agrees", async () => {
  const { REMINDER_MAX_PER_RUN } = await import("@/lib/fundraiserReminders")
  const n = REMINDER_MAX_PER_RUN + 3
  setEntries(Array.from({ length: n }, (_, i) => entry(i + 1)))
  expect(await planReminders(3)).toMatchObject({ sendable: REMINDER_MAX_PER_RUN, deferred: 3 })
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: REMINDER_MAX_PER_RUN, failed: 0, skippedNoEmail: 0, skippedRecent: 0, deferred: 3 })
  expect(mSend).toHaveBeenCalledTimes(REMINDER_MAX_PER_RUN)
})

test("stops starting new chunks once the time budget is spent", async () => {
  setEntries(Array.from({ length: 12 }, (_, i) => entry(i + 1)))
  jest.useFakeTimers({ now: new Date("2026-11-12T01:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] })
  try {
    // Each send advances the clock past the 45s budget.
    mSend.mockImplementation(async () => { jest.setSystemTime(Date.now() + 60_000) })
    const res = await sendFundraiserReminders(3)
    expect(res).toMatchObject({ sent: 5, deferred: 7 })
  } finally {
    jest.useRealTimers()
  }
})

test("recently reminded entries do not burn cap slots", async () => {
  const { REMINDER_MAX_PER_RUN } = await import("@/lib/fundraiserReminders")
  const recent = 10
  setEntries(Array.from({ length: REMINDER_MAX_PER_RUN + recent }, (_, i) => entry(i + 1)))
  prismaMock.fundraiserReminderSend.findMany.mockResolvedValue(Array.from({ length: recent }, (_, i) => ({ entryId: i + 1 })))
  const res = await sendFundraiserReminders(3)
  prismaMock.fundraiserReminderSend.findMany.mockResolvedValue([])
  expect(res).toEqual({ sent: REMINDER_MAX_PER_RUN, failed: 0, skippedNoEmail: 0, skippedRecent: recent, deferred: 0 })
})
