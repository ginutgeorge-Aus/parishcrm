/** @jest-environment node */
import { issueFormToken, verifyFormToken } from "@/lib/formToken"

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-formtoken"
})

describe("formToken", () => {
  it("round-trips a token aged within the valid window", () => {
    const now = 1_000_000_000_000
    const token = issueFormToken(now - 5_000)
    expect(verifyFormToken(token, now)).toBe("ok")
  })

  it("reports missing for empty / non-string input", () => {
    expect(verifyFormToken("", 0)).toBe("missing")
    expect(verifyFormToken(undefined, 0)).toBe("missing")
    expect(verifyFormToken(null, 0)).toBe("missing")
    expect(verifyFormToken(123, 0)).toBe("missing")
  })

  it("reports bad for a malformed token (no signature)", () => {
    expect(verifyFormToken("123456", 200_000)).toBe("bad")
    expect(verifyFormToken(".sig", 200_000)).toBe("bad")
  })

  it("reports bad for a tampered timestamp (signature mismatch)", () => {
    const now = 1_000_000_000_000
    const token = issueFormToken(now - 5_000)
    const [, sig] = token.split(".")
    // Forge an older timestamp to try to skip the timing trap — sig won't match.
    const forged = `${now - 60_000}.${sig}`
    expect(verifyFormToken(forged, now)).toBe("bad")
  })

  it("reports bad for a forged signature", () => {
    const now = 1_000_000_000_000
    expect(verifyFormToken(`${now - 5_000}.deadbeef`, now)).toBe("bad")
  })

  it("reports tooFast when submitted under 3s", () => {
    const now = 1_000_000_000_000
    expect(verifyFormToken(issueFormToken(now - 500), now)).toBe("tooFast")
    expect(verifyFormToken(issueFormToken(now - 2_999), now)).toBe("tooFast")
  })

  it("reports ok at the 3s boundary", () => {
    const now = 1_000_000_000_000
    expect(verifyFormToken(issueFormToken(now - 3_000), now)).toBe("ok")
  })

  it("reports expired beyond the 2h max age", () => {
    const now = 1_000_000_000_000
    expect(verifyFormToken(issueFormToken(now - 2 * 60 * 60 * 1000 - 1), now)).toBe("expired")
  })

  it("a token signed under a different secret fails verification", () => {
    const now = 1_000_000_000_000
    const token = issueFormToken(now - 5_000)
    process.env.AUTH_SECRET = "a-different-secret"
    expect(verifyFormToken(token, now)).toBe("bad")
    process.env.AUTH_SECRET = "test-secret-for-formtoken"
  })
})
