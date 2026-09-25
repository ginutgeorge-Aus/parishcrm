/** @jest-environment node */
import { submitMembershipApplication } from "@/lib/actions/membership"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({ prisma: { membershipApplication: { create: jest.fn().mockResolvedValue({ id: 1 }) } } }))
jest.mock("@/lib/turnstile", () => ({ verifyTurnstile: jest.fn().mockResolvedValue(true) }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))
jest.mock("@/lib/email", () => ({ sendMembershipNotificationEmail: jest.fn().mockResolvedValue(undefined) }))
// pdfkit is heavy and irrelevant to the action's validation logic; stub the
// renderer so the fire-and-forget PDF build doesn't run real pdfkit in tests.
jest.mock("@/lib/pdf/MembershipPdf", () => ({ renderMembershipPdf: jest.fn().mockResolvedValue(Buffer.from("%PDF")) }))
// membership.ts imports @/auth (for approve/reject); mock it so next-auth ESM
// isn't require()'d when this suite loads the module.
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null }) }))
jest.mock("@/lib/letterSettings", () => ({ getLetterSettings: jest.fn().mockResolvedValue({ signerTitle: "" }) }))
jest.mock("next/headers", () => ({ headers: () => Promise.resolve(new Map([["x-forwarded-for", "203.0.113.9"]])) }))

const validPayload = {
  personal: { name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com",
    mobile: "0400111222", address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000",
    qualificationProfession: "Engineer", motherParish: "Grace", addressInIndia: "Chennai",
    dateOfArrivalNsw: "2015-03-01", maritalStatus: "MARRIED", transferCertFurnished: true },
  spouse: { name: "Mary Miller", dateOfBirth: "1982-05-06", dateOfMarriage: "2005-06-07", parish: "Grace", working: true, email: "mary@example.com" },
  children: [{ name: "Anna Miller", sex: "F", dateOfBirth: "2010-01-01", occupation: null, phoneEmail: null }],
  dependents: [],
  relativesInAustralia: [{ name: "Sam", place: "Sydney", relationship: "Brother", phoneEmail: "sam@x.com" }],
  subscription: { monthlyAmount: 80 },
  declaration: { place: "Springfield", date: "2026-07-09" },
}
const sig = "data:image/png;base64,AAAA"

beforeEach(() => jest.clearAllMocks())

it("rejects when honeypot filled", async () => {
  const r = await submitMembershipApplication({ payload: validPayload, signature: sig, website: "bot" })
  expect(r).toEqual({ error: "Submission failed" })
  expect(prisma.membershipApplication.create).not.toHaveBeenCalled()
})
it("rejects invalid payload", async () => {
  const r = await submitMembershipApplication({ payload: { personal: {} }, signature: sig })
  expect(r && "error" in r).toBe(true)
  expect(prisma.membershipApplication.create).not.toHaveBeenCalled()
})
it("rejects missing signature", async () => {
  const r = await submitMembershipApplication({ payload: validPayload, signature: "" })
  expect(r).toEqual({ error: "Signature is required" })
})
it("rejects oversized signature", async () => {
  const r = await submitMembershipApplication({ payload: validPayload, signature: "data:image/png;base64," + "A".repeat(400_000) })
  expect(r && "error" in r).toBe(true)
})
it("fails Turnstile", async () => {
  const { verifyTurnstile } = await import("@/lib/turnstile")
  ;(verifyTurnstile as jest.Mock).mockResolvedValueOnce(false)
  const r = await submitMembershipApplication({ payload: validPayload, signature: sig, turnstileToken: "x" })
  expect(r).toEqual({ error: "Verification failed. Please try again." })
})
it("rate-limited", async () => {
  const { dbRateLimit } = await import("@/lib/dbRateLimit")
  ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(false)
  const r = await submitMembershipApplication({ payload: validPayload, signature: sig })
  expect(r).toEqual({ error: "Too many submissions. Please try again later." })
})
it("creates encrypted application on success", async () => {
  const r = await submitMembershipApplication({ payload: validPayload, signature: sig })
  expect(r).toEqual({ success: expect.any(String) })
  const arg = (prisma.membershipApplication.create as jest.Mock).mock.calls[0][0].data
  expect(arg.payload).not.toContain("John Miller")
  expect(arg.email).not.toBe("john@example.com")
  expect(arg.emailHash).toBeTruthy()
  expect(arg.applicantName).toBe("John Miller")
  expect(arg.mobile).not.toBe("0400111222")
  expect(arg.mobileHash).toBeTruthy()
})
it("sets mobile/mobileHash null when no mobile is provided", async () => {
  const r = await submitMembershipApplication({ payload: { ...validPayload, personal: { ...validPayload.personal, mobile: null } }, signature: sig })
  expect(r).toEqual({ success: expect.any(String) })
  const arg = (prisma.membershipApplication.create as jest.Mock).mock.calls[0][0].data
  expect(arg.mobile).toBeNull()
  expect(arg.mobileHash).toBeNull()
})
it("emails the secretary the rendered application PDF", async () => {
  const { renderMembershipPdf } = await import("@/lib/pdf/MembershipPdf")
  const { sendMembershipNotificationEmail } = await import("@/lib/email")
  await submitMembershipApplication({ payload: validPayload, signature: sig })
  // Email is fire-and-forget — let the queued microtasks/IIFE settle.
  await new Promise((r) => setImmediate(r))
  expect(renderMembershipPdf).toHaveBeenCalledWith(
    expect.objectContaining({ signature: sig, payload: expect.objectContaining({ subscription: { monthlyAmount: 80 } }) })
  )
  expect(sendMembershipNotificationEmail).toHaveBeenCalledWith("John Miller", expect.any(Buffer))
})

