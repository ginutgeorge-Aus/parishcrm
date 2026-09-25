/** @jest-environment node */
import { hash } from "bcryptjs"
import NextAuth from "next-auth"

// spy on the real compare() so the timing-equalisation test can assert
// it was invoked, without disturbing the genuine bcrypt behaviour every other
// test in this file relies on (hash() above is real too).
jest.mock("bcryptjs", () => {
  const actual = jest.requireActual("bcryptjs")
  return { ...actual, compare: jest.fn(actual.compare) }
})

// default to "allowed" so every existing test (most pass no IP, so this
// is never even called) keeps working; the dedicated rate-limit tests below
// override it per-case.
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    appSetting: {
      findUnique: jest.fn(),
    },
    trustedDevice: {
      create: jest.fn().mockResolvedValue({ id: "grant1" }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}))

// next-auth v5 is ESM-only; mock it so Jest (CJS) can load @/auth
jest.mock("next-auth", () => {
  class CredentialsSignin extends Error {
    code = ""
  }
  return {
    __esModule: true,
    default: jest.fn(() => ({ auth: jest.fn(), handlers: {}, signIn: jest.fn(), signOut: jest.fn() })),
    CredentialsSignin,
  }
})

jest.mock("next-auth/providers/credentials", () => ({
  __esModule: true,
  default: jest.fn(),
}))

jest.mock("@/auth.config", () => ({ authConfig: {} }))

