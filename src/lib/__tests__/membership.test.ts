/** @jest-environment node */
import { membershipPayloadSchema, encryptPayload, readPayload, buildNotesBlock, deriveFamilyName, officeSignatureLabel, overseasFieldLabels } from "@/lib/membership"
import { encrypt } from "@/lib/crypto"

const base = {
  personal: { name: "John Miller", gender: "MALE", dateOfBirth: "1980-01-02", email: "john@example.com",
    mobile: "0400111222", address: "1 Example St", suburb: "Sampletown", state: "NSW", postcode: "2000",
    qualificationProfession: "Engineer", motherParish: "Grace", addressInIndia: "Chennai",
    dateOfArrivalNsw: "2015-03-01", maritalStatus: "MARRIED", transferCertFurnished: true },
  spouse: { name: "Mary Miller", dateOfBirth: "1982-05-06", dateOfMarriage: "2005-06-07", parish: "Grace", working: true, email: "mary@example.com" },
  children: [{ name: "Anna Miller", sex: "F", dateOfBirth: "2010-01-01", occupation: null, phoneEmail: null }],
  dependents: [],
  relativesInAustralia: [{ name: "Sam", place: "Sydney", relationship: "Brother", phoneEmail: "sam@x.com" }],
  subscription: { monthlyAmount: 80 },
  declaration: { place: "Springfield", date: "2026-07-09" },
}

it("accepts a valid payload", () => {
  expect(membershipPayloadSchema.safeParse(base).success).toBe(true)
})
// The dues floor is the configurable membershipMinDues, enforced in the submit
// action — the schema itself only rejects negatives (readPayload stays lenient).
it("accepts any non-negative subscription", () => {
  expect(membershipPayloadSchema.safeParse({ ...base, subscription: { monthlyAmount: 0 } }).success).toBe(true)
  expect(membershipPayloadSchema.safeParse({ ...base, subscription: { monthlyAmount: 50 } }).success).toBe(true)
})
it("rejects a negative subscription", () => {
  expect(membershipPayloadSchema.safeParse({ ...base, subscription: { monthlyAmount: -1 } }).success).toBe(false)
})
it("rejects an unbounded monthlyAmount that would overflow Decimal(10,2)", () => {
  expect(membershipPayloadSchema.safeParse({ ...base, subscription: { monthlyAmount: 1e20 } }).success).toBe(false)
})
it("rejects a non-finite monthlyAmount", () => {
  expect(membershipPayloadSchema.safeParse({ ...base, subscription: { monthlyAmount: Infinity } }).success).toBe(false)
})
it("accepts a monthlyAmount at the upper bound", () => {
  expect(membershipPayloadSchema.safeParse({ ...base, subscription: { monthlyAmount: 100_000 } }).success).toBe(true)
})
it("rejects missing name/email/address", () => {
  const bad = { ...base, personal: { ...base.personal, name: "" } }
  expect(membershipPayloadSchema.safeParse(bad).success).toBe(false)
})
it("rejects an oversized free-text string field", () => {
  const bad = { ...base, personal: { ...base.personal, qualificationProfession: "x".repeat(10_000) } }
  expect(membershipPayloadSchema.safeParse(bad).success).toBe(false)
})
it("rejects a malformed declaration date", () => {
  const bad = { ...base, declaration: { place: "Springfield", date: "not-a-date" } }
  expect(membershipPayloadSchema.safeParse(bad).success).toBe(false)
})
it("accepts a null declaration date", () => {
  const ok = { ...base, declaration: { place: "Springfield", date: null } }
  expect(membershipPayloadSchema.safeParse(ok).success).toBe(true)
})
it("rejects a malformed spouse marriage date", () => {
  const bad = { ...base, spouse: { ...base.spouse, dateOfMarriage: "not-a-date" } }
  expect(membershipPayloadSchema.safeParse(bad).success).toBe(false)
})
it.each(["2025-02-31", "2025-04-31", "2025-02-29", "2025-13-01"])("rejects impossible calendar date %s in both date fields", (d) => {
  expect(membershipPayloadSchema.safeParse({ ...base, spouse: { ...base.spouse, dateOfMarriage: d } }).success).toBe(false)
  expect(membershipPayloadSchema.safeParse({ ...base, declaration: { place: "Springfield", date: d } }).success).toBe(false)
})
it("accepts a leap-day date", () => {
  expect(membershipPayloadSchema.safeParse({ ...base, spouse: { ...base.spouse, dateOfMarriage: "2024-02-29" } }).success).toBe(true)
  expect(membershipPayloadSchema.safeParse({ ...base, declaration: { place: "Springfield", date: "2024-02-29" } }).success).toBe(true)
})
it("encrypts and reads back the same payload", () => {
  const enc = encryptPayload(base as never)
  expect(enc).not.toContain("John Miller")
  expect(readPayload(enc).personal.name).toBe("John Miller")
})
it("throws on a malformed decrypted payload", () => {
  const enc = encrypt(JSON.stringify({ personal: { name: "" } }))
  expect(() => readPayload(enc)).toThrow()
})
it("notes block includes India address, mother parish, relatives", () => {
  const n = buildNotesBlock(base as never, { homeAddressLabel: "Address in India", arrivalDateLabel: "" })
  expect(n).toContain("Address in India: Chennai")
  expect(n).toContain("Relatives in Australia")
  expect(n).toContain("  - Sam, Sydney (Brother) — sam@x.com")
  expect(n).toContain("Spouse's church: Grace")
})
it("notes block omits unavailable relative details", () => {
  const p = { ...base, relativesInAustralia: [{ name: "Lee", place: null, relationship: null, phoneEmail: null }] }
  const n = buildNotesBlock(p as never, { homeAddressLabel: "Address in India", arrivalDateLabel: "" })
  expect(n).toMatch(/^  - Lee$/m)
})
it("notes block falls back to generic overseas labels when unconfigured", () => {
  const n = buildNotesBlock(base as never, { homeAddressLabel: "", arrivalDateLabel: "" })
  expect(n).toContain("Home-country address: Chennai")
  expect(n).toContain("Date of arrival: 2015-03-01")
  expect(n).not.toMatch(/in India|arrival in Australia/)
})
it("derives family name from surname", () => {
  expect(deriveFamilyName(base as never)).toBe("Miller")
})