describe("configurable dues minimum", () => {
  it("rejects dues below the configured minimum", async () => {
    const { getMembershipSettings } = await import("@/lib/membershipSettings")
    ;(getMembershipSettings as jest.Mock).mockResolvedValueOnce({ parishFields: true, minDues: 80 })
    const r = await submitMembershipApplication({ payload: { ...validPayload, subscription: { monthlyAmount: 50 } }, signature: sig })
    expect(r).toEqual({ error: "Monthly subscription must be at least $80." })
    expect(prisma.membershipApplication.create).not.toHaveBeenCalled()
  })
  it("accepts zero dues when no minimum is configured", async () => {
    const r = await submitMembershipApplication({ payload: { ...validPayload, subscription: { monthlyAmount: 0 } }, signature: sig })
    expect(r).toEqual({ success: expect.any(String) })
  })
})

describe("overseas-field labels", () => {
  it("stamps the labels shown at submission onto the payload, ignoring client-sent ones", async () => {
    const { getMembershipSettings } = await import("@/lib/membershipSettings")
    const { renderMembershipPdf } = await import("@/lib/pdf/MembershipPdf")
    ;(getMembershipSettings as jest.Mock).mockResolvedValueOnce({ parishFields: false, minDues: null, homeAddressLabel: "Address in India", arrivalDateLabel: "" })
    const spoofed = { ...validPayload, fieldLabels: { homeAddress: "Spoofed", arrivalDate: "Spoofed" } }
    const r = await submitMembershipApplication({ payload: spoofed, signature: sig })
    expect(r).toEqual({ success: expect.any(String) })
    await new Promise((res) => setImmediate(res))
    expect(renderMembershipPdf).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ fieldLabels: { homeAddress: "Address in India", arrivalDate: null } }) })
    )
  })
})

describe("stale overseas-field labels", () => {
  const settings = { parishFields: false, minDues: null, homeAddressLabel: "Address in India", arrivalDateLabel: "Date of arrival in NSW" }
  it("rejects non-destructively with the current labels when the rendered labels are stale", async () => {
    const { getMembershipSettings } = await import("@/lib/membershipSettings")
    const { verifyTurnstile } = await import("@/lib/turnstile")
    ;(getMembershipSettings as jest.Mock).mockResolvedValueOnce(settings)
    const r = await submitMembershipApplication({
      payload: validPayload, signature: sig, turnstileToken: "t",
      renderedLabels: { homeAddress: "Old label", arrivalDate: "Date of arrival in NSW" },
    })
    expect(r).toEqual({
      error: expect.stringContaining("updated"),
      updatedLabels: { homeAddress: "Address in India", arrivalDate: "Date of arrival in NSW" },
    })
    expect(prisma.membershipApplication.create).not.toHaveBeenCalled()
    // Single-use Turnstile token must not be burned on this soft rejection.
    expect(verifyTurnstile).not.toHaveBeenCalled()
  })
  it("treats a label hidden since render (now blank) as stale", async () => {
    const { getMembershipSettings } = await import("@/lib/membershipSettings")
    ;(getMembershipSettings as jest.Mock).mockResolvedValueOnce({ ...settings, arrivalDateLabel: "" })
    const r = await submitMembershipApplication({
      payload: validPayload, signature: sig,
      renderedLabels: { homeAddress: "Address in India", arrivalDate: "Date of arrival in NSW" },
    })
    expect(r).toEqual(expect.objectContaining({ updatedLabels: { homeAddress: "Address in India", arrivalDate: "" } }))
  })
  it("accepts when the rendered labels match", async () => {
    const { getMembershipSettings } = await import("@/lib/membershipSettings")
    ;(getMembershipSettings as jest.Mock).mockResolvedValueOnce(settings)
    const r = await submitMembershipApplication({
      payload: validPayload, signature: sig,
      renderedLabels: { homeAddress: "Address in India", arrivalDate: "Date of arrival in NSW" },
    })
    expect(r).toEqual({ success: expect.any(String) })
  })
})
