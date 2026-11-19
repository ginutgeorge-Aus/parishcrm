/** @jest-environment node */
import { canonicalStoredToken, hashToken, isHashedToken, storedTokenMatches, tokenLookupCandidates } from "@/lib/tokenHash"

describe("tokenHash", () => {
  it("hashes to 64 hex chars, deterministically", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(isHashedToken(hashToken("x"))).toBe(true)
  })
  it("does not mistake a raw token for a digest", () => {
    expect(isHashedToken("Lw63TEtFJDHsYwCSgUs70WM1")).toBe(false)
  })
  it("treats an uppercased digest as a digest, not a raw token", () => {
    expect(isHashedToken("A".repeat(64))).toBe(true)
    expect(storedTokenMatches("secret", hashToken("secret").toUpperCase())).toBe(true)
  })
  it("matches the URL token against a stored digest", () => {
    expect(storedTokenMatches("secret", hashToken("secret"))).toBe(true)
    expect(storedTokenMatches("other", hashToken("secret"))).toBe(false)
  })
  it("still matches a legacy raw stored token until the backfill hashes it", () => {
    expect(storedTokenMatches("secret", "secret")).toBe(true)
    expect(storedTokenMatches("other", "secret")).toBe(false)
  })
  it("lookup candidates: digest plus legacy raw, but never a raw 64-hex token", () => {
    expect(tokenLookupCandidates("secret")).toEqual([hashToken("secret"), "secret"])
    const hex = hashToken("secret")
    expect(tokenLookupCandidates(hex)).toEqual([hashToken(hex)])
  })
  it("canonicalStoredToken hashes a raw token, lowercases an uppercased digest, and leaves a canonical digest alone", () => {
    const digest = hashToken("secret")
    expect(canonicalStoredToken("secret")).toBe(digest)
    expect(canonicalStoredToken(digest.toUpperCase())).toBe(digest)
    expect(canonicalStoredToken(digest)).toBeNull()
  })
  it("never matches empty input, and a digest is not itself a valid URL token", () => {
    expect(storedTokenMatches("", hashToken("secret"))).toBe(false)
    expect(storedTokenMatches("secret", "")).toBe(false)
    expect(storedTokenMatches(hashToken("secret"), hashToken("secret"))).toBe(false)
  })
})
