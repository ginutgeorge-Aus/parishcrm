/** @jest-environment node */
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/email"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    trustedDevice: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  },
}))
jest.mock("@/lib/email", () => ({ sendPasswordResetEmail: jest.fn() }))
jest.mock("next/headers", () => ({ headers: jest.fn() }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn() }))

import { headers } from "next/headers"
import { dbRateLimit } from "@/lib/dbRateLimit"

const mockFindUnique = prisma.user.findUnique as jest.Mock
const mockUpdate = prisma.user.update as jest.Mock
const mockUpdateMany = prisma.user.updateMany as jest.Mock
const mockSendEmail = sendPasswordResetEmail as jest.Mock
const mockHeaders = headers as jest.Mock
const mockDbRateLimit = dbRateLimit as jest.Mock

// Each test gets a unique IP by default; rate-limit tests pin their own. The
// shared limiter is mocked to allow by default — keying tests override it.
let ipCounter = 0
beforeEach(() => {
  mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": `10.0.0.${++ipCounter}` }))
  mockDbRateLimit.mockResolvedValue(true)
})

import { requestPasswordReset, resetPassword } from "@/lib/actions/auth"

describe("requestPasswordReset", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AUTH_URL = "http://localhost:3000"
  })

  it("returns success when email not found (no reveal)", async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await requestPasswordReset("nobody@example.com")).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns success silently when token still active (no user enumeration)", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, email: "u@e.com", passwordResetExpires: new Date(Date.now() + 3600000) })
    expect(await requestPasswordReset("u@e.com")).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("stores token hash in DB and sends raw token in email", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, email: "u@e.com", passwordResetExpires: null })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockSendEmail.mockResolvedValue(undefined)
    expect(await requestPasswordReset("u@e.com")).toEqual({ success: true })
    const updateCall = mockUpdateMany.mock.calls[0][0]
    const storedHash: string = updateCall.data.passwordResetToken
    // DB must store SHA-256 hex (64 chars), not the raw 64-char hex token
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/)
    const emailUrl: string = mockSendEmail.mock.calls[0][1]
    const rawToken = new URL(emailUrl).searchParams.get("token")!
    // Raw token in email must NOT equal the stored hash
    expect(rawToken).not.toBe(storedHash)
    // Hash of raw token must equal what was stored
    const { createHash } = await import("crypto")
    expect(createHash("sha256").update(rawToken).digest("hex")).toBe(storedHash)
  })

  it("claims the token slot atomically before sending — only when no unexpired token exists", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, email: "u@e.com", passwordResetExpires: null })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockSendEmail.mockResolvedValue(undefined)
    await requestPasswordReset("u@e.com")
    const where = mockUpdateMany.mock.calls[0][0].where
    expect(where.id).toBe(1)
    expect(where.OR).toEqual([
      { passwordResetExpires: null },
      { passwordResetExpires: { lte: expect.any(Date) } },
    ])
    // Claim happens before the email goes out
    expect(mockUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(mockSendEmail.mock.invocationCallOrder[0])
  })

  it("sends nothing when a concurrent request already claimed the slot", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, email: "u@e.com", passwordResetExpires: null })
    mockUpdateMany.mockResolvedValue({ count: 0 })
    expect(await requestPasswordReset("u@e.com")).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("clears only its own token when the send fails, so a retry is possible", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, email: "u@e.com", passwordResetExpires: null })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockSendEmail.mockRejectedValue(new Error("smtp down"))
    expect(await requestPasswordReset("u@e.com")).toEqual({ success: true })
    const storedHash = mockUpdateMany.mock.calls[0][0].data.passwordResetToken
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 1, passwordResetToken: storedHash },
      data: { passwordResetToken: null, passwordResetExpires: null },
    })
  })
})

