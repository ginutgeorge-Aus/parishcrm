/** @jest-environment node */
// Real-Postgres race test for the login attempt claim (`claimAttempt` in src/auth.ts,
// StMarkCRM#3331 PR 4). Fires parallel wrong passwords through the real
// authorizeCredentials and checks Postgres lets exactly 5 guesses compare, locks the
// account, and never loses a counter increment. Opt-in: runs only with INTEGRATION_DB=1
// against a migrated, disposable database (see docs/integration-tests.md).

// Module scope: keeps this file's top-level names out of the shared global script scope.
export {}

jest.mock("server-only", () => ({}))
// next-auth v5 is ESM-only; stub it (and the pieces of @/auth that are not under test).
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
jest.mock("next-auth/providers/credentials", () => ({ __esModule: true, default: jest.fn((opts: unknown) => opts) }))
jest.mock("@/auth.config", () => ({ authConfig: {} }))
jest.mock("@/lib/otp", () => ({ generateOtp: jest.fn(), hashOtp: jest.fn(), sendOtpEmail: jest.fn() }))
jest.mock("@/lib/notifications", () => ({ notifyFailedLogin: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/totpVerify", () => ({ verifySecondFactor: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@simplewebauthn/server", () => ({ verifyAuthenticationResponse: jest.fn() }))
jest.mock("@/lib/webauthn", () => ({ getRelyingParty: jest.fn(), consumeChallenge: jest.fn() }))
// The per-IP throttle (10/min on the shared "unknown" bucket) is not under test here and
// would swallow the burst; the dbRateLimit race has its own file.
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))
// Spy on the real bcrypt compare: one call per claimed guess slot.
jest.mock("bcryptjs", () => {
  const actual = jest.requireActual("bcryptjs")
  return { ...actual, compare: jest.fn(actual.compare) }
})

const RUN = process.env.INTEGRATION_DB === "1"
jest.setTimeout(60_000)

;(RUN ? describe : describe.skip)("login lockout races (real Postgres)", () => {
  let prisma: typeof import("@/lib/prisma").prisma
  let auth: typeof import("@/auth")
  let compareMock: jest.Mock
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const userIds: number[] = []
  let seq = 0

  /** Creates a user with a known password and returns its id and email. */
  async function newUser(): Promise<{ id: number; email: string }> {
    const { hash } = jest.requireActual("bcryptjs") as typeof import("bcryptjs")
    const email = `lockout-${tag}-${seq++}@example.com`
    const user = await prisma.user.create({
      data: { name: "Lockout race", email, passwordHash: await hash("correct-horse", 4), role: "VIEWER" },
    })
    userIds.push(user.id)
    return { id: user.id, email }
  }

  /**
   * Runs one wrong-password login and reports whether it was refused as locked.
   * @param email - account to attack
   */
  async function wrongGuess(email: string): Promise<"null" | "locked"> {
    try {
      const out = await auth.authorizeCredentials({ email, password: "wrong-password" })
      if (out !== null) throw new Error("wrong password must not log in")
      return "null"
    } catch (err) {
      if (err instanceof auth.AccountLocked) return "locked"
      throw err
    }
  }

  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/prisma"))
    auth = await import("@/auth")
    compareMock = (await import("bcryptjs")).compare as unknown as jest.Mock
  })

  beforeEach(() => compareMock?.mockClear())

  afterAll(async () => {
    if (!prisma) return
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
  })

  it("6 parallel wrong passwords: exactly 5 compared, 1 refused, account locked", async () => {
    const { id, email } = await newUser()
    const results = await Promise.all(Array.from({ length: 6 }, () => wrongGuess(email)))
    expect(results.filter((r) => r === "null")).toHaveLength(5)
    expect(results.filter((r) => r === "locked")).toHaveLength(1)
    // Only claimed slots ever reach the password compare.
    expect(compareMock).toHaveBeenCalledTimes(5)
    const row = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(row.lockedUntil && row.lockedUntil.getTime()).toBeGreaterThan(Date.now())
    // The 5th claim zeroes the counter as it locks.
    expect(row.failedLoginAttempts).toBe(0)
    // A later, correct password is still refused while locked.
    await expect(auth.authorizeCredentials({ email, password: "correct-horse" })).rejects.toBeInstanceOf(auth.AccountLocked)
  })

  it("3 parallel wrong passwords: counter is exactly 3, no lock, no lost increment", async () => {
    const { id, email } = await newUser()
    const results = await Promise.all(Array.from({ length: 3 }, () => wrongGuess(email)))
    expect(results).toEqual(["null", "null", "null"])
    const row = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(row.failedLoginAttempts).toBe(3)
    expect(row.lockedUntil).toBeNull()
  })

  it("30 parallel wrong passwords never let more than 5 guesses compare", async () => {
    const { email } = await newUser()
    const results = await Promise.all(Array.from({ length: 30 }, () => wrongGuess(email)))
    expect(results.filter((r) => r === "null")).toHaveLength(5)
    expect(compareMock).toHaveBeenCalledTimes(5)
  })
})