jest.mock("@/lib/otp", () => ({
  generateOtp: jest.fn(() => "123456"),
  hashOtp: jest.fn((code: string) => `hashed:${code}`),
  sendOtpEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("@/lib/notifications", () => ({
  notifyFailedLogin: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))

jest.mock("@/lib/trustedDevice", () => ({
  DEVICE_TRUST_GRANT_PREFIX: "grant:",
  DEVICE_TRUST_GRANT_TTL_MS: 300000,
  generateDeviceToken: jest.fn(() => "random-proof"),
  parseTrustedDeviceCookie: jest.fn((cookieHeader: string | null | undefined) => {
    if (!cookieHeader) return null
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=")
      if (eq === -1) continue
      const name = part.slice(0, eq).trim()
      if (name === "trusted_device") return part.slice(eq + 1).trim() || null
    }
    return null
  }),
  hashDeviceToken: jest.fn((token: string) => `hashed_device:${token}`),
}))

import { prisma } from "@/lib/prisma"
import { authorizeCredentials, AccountLocked, OtpSent, OtpDeliveryFailed, jwtCallback } from "@/auth"
import { sendOtpEmail } from "@/lib/otp"
import { logAudit } from "@/lib/audit"

const nextAuthOptions = (NextAuth as jest.Mock).mock.calls[0][0]

// Minimal Request stub carrying x-forwarded-for (a trusted reverse proxy appends
// the real client IP as the rightmost entry).
const reqWithIp = (xff: string) =>
  ({ headers: { get: (k: string) => (k === "x-forwarded-for" ? xff : null) } }) as unknown as Request

const baseUser = {
  id: 1,
  name: "Admin User",
  email: "admin@example.com",
  role: "ADMIN",
  failedLoginAttempts: 0,
  lockedUntil: null,
  otpCode: null,
  otpExpiresAt: null,
}

describe("authorizeCredentials", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns null when credentials are missing", async () => {
    expect(await authorizeCredentials({})).toBeNull()
    expect(await authorizeCredentials({ email: "a@b.com" })).toBeNull()
    expect(await authorizeCredentials({ password: "pass" })).toBeNull()
  })

  it("returns null when user not found in database", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    const result = await authorizeCredentials({
      email: "nobody@example.com",
      password: "password123",
    })
    expect(result).toBeNull()
  })

  it("returns null for a soft-deleted (archived) user on a correct password", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash, archivedAt: new Date() })
    const result = await authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    expect(result).toBeNull()
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("returns null when password is incorrect and increments counter", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    const result = await authorizeCredentials({
      email: "admin@example.com",
      password: "wrongpassword",
    })
    expect(result).toBeNull()
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedLoginAttempts: { increment: 1 } }) })
    )
  })

  it("records the source IP on a failed-login audit entry", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    await authorizeCredentials(
      { email: "admin@example.com", password: "wrongpassword" },
      reqWithIp("203.0.113.9, 10.0.0.1"),
    )
    expect(logAudit).toHaveBeenCalledWith(
      baseUser.id, "USER_LOGIN_FAILED", "User", baseUser.id, { reason: "invalid_password" }, "10.0.0.1",
    )
  })

  it("locks account after 5 failed attempts", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash, failedLoginAttempts: 4,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ failedLoginAttempts: 5 })
    await authorizeCredentials({ email: "admin@example.com", password: "wrongpassword" })
    const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0]
    expect(updateCall.data.failedLoginAttempts).toEqual({ increment: 1 })
    // Lock is applied atomically in a separate guarded updateMany.
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lockedUntil: expect.any(Date) }) })
    )
  })

  it("re-locks after a previous password lockout has expired", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash, failedLoginAttempts: 4,
      lockedUntil: new Date(Date.now() - 60 * 1000), // previous lock, now expired
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ failedLoginAttempts: 5 })
    await authorizeCredentials({ email: "admin@example.com", password: "wrongpassword" })
    // Guarded updateMany must match null OR an expired lock — not `lockedUntil: null` alone,
    // otherwise the where-clause never matches and the account never re-locks.
    const lockCall = (prisma.user.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.lockedUntil instanceof Date
    )
    expect(lockCall).toBeDefined()
    expect(lockCall[0].where).toEqual(
      expect.objectContaining({
        id: baseUser.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: expect.any(Date) } }],
      })
    )
  })

  it("resets the failed-login counter when it locks", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash, failedLoginAttempts: 4,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ failedLoginAttempts: 5 })
    await authorizeCredentials({ email: "admin@example.com", password: "wrongpassword" })
    const lockCall = (prisma.user.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.lockedUntil instanceof Date
    )
    expect(lockCall).toBeDefined()
    // Counter zeroed atomically with the lock — otherwise a single wrong attempt
    // after the 15-min window expires immediately re-locks (stale counter still ≥5).
    expect(lockCall[0].data.failedLoginAttempts).toBe(0)
  })

  it("throws AccountLocked when account is locked", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash, failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(AccountLocked)
  })

  it("throws OtpSent and stores OTP on valid password", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(OtpSent)
    // DB stores the HMAC of the OTP, never the plaintext code
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ otpCode: "hashed:123456" }) })
    )
  })

  it("throws OtpDeliveryFailed and rolls back the stored OTP when email delivery fails", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    ;(sendOtpEmail as jest.Mock).mockRejectedValueOnce(new Error("smtp unavailable"))
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(OtpDeliveryFailed)
    // The just-stored code is cleared, scoped to the hash we wrote so a
    // concurrent attempt's newer code is never wiped.
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ otpCode: "hashed:123456" }),
        data: { otpCode: null, otpExpiresAt: null },
      })
    )
  })

  it("still throws OtpDeliveryFailed when the rollback write also fails", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    ;(prisma.user.updateMany as jest.Mock).mockRejectedValueOnce(new Error("db blip"))
    ;(sendOtpEmail as jest.Mock).mockRejectedValueOnce(new Error("smtp unavailable"))
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(OtpDeliveryFailed)
  })

  it("throws AccountLocked on valid password while OTP is locked (no bypass)", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash,
      failedOtpAttempts: 5,
      otpLockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(AccountLocked)
    // Must NOT issue a fresh OTP or reset the lockout
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("issues a fresh OTP once the OTP lockout has expired (boundary)", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash,
      failedOtpAttempts: 5,
      otpLockedUntil: new Date(Date.now() - 1), // lock just expired
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(OtpSent)
  })

  it("does not reset OTP lockout counters when issuing a new OTP", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser, passwordHash, failedOtpAttempts: 3, otpLockedUntil: null,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(OtpSent)
    const call = (prisma.user.update as jest.Mock).mock.calls[0][0]
    expect(call.data).not.toHaveProperty("failedOtpAttempts")
    expect(call.data).not.toHaveProperty("otpLockedUntil")
  })

  it("ignores DISABLE_OTP=true in production — still enforces OTP", async () => {
    const prevDisable = process.env.DISABLE_OTP
    const prevNodeEnv = process.env.NODE_ENV
    process.env.DISABLE_OTP = "true"
    ;(process.env as { NODE_ENV: string }).NODE_ENV = "production"
    try {
      const passwordHash = await hash("correctpassword", 10)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
      ;(prisma.user.update as jest.Mock).mockResolvedValue({})
      await expect(
        authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
      ).rejects.toBeInstanceOf(OtpSent)
    } finally {
      process.env.DISABLE_OTP = prevDisable
      ;(process.env as { NODE_ENV: string }).NODE_ENV = prevNodeEnv as string
    }
  })

  it("honours DISABLE_OTP=true outside production — bypasses OTP", async () => {
    const prevDisable = process.env.DISABLE_OTP
    const prevNodeEnv = process.env.NODE_ENV
    process.env.DISABLE_OTP = "true"
    ;(process.env as { NODE_ENV: string }).NODE_ENV = "development"
    try {
      const passwordHash = await hash("correctpassword", 10)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
      const result = await authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
      expect(result).toMatchObject({ email: "admin@example.com" })
    } finally {
      process.env.DISABLE_OTP = prevDisable
      ;(process.env as { NODE_ENV: string }).NODE_ENV = prevNodeEnv as string
    }
  })

  it("returns VIEWER role user correctly after OTP step", async () => {
    const validOtpExpiry = new Date(Date.now() + 5 * 60 * 1000)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 5, name: "Secretary", email: "secretary@example.com",
      role: "VIEWER", failedLoginAttempts: 0, lockedUntil: null,
      otpCode: "hashed:654321", otpExpiresAt: validOtpExpiry,
    })
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const result = await authorizeCredentials({
      email: "secretary@example.com",
      mode: "otp",
      otp: "654321",
    })
    expect(result).toMatchObject({ role: "VIEWER" })
  })
})

