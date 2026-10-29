/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    passkey: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  },
}))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })) }))
jest.mock("bcryptjs", () => ({ compare: jest.fn(async (v: string) => v === "demo-password-1") }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn().mockResolvedValue("Demo Church") }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: "reg-ch" }),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: "auth-ch" }),
}))
jest.mock("@/lib/webauthn", () => ({
  ...jest.requireActual("@/lib/webauthn"),
  getRelyingParty: jest.fn(),
  createChallenge: jest.fn().mockResolvedValue("ch1"),
  consumeChallenge: jest.fn(),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { logAudit } from "@/lib/audit"
import { sendEmail } from "@/lib/email"
import { compare } from "bcryptjs"
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions,
} from "@simplewebauthn/server"
import { getRelyingParty, createChallenge, consumeChallenge } from "@/lib/webauthn"
import {
  getPasskeyStatus, startPasskeyRegistration, finishPasskeyRegistration, removePasskey, startPasskeyLogin,
} from "@/lib/actions/passkey"

const RP = { rpID: "crm.example.org", origin: "https://crm.example.org" }
const session = { user: { id: "7", role: "VIEWER" } }
const user = { email: "admin@example.com", name: "Admin", passwordHash: "hash", archivedAt: null }
const pk = prisma.passkey as unknown as Record<string, jest.Mock>
const verifiedReg = {
  verified: true,
  registrationInfo: {
    credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
    credentialBackedUp: true,
  },
}

const OLD_DEMO = process.env.DEMO_MODE
beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.DEMO_MODE
  ;(auth as jest.Mock).mockResolvedValue(session)
  ;(getRelyingParty as jest.Mock).mockReturnValue(RP)
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(user)
  pk.findMany.mockResolvedValue([])
  pk.count.mockResolvedValue(0)
  ;(dbRateLimit as jest.Mock).mockResolvedValue(true)
})
afterAll(() => { process.env.DEMO_MODE = OLD_DEMO })

describe("guards", () => {
  it.each([
    ["startPasskeyRegistration", () => startPasskeyRegistration("demo-password-1")],
    ["finishPasskeyRegistration", () => finishPasskeyRegistration("ch1", {}, "Phone")],
    ["removePasskey", () => removePasskey("pk1")],
  ])("%s rejects no session", async (_n, call) => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    await expect(call()).resolves.toEqual({ error: "Unauthorized" })
  })

  it.each([
    ["startPasskeyRegistration", () => startPasskeyRegistration("demo-password-1")],
    ["finishPasskeyRegistration", () => finishPasskeyRegistration("ch1", {}, "Phone")],
    ["removePasskey", () => removePasskey("pk1")],
    ["startPasskeyLogin", () => startPasskeyLogin()],
  ])("%s is blocked in demo mode", async (_n, call) => {
    process.env.DEMO_MODE = "true"
    const res = await call()
    expect(res).toHaveProperty("error")
    expect(createChallenge).not.toHaveBeenCalled()
    expect(pk.deleteMany).not.toHaveBeenCalled()
  })

  it("start/finish report unavailable without a relying party", async () => {
    ;(getRelyingParty as jest.Mock).mockReturnValue(null)
    const err = { error: "Passkeys are not available on this server" }
    await expect(startPasskeyRegistration("demo-password-1")).resolves.toEqual(err)
    await expect(finishPasskeyRegistration("ch1", {}, "Phone")).resolves.toEqual(err)
    await expect(startPasskeyLogin()).resolves.toEqual(err)
  })
})

describe("getPasskeyStatus", () => {
  it("lists the session user's passkeys", async () => {
    const rows = [{ id: "pk1", name: "Phone", createdAt: new Date(), lastUsedAt: null, backedUp: true }]
    pk.findMany.mockResolvedValue(rows)
    await expect(getPasskeyStatus()).resolves.toEqual({ available: true, limit: 10, passkeys: rows })
    expect(pk.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }))
  })

  it("reports unavailable in demo mode (registration is blocked there)", async () => {
    process.env.DEMO_MODE = "true"
    pk.findMany.mockResolvedValue([])
    await expect(getPasskeyStatus()).resolves.toMatchObject({ available: false })
  })

  it("no session → unavailable, empty", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    await expect(getPasskeyStatus()).resolves.toEqual({ available: false, limit: 10, passkeys: [] })
  })
})

