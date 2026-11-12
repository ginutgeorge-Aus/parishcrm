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

const prismaMock = {
  fundraiser: { findUnique: jest.fn() },
  fundraiserReminderSend: { create: jest.fn(async () => ({})), aggregate: jest.fn(async () => ({ _max: { sentAt: null } })) },
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
  expect(res).toEqual({ sent: 2, failed: 0, skippedNoEmail: 0 })
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
  expect(res).toEqual({ sent: 1, failed: 0, skippedNoEmail: 2 })
})

test("one send rejection does not abort others; FAILED row logged", async () => {
  setEntries([entry(1), entry(2), entry(3)])
  mSend.mockRejectedValueOnce(new Error("smtp b1@example.org"))
  const res = await sendFundraiserReminders(3)
  expect(res).toEqual({ sent: 2, failed: 1, skippedNoEmail: 0 })
  const rows = prismaMock.fundraiserReminderSend.create.mock.calls.map((c) => (c as unknown as [{ data: E }])[0].data)
  expect(rows.map((r) => r.status)).toEqual(["FAILED", "SUCCESS", "SUCCESS"])
  expect(JSON.stringify(rows)).not.toContain("smtp")
})

test("sentTo stored via encrypt; audit once with counts", async () => {
  setEntries([entry(1)])
  await sendFundraiserReminders(3)
  expect(encrypt).toHaveBeenCalledWith("b1@example.org")
  expect(prismaMock.fundraiserReminderSend.create).toHaveBeenCalledWith({
    data: { entryId: 1, sentTo: "enc:b1@example.org", sentById: 5, status: "SUCCESS", errorMessage: undefined },
  })
  expect(logAudit).toHaveBeenCalledTimes(1)
  expect(logAudit).toHaveBeenCalledWith(expect.anything(), "FUNDRAISER_REMINDERS_SENT", "Fundraiser", 3, { sent: 1, failed: 0, skippedNoEmail: 0 })
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
  expect(await planReminders(3)).toEqual({ sendable: 1, skippedPaid: 1, skippedNoEmail: 1, lastSentAt: when })
})