describe("authorizeCredentials — OTP mode", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns null when otp field is missing", async () => {
    expect(await authorizeCredentials({ email: "a@b.com", mode: "otp" })).toBeNull()
  })

  it("returns null when user not found", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await authorizeCredentials({ email: "a@b.com", mode: "otp", otp: "123456" })).toBeNull()
  })

  it("returns null when no OTP is stored on user", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser })
    expect(await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })).toBeNull()
  })

  it("returns null when OTP is expired", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() - 1000),
    })
    expect(await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })).toBeNull()
  })

  it("returns null when OTP is wrong", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    expect(await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "999999" })).toBeNull()
  })

  it("validates the submitted code against the stored hash, not plaintext", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const result = await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })
    expect(result).toMatchObject({ id: "1" })
  })

  it("throws AccountLocked when OTP-locked even if the OTP has expired", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() - 1000), // expired
      failedOtpAttempts: 5,
      otpLockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })
    await expect(
      authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })
    ).rejects.toBeInstanceOf(AccountLocked)
  })

  it("throws AccountLocked when OTP-locked and no OTP is stored", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      failedOtpAttempts: 5,
      otpLockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })
    await expect(
      authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })
    ).rejects.toBeInstanceOf(AccountLocked)
  })

  it("throws AccountLocked when password-locked, even with a valid OTP (no bypass)", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })
    await expect(
      authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })
    ).rejects.toBeInstanceOf(AccountLocked)
    // Must NOT consume the OTP or mint a session while password-locked
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("re-locks after a previous OTP lockout has expired", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      failedOtpAttempts: 4,
      otpLockedUntil: new Date(Date.now() - 60 * 1000), // previous OTP lock, now expired
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ failedOtpAttempts: 5 })
    await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "999999" })
    const lockCall = (prisma.user.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.otpLockedUntil instanceof Date
    )
    expect(lockCall).toBeDefined()
    expect(lockCall[0].where).toEqual(
      expect.objectContaining({
        id: baseUser.id,
        OR: [{ otpLockedUntil: null }, { otpLockedUntil: { lte: expect.any(Date) } }],
      })
    )
  })

  it("resets the failed-OTP counter when it locks", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      failedOtpAttempts: 4,
    })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({ failedOtpAttempts: 5 })
    await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "999999" })
    const lockCall = (prisma.user.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0]?.data?.otpLockedUntil instanceof Date
    )
    expect(lockCall).toBeDefined()
    expect(lockCall[0].data.failedOtpAttempts).toBe(0)
  })

  it("returns user and clears OTP fields on valid OTP", async () => {
    const validExpiry = new Date(Date.now() + 5 * 60 * 1000)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...baseUser,
      otpCode: "hashed:123456",
      otpExpiresAt: validExpiry,
    })
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    const result = await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })
    expect(result).toMatchObject({ id: "1", name: "Admin User", email: "admin@example.com", role: "ADMIN" })
    // consume must be a single conditional updateMany (verify + clear
    // atomically), never a separate findFirst-then-update.
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: baseUser.id, otpCode: "hashed:123456" }),
        data: expect.objectContaining({ otpCode: null, otpExpiresAt: null }),
      })
    )
  })

  it("only lets one of two concurrent requests consume the same OTP", async () => {
    const validExpiry = new Date(Date.now() + 5 * 60 * 1000)
    const storedUser = { ...baseUser, otpCode: "hashed:123456", otpExpiresAt: validExpiry }
    // Both concurrent requests read the same still-valid row (simulating the
    // race window before either has written its clear).
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(storedUser)

    // Simulate the DB: only the first updateMany whose where-clause still
    // matches the live row succeeds; once "consumed", every later call
    // (even with an identical where-clause) affects zero rows — exactly how
    // Postgres serializes concurrent UPDATE ... WHERE statements on one row.
    let consumed = false
    ;(prisma.user.updateMany as jest.Mock).mockImplementation(async () => {
      if (consumed) return { count: 0 }
      consumed = true
      return { count: 1 }
    })

    const [first, second] = await Promise.all([
      authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" }),
      authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" }),
    ])

    const results = [first, second]
    const successes = results.filter((r) => r !== null)
    const failures = results.filter((r) => r === null)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(successes[0]).toMatchObject({ id: "1" })
  })
})

