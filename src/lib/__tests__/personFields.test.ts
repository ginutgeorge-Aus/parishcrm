jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  hmacEmail: jest.fn((v: string) => `hash:${v.trim().toLowerCase()}`),
  hmacMobile: jest.fn((v: string) => `mhash:${v.trim()}`),
}))

import { encryptPersonFields, PERSON_ENCRYPTED_KEYS } from "@/lib/personFields"

describe("encryptPersonFields", () => {
  it("encrypts every PII key and sets both blind indexes from plaintext", () => {
    const d: Record<string, string | null> = {
      email: "A@x.org", dateOfBirth: "1990-01-02", mobile: "0400000000",
      workPhone: "w", homePhone: "h", notes: "n", pastoralNotes: "p",
      emergencyContactName: "en", emergencyContactPhone: "ep",
      profession: "pr", maritalStatus: "ms",
    }
    const keys = Object.keys(d)
    encryptPersonFields(d)
    for (const k of keys) expect(d[k]).toMatch(/^enc:/)
    expect(d.emailHash).toBe("hash:a@x.org")
    expect(d.mobileHash).toBe("mhash:0400000000")
  })

  it("leaves absent keys and their hashes untouched", () => {
    const d: Record<string, string | null> = { firstName: "x" }
    encryptPersonFields(d)
    expect(d).toEqual({ firstName: "x" })
  })

  it("clears a blind index when its source is blank, never encrypting empties", () => {
    const d: Record<string, string | null> = { email: "", mobile: null, notes: "" }
    encryptPersonFields(d)
    expect(d).toEqual({ email: "", emailHash: null, mobile: null, mobileHash: null, notes: "" })
  })

  it("exposes the form-prefilled key list", () => {
    expect(PERSON_ENCRYPTED_KEYS).toContain("pastoralNotes")
    expect(PERSON_ENCRYPTED_KEYS).not.toContain("profession")
  })
})
