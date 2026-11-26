/** @jest-environment node */
// AUD-1-13: decryptStrict must refuse unencrypted text instead of passing it through.
describe("decryptStrict", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString("base64")
  })
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY
    jest.resetModules()
  })

  it("throws on plaintext (a base32 TOTP secret) that decrypt() would pass through", async () => {
    const { decrypt, decryptStrict } = await import("@/lib/crypto")
    expect(decrypt("JBSWY3DP")).toBe("JBSWY3DP")
    expect(() => decryptStrict("JBSWY3DP")).toThrow("not an encrypted value")
  })

  it("round-trips real ciphertext", async () => {
    const { encrypt, decryptStrict } = await import("@/lib/crypto")
    expect(decryptStrict(encrypt("JBSWY3DP"))).toBe("JBSWY3DP")
  })
})
