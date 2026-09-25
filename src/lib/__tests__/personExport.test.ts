/**
 * @jest-environment node
 */
import { resolveEmailHash } from "@/lib/personExport"
import { hmacEmail } from "@/lib/crypto"

describe("resolveEmailHash", () => {
  it("returns the stored emailHash when present, unchanged", () => {
    const stored = hmacEmail("someone@example.com")
    // A different email is passed alongside to prove the stored hash wins
    // and the email is not re-hashed (no double-decrypt/double-hash).
    expect(resolveEmailHash(stored, "other@example.com")).toBe(stored)
  })

  it("falls back to hashing the decrypted email when emailHash is null (legacy record)", () => {
    const email = "legacy@example.com"
    expect(resolveEmailHash(null, email)).toBe(hmacEmail(email))
  })

  it("matches the hash produced by the write path for the same email", () => {
    // Guards against the fallback drifting from how emailHash is computed on
    // write (src/lib/actions/person.ts, src/lib/eventRegistration.ts) — both
    // call hmacEmail directly, so the same input must produce the same hash.
    const email = "Person@Example.com"
    expect(resolveEmailHash(null, email)).toBe(hmacEmail(email))
  })

  it("returns null when there is no emailHash and no email", () => {
    expect(resolveEmailHash(null, null)).toBeNull()
  })
})