describe("officeSignatureLabel", () => {
  it("uses the signer title, falling back to Minister", () => {
    expect(officeSignatureLabel("Vicar")).toBe("Signature of the Vicar")
    expect(officeSignatureLabel("  ")).toBe("Signature of the Minister")
  })
})

describe("overseasFieldLabels", () => {
  const legacy = base as never
  it("prefers the label stored with the submission over the current setting", () => {
    const p = { ...base, fieldLabels: { homeAddress: "Address in India", arrivalDate: null } } as never
    expect(overseasFieldLabels(p, { homeAddressLabel: "Home address abroad", arrivalDateLabel: "Arrived" })).toEqual({ homeAddress: "Address in India", arrivalDate: "Arrived" })
  })
  it("legacy payloads use the configured label, then the generic one", () => {
    expect(overseasFieldLabels(legacy, { homeAddressLabel: "Address in India", arrivalDateLabel: "Arrived NSW" })).toEqual({ homeAddress: "Address in India", arrivalDate: "Arrived NSW" })
    expect(overseasFieldLabels(legacy, { homeAddressLabel: "", arrivalDateLabel: "" })).toEqual({ homeAddress: "Home-country address", arrivalDate: "Date of arrival" })
  })
  it("readPayload accepts payloads with and without stored labels", () => {
    expect(membershipPayloadSchema.safeParse(base).success).toBe(true)
    expect(membershipPayloadSchema.safeParse({ ...base, fieldLabels: { homeAddress: "x".repeat(81), arrivalDate: null } }).success).toBe(false)
  })
})
