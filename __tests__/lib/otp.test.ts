import { generateOtp, hashOtp } from "@/lib/otp"

jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Test Church", address: "", abn: "", email: "", website: "" })),
}))

describe("generateOtp", () => {
  it("returns a 6-digit string", () => {
    const otp = generateOtp()
    expect(otp).toMatch(/^\d{6}$/)
  })

  it("is within valid range", () => {
    for (let i = 0; i < 100; i++) {
      const n = parseInt(generateOtp(), 10)
      expect(n).toBeGreaterThanOrEqual(100000)
      expect(n).toBeLessThanOrEqual(999999)
    }
  })

  it("rejection-samples draws in the biased top bucket and re-rolls", () => {
    // OTP_LIMIT = 2^32 - (2^32 % 900000) = 4294800000. A draw >= limit must be
    // discarded; the next draw (5) maps to 100005.
    const spy = jest
      .spyOn(global.crypto, "getRandomValues")
      .mockImplementationOnce((arr) => { (arr as Uint32Array)[0] = 4294900000; return arr })
      .mockImplementationOnce((arr) => { (arr as Uint32Array)[0] = 5; return arr })
    expect(generateOtp()).toBe("100005")
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

describe("hashOtp", () => {
  const originalSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret"
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalSecret
  })

  it("returns a deterministic 64-char hex digest", () => {
    const a = hashOtp("123456")
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashOtp("123456")).toBe(a)
  })

  it("produces different digests for different codes", () => {
    expect(hashOtp("123456")).not.toBe(hashOtp("123457"))
  })

  it("produces different digests under different secrets (HMAC, not plain SHA-256)", () => {
    const a = hashOtp("123456")
    process.env.AUTH_SECRET = "other-secret"
    expect(hashOtp("123456")).not.toBe(a)
  })

  it("throws when AUTH_SECRET is missing", () => {
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    expect(() => hashOtp("123456")).toThrow("AUTH_SECRET")
  })

  it("falls back to NEXTAUTH_SECRET when AUTH_SECRET is unset", () => {
    const withAuth = hashOtp("123456")
    delete process.env.AUTH_SECRET
    process.env.NEXTAUTH_SECRET = "test-secret"
    expect(hashOtp("123456")).toBe(withAuth)
    delete process.env.NEXTAUTH_SECRET
  })
})