describe("startPasskeyRegistration", () => {
  it("rejects a wrong password without generating options", async () => {
    await expect(startPasskeyRegistration("wrong")).resolves.toEqual({ error: "Incorrect password" })
    expect(generateRegistrationOptions).not.toHaveBeenCalled()
  })

  it("is rate limited before checking the password", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValue(false)
    await expect(startPasskeyRegistration("demo-password-1")).resolves.toEqual({ error: "Too many attempts. Try again in 15 minutes." })
    expect(compare).not.toHaveBeenCalled()
    expect(dbRateLimit).toHaveBeenCalledWith("passkey:manage:7", 5, 15 * 60_000)
  })

  it("caps passkeys per user", async () => {
    pk.findMany.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ credentialId: `c${i}`, transports: [] })))
    await expect(startPasskeyRegistration("demo-password-1")).resolves.toEqual({ error: "You can register up to 10 passkeys" })
  })

  it("returns options + challenge id, requiring a discoverable, user-verified credential", async () => {
    pk.findMany.mockResolvedValue([{ credentialId: "old-cred", transports: ["usb"] }])
    const res = await startPasskeyRegistration("demo-password-1")
    expect(res).toEqual({ challengeId: "ch1", options: { challenge: "reg-ch" } })
    expect(createChallenge).toHaveBeenCalledWith("reg-ch", "register", 7)
    expect(generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: "crm.example.org",
      rpName: "Demo Church",
      userName: "admin@example.com",
      attestationType: "none",
      // Pinned, not v14's runtime-dependent default (ML-DSA-44 first when supported).
      supportedAlgorithmIDs: [-8, -7, -257],
      excludeCredentials: [{ id: "old-cred", transports: ["usb"] }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    }))
  })
})

describe("finishPasskeyRegistration", () => {
  beforeEach(() => {
    ;(consumeChallenge as jest.Mock).mockResolvedValue("reg-ch")
    ;(verifyRegistrationResponse as jest.Mock).mockResolvedValue(verifiedReg)
    pk.create.mockResolvedValue({ id: "pk-new" })
  })

  it("rejects a bad name before consuming the challenge", async () => {
    await expect(finishPasskeyRegistration("ch1", {}, "  ")).resolves.toEqual({ error: "Name must be 1–50 characters" })
    expect(consumeChallenge).not.toHaveBeenCalled()
  })

  it("rejects an expired/consumed challenge", async () => {
    ;(consumeChallenge as jest.Mock).mockResolvedValue(null)
    await expect(finishPasskeyRegistration("ch1", {}, "Phone")).resolves.toEqual({ error: "Passkey request expired — try again" })
    expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    expect(consumeChallenge).toHaveBeenCalledWith("ch1", "register", 7)
  })

  it.each([
    ["throws", () => (verifyRegistrationResponse as jest.Mock).mockRejectedValue(new Error("bad"))],
    ["unverified", () => (verifyRegistrationResponse as jest.Mock).mockResolvedValue({ verified: false })],
  ])("verification %s → error, nothing stored", async (_n, arrange) => {
    arrange()
    await expect(finishPasskeyRegistration("ch1", {}, "Phone")).resolves.toEqual({ error: "Passkey could not be verified" })
    expect(pk.create).not.toHaveBeenCalled()
  })

  it("verifies with user verification against the consumed challenge, then stores", async () => {
    const response = { id: "cred-1" }
    await expect(finishPasskeyRegistration("ch1", response, " Phone ")).resolves.toEqual({ success: true })
    expect(verifyRegistrationResponse).toHaveBeenCalledWith({
      response,
      expectedChallenge: "reg-ch",
      expectedOrigin: RP.origin,
      expectedRPID: RP.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-8, -7, -257],
    })
    const data = pk.create.mock.calls[0][0].data
    expect(data).toMatchObject({ userId: 7, credentialId: "cred-1", counter: BigInt(0), transports: ["internal"], name: "Phone", backedUp: true })
    expect(Buffer.isBuffer(data.publicKey)).toBe(true)
    expect(logAudit).toHaveBeenCalledWith(7, "PASSKEY_REGISTERED", "User", 7, { passkeyId: "pk-new" })
    expect(sendEmail).toHaveBeenCalledWith("admin@example.com", expect.stringContaining("Passkey added"), expect.any(String), expect.any(String))
  })

  it("re-checks the cap at finish", async () => {
    pk.count.mockResolvedValue(10)
    await expect(finishPasskeyRegistration("ch1", {}, "Phone")).resolves.toEqual({ error: "You can register up to 10 passkeys" })
    expect(pk.create).not.toHaveBeenCalled()
  })

  it("maps a duplicate credential", async () => {
    pk.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }))
    await expect(finishPasskeyRegistration("ch1", {}, "Phone")).resolves.toEqual({ error: "This passkey is already registered" })
  })
})

