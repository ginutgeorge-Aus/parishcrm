/** @jest-environment node */

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Map([["x-forwarded-for", "203.0.113.9"]])),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { warn: jest.fn() } }))
jest.mock("@/lib/dbRateLimit", () => ({ dbRateLimit: jest.fn().mockResolvedValue(true) }))
jest.mock("bcryptjs", () => ({ hash: jest.fn(async () => "hashed") }))

const tx = {
  user: { count: jest.fn(), create: jest.fn() },
}
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))

import { headers } from "next/headers"
import { createFirstAdmin } from "../setup"
import { isSetupOpen } from "@/lib/setupState"
import { prisma } from "@/lib/prisma"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { logAudit } from "@/lib/audit"
import { hash } from "bcryptjs"
import { logger } from "@/lib/logger"

const TOKEN = "t".repeat(32)
function fd(o: Record<string, string>) {
  const f = new FormData()
  for (const k in o) f.set(k, o[k])
  return f
}
const valid = { token: TOKEN, name: "Demo Admin", email: "admin@example.com", password: "Str0ng!pass" }

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SETUP_TOKEN = TOKEN
  ;(prisma.user.count as jest.Mock).mockResolvedValue(0)
  tx.user.count.mockResolvedValue(0)
  tx.user.create.mockResolvedValue({ id: 1 })
})
afterAll(() => { delete process.env.SETUP_TOKEN })

describe("isSetupOpen", () => {
  it("is closed when SETUP_TOKEN is unset", async () => {
    delete process.env.SETUP_TOKEN
    expect(await isSetupOpen()).toBe(false)
  })
  it("is closed once any user exists", async () => {
    ;(prisma.user.count as jest.Mock).mockResolvedValue(1)
    expect(await isSetupOpen()).toBe(false)
  })
  it("is open with a token and zero users", async () => {
    expect(await isSetupOpen()).toBe(true)
  })
})

describe("createFirstAdmin", () => {
  it("creates an ADMIN with a bcrypt-12 hash in a Serializable tx and audits it", async () => {
    const res = await createFirstAdmin(fd(valid))
    expect(res).toEqual({ success: true })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    expect(hash).toHaveBeenCalledWith("Str0ng!pass", 12)
    expect(tx.user.create).toHaveBeenCalledWith({
      data: { name: "Demo Admin", email: "admin@example.com", passwordHash: "hashed", role: "ADMIN" },
      select: { id: true },
    })
    expect(logAudit).toHaveBeenCalledWith(1, "SETUP_FIRST_ADMIN", "User", 1, undefined, "203.0.113.9")
  })
  it("trims but keeps the email's case (login matches it exactly as typed)", async () => {
    await createFirstAdmin(fd({ ...valid, email: "  Admin@Example.com " }))
    expect(tx.user.create.mock.calls[0][0].data.email).toBe("Admin@Example.com")
  })
  it("rejects a wrong token without touching the DB", async () => {
    const res = await createFirstAdmin(fd({ ...valid, token: "x".repeat(32) }))
    expect(res).toEqual({ error: "Setup is not available.", field: "token" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it("rejects when SETUP_TOKEN is unset (fail closed)", async () => {
    delete process.env.SETUP_TOKEN
    const res = await createFirstAdmin(fd({ ...valid, token: "" }))
    expect(res).toEqual({ error: "Setup is not available." })
  })
  it("bails before the rate limiter once setup is closed (users exist)", async () => {
    ;(prisma.user.count as jest.Mock).mockResolvedValue(1)
    const res = await createFirstAdmin(fd(valid))
    expect(res).toEqual({ error: "Setup is not available." })
    expect(dbRateLimit).not.toHaveBeenCalled()
  })
  it("does not count validation failures against the rate limit", async () => {
    const res = await createFirstAdmin(fd({ ...valid, password: "weakpass" }))
    expect(res).toMatchObject({ field: "password" })
    expect(dbRateLimit).not.toHaveBeenCalled()
  })
  it("drops a malformed x-forwarded-for from the audit row", async () => {
    ;(headers as jest.Mock).mockResolvedValueOnce(new Map([["x-forwarded-for", "garbage<script>"]]))
    await createFirstAdmin(fd(valid))
    expect(dbRateLimit).toHaveBeenCalledWith("setup:unknown", 10, 15 * 60_000)
    expect(logAudit).toHaveBeenCalledWith(1, "SETUP_FIRST_ADMIN", "User", 1, undefined, undefined)
  })
  it.each([["P2034", "serialization conflict"], ["P2002", "same-email unique violation"]])(
    "rejects a concurrent setup that loses the race (%s, %s)",
    async (code) => {
      ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("race"), { code }))
      const res = await createFirstAdmin(fd(valid))
      expect(res).toEqual({ error: "Setup is not available." })
      expect(logAudit).not.toHaveBeenCalled()
    }
  )
  it("rejects a race surfaced as an unwrapped adapter unique violation", async () => {
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("race"), { cause: { kind: "UniqueConstraintViolation" } })
    )
    expect(await createFirstAdmin(fd(valid))).toEqual({ error: "Setup is not available." })
  })
  it("rethrows unexpected DB errors", async () => {
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P1001" }))
    await expect(createFirstAdmin(fd(valid))).rejects.toThrow("boom")
  })
  it("rejects when a user was created concurrently (count re-checked in tx)", async () => {
    tx.user.count.mockResolvedValue(1)
    const res = await createFirstAdmin(fd(valid))
    expect(res).toEqual({ error: "Setup is not available." })
    expect(tx.user.create).not.toHaveBeenCalled()
  })
  it("rejects a weak password", async () => {
    const res = await createFirstAdmin(fd({ ...valid, password: "weakpass" }))
    expect(res).toHaveProperty("error")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it("rejects an invalid email", async () => {
    const res = await createFirstAdmin(fd({ ...valid, email: "nope" }))
    expect(res).toHaveProperty("error")
  })
  it("is rate limited per IP", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValue(false)
    const res = await createFirstAdmin(fd(valid))
    expect(res).toEqual({ error: "Too many attempts. Try again later." })
    expect(dbRateLimit).toHaveBeenCalledWith("setup:203.0.113.9", 10, 15 * 60_000)
  })
  it("warns the operator when no X-Forwarded-For forces the shared bucket", async () => {
    ;(headers as jest.Mock).mockResolvedValueOnce(new Map())
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(true)
    await createFirstAdmin(fd(valid))
    expect(dbRateLimit).toHaveBeenCalledWith("setup:unknown", 10, 15 * 60_000)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("X-Forwarded-For"), expect.any(Object))
  })
  it("does not warn for a request the shared bucket already rejected", async () => {
    ;(headers as jest.Mock).mockResolvedValueOnce(new Map())
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(false)
    await createFirstAdmin(fd(valid))
    expect(logger.warn).not.toHaveBeenCalled()
  })
  it("does not warn when the proxy sets X-Forwarded-For", async () => {
    ;(dbRateLimit as jest.Mock).mockResolvedValueOnce(true)
    await createFirstAdmin(fd(valid))
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
