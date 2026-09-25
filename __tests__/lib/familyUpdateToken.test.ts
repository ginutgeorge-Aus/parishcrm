import { generateInviteToken, hashInviteToken } from "@/lib/familyUpdateToken"

describe("familyUpdateToken", () => {
  it("generates a urlsafe token of adequate length", () => {
    const t = generateInviteToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(t.length).toBeGreaterThanOrEqual(43)
  })
  it("generates a unique token each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken())
  })
  it("hashes deterministically (same input → same hash)", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"))
  })
  it("produces a 64-char hex sha256 hash", () => {
    expect(hashInviteToken("abc")).toMatch(/^[0-9a-f]{64}$/)
  })
  it("different tokens hash differently", () => {
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"))
  })
})
