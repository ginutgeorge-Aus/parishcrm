/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({
  prisma: { webAuthnChallenge: { create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } },
}))
import { prisma } from "@/lib/prisma"
import { getRelyingParty, createChallenge, consumeChallenge, normalisePasskeyName } from "@/lib/webauthn"

const ch = prisma.webAuthnChallenge as unknown as Record<string, jest.Mock>
const OLD = process.env.AUTH_URL
afterEach(() => { process.env.AUTH_URL = OLD; jest.clearAllMocks() })

describe("getRelyingParty", () => {
  it("derives rpID + origin from AUTH_URL", () => {
    process.env.AUTH_URL = "https://crm.example.org/some/path"
    expect(getRelyingParty()).toEqual({ rpID: "crm.example.org", origin: "https://crm.example.org" })
  })
  it("allows http on loopback", () => {
    process.env.AUTH_URL = "http://localhost:3000"
    expect(getRelyingParty()).toEqual({ rpID: "localhost", origin: "http://localhost:3000" })
  })
  it.each(["http://127.0.0.1:3000", "http://[::1]:3000", "https://10.0.0.5"])("disables on an IP host (%s) — RP IDs must be domains", (url) => {
    process.env.AUTH_URL = url
    expect(getRelyingParty()).toBeNull()
  })
  it("disables on plain http public host", () => {
    process.env.AUTH_URL = "http://crm.example.org"
    expect(getRelyingParty()).toBeNull()
  })
  it("disables when missing or unparseable", () => {
    delete process.env.AUTH_URL
    expect(getRelyingParty()).toBeNull()
    process.env.AUTH_URL = "not a url"
    expect(getRelyingParty()).toBeNull()
  })
})

describe("challenges", () => {
  it("creates with TTL and sweeps expired rows", async () => {
    ch.create.mockResolvedValue({ id: "c1" })
    await expect(createChallenge("abc", "login", null)).resolves.toBe("c1")
    expect(ch.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: expect.any(Date) } } })
    const data = ch.create.mock.calls[0][0].data
    expect(data).toMatchObject({ challenge: "abc", purpose: "login", userId: null })
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 60_000)
  })
  it("consume returns challenge once, valid purpose/user/expiry", async () => {
    ch.delete.mockResolvedValue({ challenge: "abc", purpose: "register", userId: 7, expiresAt: new Date(Date.now() + 60_000) })
    await expect(consumeChallenge("c1", "register", 7)).resolves.toBe("abc")
    expect(ch.delete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" } }))
  })
  it("consume rejects wrong purpose, wrong user, expired, missing, bad id", async () => {
    const future = new Date(Date.now() + 60_000)
    ch.delete.mockResolvedValueOnce({ challenge: "a", purpose: "login", userId: null, expiresAt: future })
    await expect(consumeChallenge("c1", "register", 7)).resolves.toBeNull()
    ch.delete.mockResolvedValueOnce({ challenge: "a", purpose: "register", userId: 8, expiresAt: future })
    await expect(consumeChallenge("c1", "register", 7)).resolves.toBeNull()
    ch.delete.mockResolvedValueOnce({ challenge: "a", purpose: "login", userId: null, expiresAt: new Date(Date.now() - 1) })
    await expect(consumeChallenge("c1", "login", null)).resolves.toBeNull()
    ch.delete.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "P2025" }))
    await expect(consumeChallenge("c1", "login", null)).resolves.toBeNull()
    await expect(consumeChallenge(42, "login", null)).resolves.toBeNull()
    await expect(consumeChallenge("x".repeat(65), "login", null)).resolves.toBeNull()
  })
})

describe("normalisePasskeyName", () => {
  it("trims and bounds", () => {
    expect(normalisePasskeyName("  My phone ")).toBe("My phone")
    expect(normalisePasskeyName("")).toBeNull()
    expect(normalisePasskeyName("x".repeat(51))).toBeNull()
    expect(normalisePasskeyName(5)).toBeNull()
  })
})