describe("jwtCallback — role refresh", () => {
  beforeEach(() => jest.clearAllMocks())

  it("stamps role and id from user at sign-in without a DB hit", async () => {
    const token = await jwtCallback({ token: {}, user: { id: "7", role: "ADMIN" } })
    expect(token).toMatchObject({ id: "7", role: "ADMIN" })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("re-fetches the current role from the DB on subsequent requests", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: "VIEWER" })
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN" } })
    expect(token?.role).toBe("VIEWER")
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } })
    )
  })

  it("invalidates the session when the user no longer exists", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN" } })
    expect(token).toBeNull()
  })

  it("invalidates the session when token.id is not a number", async () => {
    // A malformed id would parseInt to NaN and crash the Prisma query; guard it.
    const token = await jwtCallback({ token: { id: "abc", role: "ADMIN" } })
    expect(token).toBeNull()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("returns the token unchanged with no DB call when it has no id", async () => {
    const token = await jwtCallback({ token: { foo: "bar" } as never })
    expect(token).toMatchObject({ foo: "bar" })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("invalidates the session when the account is password-locked", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "ADMIN",
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      otpLockedUntil: null,
    })
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN" } })
    expect(token).toBeNull()
  })

  it("keeps the session when the account is OTP-locked — OTP lock is login-phase only", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "ADMIN",
      lockedUntil: null,
      sessionsValidFrom: null,
    })
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN" } })
    expect(token).not.toBeNull()
    expect(token?.role).toBe("ADMIN")
  })

  it("keeps the session when a lock has already expired", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "VIEWER",
      lockedUntil: new Date(Date.now() - 60 * 1000),
      otpLockedUntil: null,
    })
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN" } })
    expect(token?.role).toBe("VIEWER")
  })

  it("drops the email claim and stamps timestamps at sign-in", async () => {
    const token = await jwtCallback({ token: { email: "u@x.com" }, user: { id: "7", role: "ADMIN" } })
    expect(token?.email).toBeUndefined()
    expect(typeof token?.loginAt).toBe("number")
    expect(typeof token?.lastActivity).toBe("number")
  })

  it("invalidates a token issued before sessionsValidFrom — logout", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "ADMIN", lockedUntil: null, otpLockedUntil: null,
      sessionsValidFrom: new Date(5000),
    })
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN", loginAt: 1000, lastActivity: Date.now() } })
    expect(token).toBeNull()
  })

  it("keeps a token issued after sessionsValidFrom", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "ADMIN", lockedUntil: null, otpLockedUntil: null,
      sessionsValidFrom: new Date(5000),
    })
    // Use a recent loginAt + explicit remember:false so the non-remember 4h hard cap
    // doesn't fire — this test only exercises the sessionsValidFrom boundary,
    // not session lifetime.
    const recentLogin = Date.now() - 60_000
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN", remember: false, loginAt: recentLogin, lastActivity: Date.now() } })
    expect(token?.role).toBe("ADMIN")
  })

  it("invalidates a session idle past the window", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "ADMIN", lockedUntil: null, otpLockedUntil: null, sessionsValidFrom: null,
    })
    // 3h of inactivity exceeds every configurable window (max 120 min), so this
    // holds regardless of the cached idle-setting value.
    const stale = Date.now() - 3 * 60 * 60 * 1000
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN", loginAt: stale, lastActivity: stale } })
    expect(token).toBeNull()
  })

  it("refreshes lastActivity for a recently-active session", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
      role: "ADMIN", lockedUntil: null, otpLockedUntil: null, sessionsValidFrom: null,
    })
    const recent = Date.now() - 5 * 1000
    const token = await jwtCallback({ token: { id: "7", role: "ADMIN", loginAt: recent, lastActivity: recent } })
    expect(token?.role).toBe("ADMIN")
    expect(token?.lastActivity).toBeGreaterThan(recent)
  })
})

