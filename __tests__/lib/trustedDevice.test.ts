/** @jest-environment node */
const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV, AUTH_SECRET: "test-secret-value" }
})
afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("trustedDevice helpers", () => {
  it("generates a unique base64url token of meaningful length", () => {
    const { generateDeviceToken } = require("@/lib/trustedDevice")
    const a = generateDeviceToken()
    const b = generateDeviceToken()
    expect(a).not.toEqual(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(40)
  })

  it("hashes deterministically and never returns the raw token", () => {
    const { hashDeviceToken } = require("@/lib/trustedDevice")
    const token = "abc123"
    const h1 = hashDeviceToken(token)
    const h2 = hashDeviceToken(token)
    expect(h1).toEqual(h2)
    expect(h1).not.toContain(token)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("parses the cookie value out of a raw Cookie header", () => {
    const { parseTrustedDeviceCookie } = require("@/lib/trustedDevice")
    expect(
      parseTrustedDeviceCookie("foo=1; trusted_device=THE_TOKEN; bar=2")
    ).toBe("THE_TOKEN")
    expect(parseTrustedDeviceCookie("foo=1; bar=2")).toBeNull()
    expect(parseTrustedDeviceCookie(null)).toBeNull()
    expect(parseTrustedDeviceCookie(undefined)).toBeNull()
  })

  it("TTL is 14 days in ms", () => {
    const { TRUSTED_DEVICE_TTL_MS } = require("@/lib/trustedDevice")
    expect(TRUSTED_DEVICE_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })
})


test("pending grants cannot match a trusted-device cookie hash", () => {
  const { DEVICE_TRUST_GRANT_PREFIX, generateDeviceToken, hashDeviceToken } = require("@/lib/trustedDevice")
  const nonce = generateDeviceToken()
  const pendingHash = DEVICE_TRUST_GRANT_PREFIX + hashDeviceToken(nonce)
  expect(pendingHash).not.toMatch(/^[0-9a-f]{64}$/)
  for (const cookie of [nonce, pendingHash, "grant1"]) {
    expect(hashDeviceToken(cookie)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDeviceToken(cookie)).not.toBe(pendingHash)
  }
})