describe("resetPassword", () => {
  beforeEach(() => jest.clearAllMocks())

  // Real reset tokens are 32-byte hex (randomBytes(32).toString("hex")).
  const VALID_TOKEN = "a".repeat(64)

  it("returns error for invalid token", async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await resetPassword(VALID_TOKEN, "ValidPass1!")).toEqual({ error: "Invalid or expired reset link." })
  })

  it("returns error for expired token", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, passwordResetExpires: new Date(Date.now() - 1000) })
    expect(await resetPassword(VALID_TOKEN, "ValidPass1!")).toEqual({ error: "Invalid or expired reset link." })
  })

  it("returns validation error for weak password", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, passwordResetExpires: new Date(Date.now() + 60000) })
    expect((await resetPassword(VALID_TOKEN, "weak"))?.error).toContain("Password must be")
  })

  it("hashes password, clears token, resets lockout on success", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, passwordResetExpires: new Date(Date.now() + 60000) })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    expect(await resetPassword(VALID_TOKEN, "StrongPass1!")).toEqual({ success: true })
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      // Predicate must scope the consume to the still-present token hash + an
      // unexpired timestamp so a concurrent submit can't double-apply.
      where: expect.objectContaining({ id: 1, passwordResetExpires: { gte: expect.any(Date) } }),
      data: expect.objectContaining({ passwordResetToken: null, passwordResetExpires: null, failedLoginAttempts: 0, lockedUntil: null }),
    }))
  })

  it("invalidates existing sessions on success", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, passwordResetExpires: new Date(Date.now() + 60000) })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    expect(await resetPassword(VALID_TOKEN, "StrongPass1!")).toEqual({ success: true })
    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.sessionsValidFrom).toBeInstanceOf(Date)
  })

  it("returns invalid when the token was already consumed by a concurrent reset", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, passwordResetExpires: new Date(Date.now() + 60000) })
    // The conditional consume matches 0 rows — another submit cleared the token first.
    mockUpdateMany.mockResolvedValue({ count: 0 })
    expect(await resetPassword(VALID_TOKEN, "StrongPass1!")).toEqual({ error: "Invalid or expired reset link." })
    expect(prisma.trustedDevice.deleteMany).not.toHaveBeenCalled()
  })

  it("clears active OTP and OTP lockout on success", async () => {
    mockFindUnique.mockResolvedValue({ id: 1, passwordResetExpires: new Date(Date.now() + 60000) })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    expect(await resetPassword("a".repeat(64), "StrongPass1!")).toEqual({ success: true })
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        otpCode: null,
        otpExpiresAt: null,
        failedOtpAttempts: 0,
        otpLockedUntil: null,
      }),
    }))
  })
})

describe("requestPasswordReset — rate limit", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDbRateLimit.mockResolvedValue(true)
    process.env.AUTH_URL = "http://localhost:3000"
  })

  it("blocks when the email limiter denies", async () => {
    mockDbRateLimit.mockResolvedValueOnce(false) // first call is the email key
    expect(await requestPasswordReset("victim@example.com")).toEqual({
      error: "Too many requests. Please try again later.",
    })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("limits per-email with a sha256 key, independent of IP", async () => {
    mockFindUnique.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "9.9.9.9" }))
    await requestPasswordReset("u@e.com")
    const emailKey = mockDbRateLimit.mock.calls[0][0]
    expect(emailKey).toMatch(/^pwreset:email:[0-9a-f]{64}$/)
  })

  it("checks the IP limiter only when an IP is present", async () => {
    mockFindUnique.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "9.9.9.9" }))
    await requestPasswordReset("u@e.com")
    expect(mockDbRateLimit).toHaveBeenCalledTimes(2)
    expect(mockDbRateLimit.mock.calls[1][0]).toBe("pwreset:ip:9.9.9.9")
  })

  it("skips the IP limiter when no XFF header is present (no 'unknown' bucket)", async () => {
    mockFindUnique.mockResolvedValue(null)
    mockHeaders.mockResolvedValue(new Headers()) // no x-forwarded-for
    await requestPasswordReset("u@e.com")
    expect(mockDbRateLimit).toHaveBeenCalledTimes(1)
    expect(mockDbRateLimit.mock.calls[0][0]).toMatch(/^pwreset:email:/)
  })

  it("blocks when the IP limiter denies (email allowed)", async () => {
    mockDbRateLimit
      .mockResolvedValueOnce(true) // email allowed
      .mockResolvedValueOnce(false) // ip denied
    mockHeaders.mockResolvedValue(new Headers({ "x-forwarded-for": "9.9.9.9" }))
    expect(await requestPasswordReset("u@e.com")).toEqual({
      error: "Too many requests. Please try again later.",
    })
  })

  it("delays the no-user path to mask user existence", async () => {
    mockFindUnique.mockResolvedValue(null)
    const start = Date.now()
    await requestPasswordReset("nobody@example.com")
    expect(Date.now() - start).toBeGreaterThanOrEqual(150)
  })
})

describe("input bounds", () => {
  beforeEach(() => jest.clearAllMocks())

  it("requestPasswordReset rejects an over-long email without querying the DB", async () => {
    const result = await requestPasswordReset("a".repeat(250) + "@example.com")
    expect(result).toEqual({ success: true }) // silent — no enumeration reveal
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("resetPassword rejects a malformed token without querying the DB", async () => {
    const result = await resetPassword("not-a-valid-token", "ValidPass1!")
    expect(result).toEqual({ error: "Invalid or expired reset link." })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