describe("authorizeCredentials — OTP email failure", () => {
  beforeEach(() => jest.clearAllMocks())

  it("logs the error and throws OtpDeliveryFailed when sendOtpEmail fails", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    ;(sendOtpEmail as jest.Mock).mockRejectedValueOnce(new Error("SMTP connection refused"))

    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })

    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" })
    ).rejects.toBeInstanceOf(OtpDeliveryFailed)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[OTP]"),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    consoleSpy.mockRestore()
  })
})

const reqWithCookie = (cookie: string) =>
  ({ headers: { get: (k: string) => (k === "cookie" ? cookie : null) } }) as unknown as Request

describe("authorizeCredentials — trusted device skip", () => {
  beforeEach(() => jest.clearAllMocks())

  it("skips OTP and logs in when a valid trusted-device cookie matches", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.trustedDevice.findFirst as jest.Mock).mockResolvedValue({
      id: "dev1",
      userId: 1,
      expiresAt: new Date(Date.now() + 1000),
    })
    ;(prisma.trustedDevice.update as jest.Mock).mockResolvedValue({})

    const result = await authorizeCredentials(
      { email: "admin@example.com", password: "correctpassword", mode: "password", remember: "false" },
      reqWithCookie("trusted_device=GOODTOKEN"),
    )

    // trusted-device skips OTP but honours the submitted `remember` flag
    // for session length — it no longer hardcodes remember:true.
    expect(result).toEqual({ id: "1", name: "Admin User", email: "admin@example.com", role: "ADMIN", remember: false })
    expect(sendOtpEmail).not.toHaveBeenCalled()
    expect(prisma.trustedDevice.update).toHaveBeenCalled() // lastUsedAt bumped
    expect(logAudit).toHaveBeenCalledWith(1, "USER_LOGIN", "User", 1, undefined, undefined)
  })

  it("sends OTP when the cookie token does not match any device", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.trustedDevice.findFirst as jest.Mock).mockResolvedValue(null)

    await expect(
      authorizeCredentials(
        { email: "admin@example.com", password: "correctpassword", mode: "password" },
        reqWithCookie("trusted_device=STALE"),
      ),
    ).rejects.toBeInstanceOf(OtpSent)
    expect(sendOtpEmail).toHaveBeenCalled()
  })

  it("sends OTP when there is no trusted-device cookie", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })

    await expect(
      authorizeCredentials(
        { email: "admin@example.com", password: "correctpassword", mode: "password" },
        reqWithIp("1.2.3.4"),
      ),
    ).rejects.toBeInstanceOf(OtpSent)
    expect(prisma.trustedDevice.findFirst).not.toHaveBeenCalled()
  })
})

