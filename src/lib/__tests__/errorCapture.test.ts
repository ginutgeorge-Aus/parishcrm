/** @jest-environment node */
// src/lib/__tests__/errorCapture.test.ts
import { normalizeMessage, scrubMessage, fingerprintError } from "@/lib/errorCapture"

describe("errorCapture helpers", () => {
  it("normalizeMessage collapses ids so id-varying messages match", () => {
    expect(normalizeMessage("Person 4821 not found")).toBe(normalizeMessage("Person 9002 not found"))
  })

  it("scrubMessage redacts emails and tokens and truncates", () => {
    const s = scrubMessage("failed for a@b.com token=abc123")
    expect(s).not.toContain("a@b.com")
    expect(s).not.toContain("abc123")
    expect(scrubMessage("x".repeat(999)).length).toBeLessThanOrEqual(500)
  })

  // colon/equals/space-delimited secrets must lose the VALUE, not just the
  // separator — the scrubbed message is persisted and copied into a filed issue.
  it("scrubMessage redacts colon-, equals-, and space-delimited secrets", () => {
    for (const raw of [
      "login password: hunter2 rejected",
      "auth password=hunter2 rejected",
      "sent token: abc123XYZ upstream",
      "Authorization bearer abc123XYZ failed",
      "config secret = s3cr3tVALUE loaded",
      "many tokens=abc123XYZ present",
    ]) {
      const s = scrubMessage(raw)
      expect(s).not.toContain("hunter2")
      expect(s).not.toContain("abc123XYZ")
      expect(s).not.toContain("s3cr3tVALUE")
      expect(s).toContain("[redacted]")
    }
  })

  it("scrubMessage redacts AU phone numbers (mobile, landline, +61, spaced)", () => {
    for (const phone of ["0412345678", "0412 345 678", "+61 412 345 678", "02 9876 5432", "+61298765432"]) {
      const s = scrubMessage(`SMS to ${phone} failed`)
      expect(s).toBe("SMS to [phone] failed")
    }
  })

  it("fingerprintError is stable for id-varying messages, differs by route", () => {
    const a = fingerprintError({ message: "Person 1 not found", route: "/people" })
    const b = fingerprintError({ message: "Person 2 not found", route: "/people" })
    const c = fingerprintError({ message: "Person 1 not found", route: "/families" })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })
})

jest.mock("@/lib/prisma", () => ({ prisma: { errorLog: { create: jest.fn() } } }))
import { prisma } from "@/lib/prisma"
import { captureError } from "@/lib/errorCapture"

describe("captureError", () => {
  const OLD = process.env.NEXT_RUNTIME
  afterEach(() => { process.env.NEXT_RUNTIME = OLD })

  it("no-ops outside the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge"
    captureError({ errorType: "E", message: "boom" })
    await new Promise((r) => setImmediate(r))
    expect((prisma.errorLog.create as jest.Mock)).not.toHaveBeenCalled()
  })

  it("inserts a scrubbed, fingerprinted row on the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs"
    ;(prisma.errorLog.create as jest.Mock).mockResolvedValue({})
    captureError({ errorType: "TypeError", message: "Person 7 fail a@b.com", route: "/people" })
    await new Promise((r) => setImmediate(r))
    const arg = (prisma.errorLog.create as jest.Mock).mock.calls[0][0].data
    expect(arg.fingerprint).toMatch(/^[0-9a-f]{12}$/)
    expect(arg.message).not.toContain("a@b.com")
  })

  it("swallows insert failure without throwing", async () => {
    process.env.NEXT_RUNTIME = "nodejs"
    ;(prisma.errorLog.create as jest.Mock).mockRejectedValue(new Error("db down"))
    expect(() => captureError({ errorType: "E", message: "x" })).not.toThrow()
    await new Promise((r) => setImmediate(r))
  })
})
