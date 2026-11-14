/** @jest-environment node */
import { PrayerRequestSource } from "@/lib/generated/prisma/enums"

jest.mock("@/lib/prisma", () => {
  const m = { prayerRequest: { create: jest.fn() }, $transaction: jest.fn() }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn().mockReturnValue(true) }))
jest.mock("next/headers", () => ({ headers: () => Promise.resolve(new Map([["x-forwarded-for", "203.0.113.9"]])) }))

import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { rateLimit } from "@/lib/rateLimit"
import { submitPublicPrayerRequest } from "@/lib/actions/publicPrayerRequest"

const create = (prisma as unknown as { prayerRequest: { create: jest.Mock } }).prayerRequest.create

beforeEach(() => {
  jest.clearAllMocks()
  create.mockResolvedValue({ id: 7 })
  ;(dbRateLimit as jest.Mock).mockResolvedValue(true)
  ;(rateLimit as jest.Mock).mockReturnValue(true)
})

describe("submitPublicPrayerRequest", () => {
  it("creates a private PUBLIC_FORM request with encrypted text and contact", async () => {
    const r = await submitPublicPrayerRequest({
      request: "  Healing for my mother ",
      requesterName: "Sam",
      requesterEmail: "sam@example.com",
      requesterPhone: "0400111222",
    })
    expect(r).toEqual({ success: expect.stringContaining("Thank you") })
    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({
      source: PrayerRequestSource.PUBLIC_FORM,
      request: "enc:Healing for my mother",
      requesterName: "enc:Sam",
      requesterEmail: "enc:sam@example.com",
      requesterPhone: "enc:0400111222",
      shareConsent: false,
      shareConsentAt: null,
    })
    expect(data.personId).toBeUndefined()
    // Audit row: no actor, flags only (no text, no contact).
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), null, "PRAYER_REQUEST_CREATED", "PrayerRequest", 7, {
      source: "PUBLIC_FORM",
      shareConsent: false,
    })
  })

  it("name and contact are optional", async () => {
    await submitPublicPrayerRequest({ request: "Peace" })
    expect(create.mock.calls[0][0].data).toMatchObject({ requesterName: null, requesterEmail: null, requesterPhone: null })
  })

  it("records consent when ticked", async () => {
    await submitPublicPrayerRequest({ request: "Thanks", shareConsent: true })
    const data = create.mock.calls[0][0].data
    expect(data.shareConsent).toBe(true)
    expect(data.shareConsentAt).toBeInstanceOf(Date)
  })

  it("silently drops a filled honeypot: success text, nothing stored, no quota spent", async () => {
    const r = await submitPublicPrayerRequest({ request: "Buy pills", website: "http://spam" })
    expect(r).toEqual({ success: expect.stringContaining("Thank you") })
    expect(create).not.toHaveBeenCalled()
    expect(dbRateLimit).not.toHaveBeenCalled()
  })

  it("returns an error once the per-IP quota is used", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(false)
    const r = await submitPublicPrayerRequest({ request: "Again" })
    expect(r).toEqual({ error: "Too many submissions. Please try again later." })
    expect(create).not.toHaveBeenCalled()
    expect(dbRateLimit).toHaveBeenCalledWith("prayer:ip:203.0.113.9", 5, 60 * 60 * 1000)
  })

  it("returns an error when the in-memory throttle trips, before any DB work", async () => {
    ;(rateLimit as jest.Mock).mockReturnValueOnce(false)
    const r = await submitPublicPrayerRequest({ request: "Flood" })
    expect(r).toEqual({ error: "Too many submissions. Please try again later." })
    expect(dbRateLimit).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    [{ request: "   " }, "Enter your prayer request"],
    [{ request: "x".repeat(4001) }, "Request must be 4000 characters or fewer"],
    [{ request: "ok", requesterEmail: "not-an-email" }, "Enter a valid email"],
  ])("rejects invalid input %#", async (input, message) => {
    expect(await submitPublicPrayerRequest(input)).toEqual({ error: message })
    expect(create).not.toHaveBeenCalled()
    expect(dbRateLimit).not.toHaveBeenCalled()
  })
})