describe("jwtCallback — remember windows", () => {
  beforeEach(() => jest.clearAllMocks())

  it("stamps remember from the user at sign-in", async () => {
    const token = await jwtCallback({
      token: {},
      user: { id: "1", role: "ADMIN", remember: true } as unknown as { id: string; role: "ADMIN" },
    })
    expect(token).not.toBeNull()
    expect((token as Record<string, unknown>).remember).toBe(true)
  })

  it("kills a non-remembered session past the 4h hard cap", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: "ADMIN", lockedUntil: null, sessionsValidFrom: null })
    const fourHoursOneMin = Date.now() - (4 * 60 + 1) * 60_000
    const token = await jwtCallback({
      token: { id: "1", role: "ADMIN", remember: false, loginAt: fourHoursOneMin, lastActivity: Date.now() },
    })
    expect(token).toBeNull()
  })

  it("keeps a remembered session well past 4h when recently active", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: "ADMIN", lockedUntil: null, sessionsValidFrom: null })
    const sixHoursAgo = Date.now() - 6 * 60 * 60_000
    const token = await jwtCallback({
      token: { id: "1", role: "ADMIN", remember: true, loginAt: sixHoursAgo, lastActivity: Date.now() - 60_000 },
    })
    expect(token).not.toBeNull()
  })

  it("kills a remembered session idle past 7 days", async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: "ADMIN", lockedUntil: null, sessionsValidFrom: null })
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60_000
    const token = await jwtCallback({
      token: { id: "1", role: "ADMIN", remember: true, loginAt: eightDaysAgo, lastActivity: eightDaysAgo },
    })
    expect(token).toBeNull()
  })
})

describe("jwtCallback — SESSION_IDLE_TIMEOUT_MINUTES guard", () => {
  it("ignores a 0 idle setting and keeps the 60-min default", async () => {
    // Isolate the module so getIdleMs starts with a fresh (empty) idle cache —
    // otherwise an earlier test's cached value masks the appSetting mock.
    await jest.isolateModulesAsync(async () => {
      const { jwtCallback: freshJwt } = await import("@/auth")
      const { prisma: freshPrisma } = await import("@/lib/prisma")
      ;(freshPrisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: "0" })
      ;(freshPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "ADMIN", lockedUntil: null, otpLockedUntil: null, sessionsValidFrom: null,
      })
      // Active, non-remembered session 1 min old. Honouring "0" would zero the idle
      // window and kill every session on its next request.
      const oneMinAgo = Date.now() - 60_000
      const token = await freshJwt({
        token: { id: "7", role: "ADMIN", remember: false, loginAt: oneMinAgo, lastActivity: oneMinAgo },
      })
      expect(token).not.toBeNull()
    })
  })
})

