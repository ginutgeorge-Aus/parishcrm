/**
 * @jest-environment node
 */
import {
  resolveEmailHash,
  decryptPersonScalars,
  decryptFamilyScalars,
  decryptTransactionForExport,
  decryptRegistrationForExport,
  decryptClearanceForExport,
} from "@/lib/personExport"
import { hmacEmail, encrypt } from "@/lib/crypto"

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

describe("decryptPersonScalars", () => {
  it("decrypts every encrypted-at-rest field and leaves other fields untouched", () => {
    const person = {
      id: 1,
      firstName: "Ann",
      dateOfBirth: encrypt("1990-01-01"),
      mobile: encrypt("0412345678"),
      workPhone: encrypt("0298765432"),
      homePhone: encrypt("0298765433"),
      notes: encrypt("note"),
      pastoralNotes: encrypt("pastoral note"),
      emergencyContactName: encrypt("Bob"),
      emergencyContactPhone: encrypt("0412000000"),
    }
    const result = decryptPersonScalars(person)
    expect(result).toMatchObject({
      id: 1,
      firstName: "Ann",
      dateOfBirth: "1990-01-01",
      mobile: "0412345678",
      workPhone: "0298765432",
      homePhone: "0298765433",
      notes: "note",
      pastoralNotes: "pastoral note",
      emergencyContactName: "Bob",
      emergencyContactPhone: "0412000000",
    })
  })

  it("passes null fields through as null", () => {
    const person = {
      dateOfBirth: null, mobile: null, workPhone: null, homePhone: null,
      notes: null, pastoralNotes: null, emergencyContactName: null, emergencyContactPhone: null,
    }
    expect(decryptPersonScalars(person)).toEqual(person)
  })
})

describe("decryptFamilyScalars", () => {
  it("decrypts every encrypted-at-rest field", () => {
    const family = {
      id: 5,
      address: encrypt("1 Church St"),
      suburb: encrypt("Newcastle"),
      state: encrypt("NSW"),
      postcode: encrypt("2300"),
      homePhone: encrypt("0298765432"),
      notes: encrypt("note"),
    }
    const result = decryptFamilyScalars(family)
    expect(result).toMatchObject({
      id: 5, address: "1 Church St", suburb: "Newcastle", state: "NSW",
      postcode: "2300", homePhone: "0298765432", notes: "note",
    })
  })

  it("passes null fields through as null", () => {
    const family = { address: null, suburb: null, state: null, postcode: null, homePhone: null, notes: null }
    expect(decryptFamilyScalars(family)).toEqual(family)
  })
})

describe("decryptTransactionForExport", () => {
  it("stringifies amount, decrypts description, and maps receiptSends", () => {
    const tx = {
      id: 9,
      amount: { toString: () => "12.50" },
      description: encrypt("Offering"),
      receiptSends: [{ sentTo: encrypt("member@example.com") }],
    }
    const result = decryptTransactionForExport(tx)
    expect(result).toMatchObject({
      id: 9,
      amount: "12.50",
      description: "Offering",
      receiptSends: [{ sentTo: "member@example.com" }],
    })
  })

  it("decrypts encrypted notes and keeps a null notes as null", () => {
    const base = { amount: { toString: () => "1.00" }, description: encrypt("Gift"), receiptSends: [] }
    expect(decryptTransactionForExport({ ...base, notes: encrypt("Paid by cousin") }).notes).toBe("Paid by cousin")
    expect(decryptTransactionForExport({ ...base, notes: null }).notes).toBeNull()
    expect(decryptTransactionForExport({ ...base, notes: "" }).notes).toBe("")
  })
})

describe("decryptRegistrationForExport", () => {
  it("decrypts email and phone, and returns null for both when absent", () => {
    const registration = { email: encrypt("reg@example.com"), phone: encrypt("0412345678"), customAnswers: null }
    expect(decryptRegistrationForExport(registration)).toMatchObject({
      email: "reg@example.com", phone: "0412345678", customAnswers: null,
    })
    const bare = { email: null, phone: null, customAnswers: null }
    expect(decryptRegistrationForExport(bare)).toEqual(bare)
  })

  it("decrypts and parses an encrypted-whole JSON customAnswers string", () => {
    const registration = { email: null, phone: null, customAnswers: encrypt(JSON.stringify({ q1: "yes" })) }
    expect(decryptRegistrationForExport(registration).customAnswers).toEqual({ q1: "yes" })
  })

  it("passes a legacy plaintext-object customAnswers through unchanged", () => {
    const registration = { email: null, phone: null, customAnswers: { q1: "yes" } }
    expect(decryptRegistrationForExport(registration).customAnswers).toEqual({ q1: "yes" })
  })

  it("returns null for a corrupt encrypted customAnswers string instead of throwing", () => {
    const registration = { email: null, phone: null, customAnswers: "enc:not-valid-ciphertext" }
    expect(decryptRegistrationForExport(registration).customAnswers).toBeNull()
  })
})

describe("decryptClearanceForExport", () => {
  const base = {
    type: "WWCC",
    number: encrypt("WWC0000000E"),
    expiresAt: new Date("2027-03-04T00:00:00.000Z"),
    documentName: encrypt("wwcc.pdf"),
    documentType: "application/pdf",
    documentSize: 1234,
    verifiedAt: new Date("2026-10-01T01:02:03.000Z"),
    verifiedBy: { name: "Admin User" },
    verificationNote: encrypt("Checked on portal"),
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T01:02:03.000Z"),
  }

  it("decrypts fields, formats expiry as YYYY-MM-DD and flattens the verifier name", () => {
    expect(decryptClearanceForExport(base)).toEqual({
      type: "WWCC",
      number: "WWC0000000E",
      expiresAt: "2027-03-04",
      documentName: "wwcc.pdf",
      documentType: "application/pdf",
      documentSize: 1234,
      verifiedAt: base.verifiedAt,
      verifiedBy: "Admin User",
      verificationNote: "Checked on portal",
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    })
  })

  it("returns nulls for absent fields and never carries a document blob", () => {
    const bare = {
      ...base, number: null, expiresAt: null, documentName: null, documentType: null,
      documentSize: null, verifiedAt: null, verifiedBy: null, verificationNote: null,
      document: Buffer.from("secret"),
    }
    const out = decryptClearanceForExport(bare)
    expect(out).toMatchObject({ number: null, expiresAt: null, documentName: null, verifiedBy: null, verificationNote: null })
    expect(out).not.toHaveProperty("document")
  })
})
