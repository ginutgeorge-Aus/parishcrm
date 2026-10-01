/** @jest-environment node */
import { Secret, TOTP } from "otpauth"
import {
  generateTotpSecret,
  totpKeyUri,
  matchTotpStep,
  generateBackupCodes,
  normaliseBackupCode,
  BACKUP_CODE_RE,
} from "@/lib/totp"

const NOW = 1_790_000_000_000 // fixed instant
const STEP = Math.floor(NOW / 1000 / 30)

function codeAt(secret: string, timestamp: number) {
  return new TOTP({ secret: Secret.fromBase32(secret), algorithm: "SHA1", digits: 6, period: 30 }).generate({ timestamp })
}

describe("totp primitives", () => {
  const secret = generateTotpSecret()

  it("generates a 32-char base32 secret (20 bytes)", () => {
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(generateTotpSecret()).not.toBe(secret)
  })

  it("builds an otpauth URI with issuer and email label", () => {
    const uri = totpKeyUri(secret, "admin@example.com", "Demo Church")
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain("issuer=Demo%20Church")
    expect(uri).toContain(`secret=${secret}`)
    expect(uri).toContain("admin%40example.com")
  })

  it.each([-1, 0, 1])("matches a code from step offset %i and returns that step", (offset) => {
    const code = codeAt(secret, NOW + offset * 30_000)
    expect(matchTotpStep(secret, code, NOW)).toBe(STEP + offset)
  })

  it.each([-2, 2])("rejects a code from step offset %i", (offset) => {
    expect(matchTotpStep(secret, codeAt(secret, NOW + offset * 30_000), NOW)).toBeNull()
  })

  it("rejects non-6-digit input without throwing", () => {
    expect(matchTotpStep(secret, "12345", NOW)).toBeNull()
    expect(matchTotpStep(secret, "abcdef", NOW)).toBeNull()
  })

  it("generates 10 unique grouped backup codes", () => {
    const codes = generateBackupCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) {
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
      expect(BACKUP_CODE_RE.test(normaliseBackupCode(c))).toBe(true)
    }
  })

  it("normalises case, dashes and spaces", () => {
    expect(normaliseBackupCode(" ab3cd-ef4gh ")).toBe("AB3CDEF4GH")
    expect(normaliseBackupCode("ab3cd ef4gh")).toBe("AB3CDEF4GH")
  })
})