describe("authorizeCredentials — IP rate limit", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects the attempt without touching the DB once the per-IP limit is hit", async () => {
    const { dbRateLimit } = await import("@/lib/dbRateLimit")
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(false)
    const result = await authorizeCredentials(
      { email: "admin@example.com", password: "whatever123" },
      reqWithIp("9.9.9.9"),
    )
    expect(result).toBeNull()
    expect(dbRateLimit).toHaveBeenCalledWith("login:ip:9.9.9.9", 10, 60_000)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("also throttles the OTP step from the same IP", async () => {
    const { dbRateLimit } = await import("@/lib/dbRateLimit")
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(false)
    const result = await authorizeCredentials(
      { email: "admin@example.com", mode: "otp", otp: "123456" },
      reqWithIp("9.9.9.9"),
    )
    expect(result).toBeNull()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("falls back to a shared bucket when no client IP is available", async () => {
    // Previously the throttle was skipped entirely when the IP couldn't be
    // parsed; keys it on `login:ip:unknown` so unparseable-IP requests
    // stay throttled, matching the sibling limiters.
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    const { dbRateLimit } = await import("@/lib/dbRateLimit")
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "correctpassword" }),
    ).rejects.toBeInstanceOf(OtpSent)
    expect(dbRateLimit).toHaveBeenCalledWith("login:ip:unknown", 10, 60_000)
  })

  it("still allows a legitimate attempt under the limit", async () => {
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    await expect(
      authorizeCredentials(
        { email: "admin@example.com", password: "correctpassword" },
        reqWithIp("1.2.3.4"),
      ),
    ).rejects.toBeInstanceOf(OtpSent)
  })

  // the e2e suite hits login from a single runner IP, serially, dozens
  // of times — it would trip its own 10/60s throttle and every later spec's
  // loginAs would be rejected `ip_rate_limited`. Skip the throttle only under
  // the E2E override flag (envCheck blocks it in real prod, same gate as
  // DISABLE_OTP / E2E_MOCK_EMAIL), so prod protection is untouched.
  it("skips the IP throttle entirely when E2E_ALLOW_TEST_OVERRIDES is set", async () => {
    const prev = process.env.E2E_ALLOW_TEST_OVERRIDES
    process.env.E2E_ALLOW_TEST_OVERRIDES = "true"
    try {
      const passwordHash = await hash("correctpassword", 10)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
      ;(prisma.user.update as jest.Mock).mockResolvedValue({})
      const { dbRateLimit } = await import("@/lib/dbRateLimit")
      await expect(
        authorizeCredentials(
          { email: "admin@example.com", password: "correctpassword" },
          reqWithIp("9.9.9.9"),
        ),
      ).rejects.toBeInstanceOf(OtpSent)
      expect(dbRateLimit).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.E2E_ALLOW_TEST_OVERRIDES
      else process.env.E2E_ALLOW_TEST_OVERRIDES = prev
    }
  })
})