describe("removePasskey", () => {
  it("is scoped to the session user", async () => {
    pk.findFirst.mockResolvedValue({ name: "Phone", user: { email: "admin@example.com" } })
    pk.deleteMany.mockResolvedValue({ count: 1 })
    await expect(removePasskey("pk1")).resolves.toEqual({ success: true })
    expect(pk.deleteMany).toHaveBeenCalledWith({ where: { id: "pk1", userId: 7 } })
    expect(pk.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pk1", userId: 7 } }))
    expect(logAudit).toHaveBeenCalledWith(7, "PASSKEY_REMOVED", "User", 7, { passkeyId: "pk1" })
    expect(sendEmail).toHaveBeenCalledWith("admin@example.com", expect.stringContaining("Passkey removed"), expect.any(String), expect.any(String))
  })

  it("reports not found for another user's passkey without deleting", async () => {
    pk.findFirst.mockResolvedValue(null)
    await expect(removePasskey("someone-elses")).resolves.toEqual({ error: "Passkey not found" })
    expect(pk.deleteMany).not.toHaveBeenCalled()
  })

  it("reports not found when a concurrent remove won", async () => {
    pk.findFirst.mockResolvedValue({ name: "Phone", user: { email: "admin@example.com" } })
    pk.deleteMany.mockResolvedValue({ count: 0 })
    await expect(removePasskey("someone-elses")).resolves.toEqual({ error: "Passkey not found" })
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("bounds the id", async () => {
    await expect(removePasskey("x".repeat(65))).resolves.toEqual({ error: "Passkey not found" })
    expect(pk.deleteMany).not.toHaveBeenCalled()
  })
})

describe("startPasskeyLogin", () => {
  it("keys the throttle on the raw rightmost XFF entry when it is not a valid IP", async () => {
    const { headers } = jest.requireMock("next/headers") as { headers: jest.Mock }
    headers.mockResolvedValueOnce(new Headers({ "x-forwarded-for": "evil:80" }))
    await startPasskeyLogin()
    expect(dbRateLimit).toHaveBeenCalledWith("passkey:login:ip:evil:80", 10, 60_000)
  })
  it("issues a usernameless, user-verified login challenge", async () => {
    await expect(startPasskeyLogin()).resolves.toEqual({ challengeId: "ch1", options: { challenge: "auth-ch" } })
    expect(generateAuthenticationOptions).toHaveBeenCalledWith({ rpID: RP.rpID, userVerification: "required", allowCredentials: [] })
    expect(createChallenge).toHaveBeenCalledWith("auth-ch", "login", null)
    expect(dbRateLimit).toHaveBeenCalledWith("passkey:login:ip:203.0.113.9", 10, 60_000)
  })

  it("is rate limited per IP", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValue(false)
    await expect(startPasskeyLogin()).resolves.toEqual({ error: "Too many attempts. Try again shortly." })
    expect(createChallenge).not.toHaveBeenCalled()
  })
})