describe("authorizeCredentials — enumeration timing defence", () => {
  beforeEach(() => jest.clearAllMocks())

  it("runs a dummy bcrypt compare for an unknown email, at the same cost as a real one", async () => {
    const { compare } = await import("bcryptjs") as unknown as { compare: jest.Mock }
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    const result = await authorizeCredentials({ email: "nobody@example.com", password: "whatever123" })
    expect(result).toBeNull()
    // A real bcrypt hash string (cost-12) — proves the dummy compare actually
    // ran the same bcrypt work as the known-user path, not just a no-op.
    expect(compare).toHaveBeenCalledWith("whatever123", expect.stringMatching(/^\$2[aby]\$12\$/))
  })

  it("does not run the dummy compare on the known-email path", async () => {
    const { compare } = await import("bcryptjs") as unknown as { compare: jest.Mock }
    const passwordHash = await hash("correctpassword", 10)
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
    ;(prisma.user.update as jest.Mock).mockResolvedValue({})
    await expect(
      authorizeCredentials({ email: "admin@example.com", password: "wrongpassword" }),
    ).resolves.toBeNull()
    expect(compare).toHaveBeenCalledTimes(1)
    expect(compare).toHaveBeenCalledWith("wrongpassword", passwordHash)
  })
})


describe("OTP-bound device trust grants", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, otpCode: "hashed:123456", otpExpiresAt: new Date(Date.now() + 600000) })
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  })

  it("issues a short-lived pending device only after remembered OTP success", async () => {
    const now = Date.now()
    const user = await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456", remember: "true" })
    expect(user).toMatchObject({ deviceTrustGrant: "grant1" })
    const { data } = (prisma.trustedDevice.create as jest.Mock).mock.calls[0][0]
    expect(data).toMatchObject({ userId: 1, tokenHash: "grant:hashed_device:random-proof" })
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(now + 300000)
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300000)
    expect(prisma.trustedDevice.deleteMany).toHaveBeenCalledWith({ where: { userId: 1, tokenHash: { startsWith: "grant:" }, expiresAt: { lte: expect.any(Date) } } })
  })

  it("does not issue proof without remember selected", async () => {
    const user = await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456" })
    expect(user).not.toHaveProperty("deviceTrustGrant")
    expect(prisma.trustedDevice.create).not.toHaveBeenCalled()
  })

  it("does not issue proof when OTP consumption loses a race", async () => {
    ;(prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await authorizeCredentials({ email: "admin@example.com", mode: "otp", otp: "123456", remember: "true" })).toBeNull()
    expect(prisma.trustedDevice.create).not.toHaveBeenCalled()
  })

  it("copies proof from the authenticated user into the signed JWT", async () => {
    const user = { id: "1", role: "ADMIN" as const, deviceTrustGrant: "grant1" }
    expect(await jwtCallback({ token: {}, user })).toMatchObject({ deviceTrustGrant: "grant1" })
  })

  it("clears previous proof on a new login without OTP", async () => {
    const token = await jwtCallback({ token: { deviceTrustGrant: "old" }, user: { id: "1", role: "ADMIN" } })
    expect(token?.deviceTrustGrant).toBeUndefined()
  })
})


test("session callback passes only the signed JWT grant to trustDevice", async () => {
  const config = nextAuthOptions
  const session = { user: { id: "1", role: "ADMIN" }, deviceTrustGrant: "untrusted" }
  const result = await config.callbacks.session({ session, token: { id: "1", role: "ADMIN", deviceTrustGrant: "signed-grant" } })
  expect(result.deviceTrustGrant).toBe("signed-grant")
  const withoutProof = await config.callbacks.session({ session, token: { id: "1", role: "ADMIN" } })
  expect(withoutProof.deviceTrustGrant).toBeUndefined()
})

test("remembered trusted-cookie login cannot issue a new OTP grant", async () => {
  jest.clearAllMocks()
  const passwordHash = await hash("correctpassword", 10)
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...baseUser, passwordHash })
  ;(prisma.trustedDevice.findFirst as jest.Mock).mockResolvedValue({ id: "dev1" })
  const result = await authorizeCredentials(
    { email: "admin@example.com", password: "correctpassword", remember: "true" },
    reqWithCookie("trusted_device=GOODTOKEN"),
  )
  expect(result).toMatchObject({ id: "1", remember: true })
  expect(result).not.toHaveProperty("deviceTrustGrant")
  expect(prisma.trustedDevice.create).not.toHaveBeenCalled()
})
