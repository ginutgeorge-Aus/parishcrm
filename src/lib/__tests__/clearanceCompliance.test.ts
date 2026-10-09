/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { person: { findMany: jest.fn() }, personClearance: { findMany: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => (v === "enc:bad" ? "[decryption error]" : v.replace(/^enc:/, ""))),
}))

import { prisma } from "@/lib/prisma"
import {
  toComplianceRow, matchesFilter, filterRows, bucketCompliance, bucketsEmpty, countFlaggedPeople,
  loadComplianceRows, loadWwccVerifyBatch, COMPLIANCE_CAP, type CompliancePerson,
} from "@/lib/clearanceCompliance"

const TODAY = new Date("2026-10-06T00:00:00.000Z")
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

const person = (over: Partial<CompliancePerson> = {}): CompliancePerson => ({
  id: 1, firstName: "Alex", lastName: "Testperson", ministryRoles: ["SUNDAY_SCHOOL_TEACHER"],
  family: { name: "Testperson Family" }, clearances: [], ...over,
})
const clr = (type: "WWCC" | "SAFE_MINISTRY", over: Record<string, unknown> = {}) => ({
  id: type === "WWCC" ? "c11" : "c12", type, number: "enc:WWC0000000E",
  expiresAt: d("2027-06-01"), verifiedAt: new Date("2026-09-01T00:00:00Z"), ...over,
})

describe("toComplianceRow", () => {
  it("marks both types MISSING for a ministry-role person with no clearances", () => {
    const r = toComplianceRow(person(), TODAY)
    expect(r.wwcc.status).toBe("MISSING")
    expect(r.safeMinistry.status).toBe("MISSING")
    expect(r.wwcc.clearanceId).toBeNull()
  })
  it("leaves an absent type null (not required) for a person with no ministry role", () => {
    const r = toComplianceRow(person({ ministryRoles: [], clearances: [clr("WWCC")] }), TODAY)
    expect(r.wwcc.status).toBe("VERIFIED")
    expect(r.safeMinistry.status).toBeNull()
  })
  it("maps statuses through clearanceStatus and exposes hasNumber, never the number", () => {
    const r = toComplianceRow(person({
      clearances: [clr("WWCC", { verifiedAt: null }), clr("SAFE_MINISTRY", { expiresAt: d("2026-09-01"), number: null })],
    }), TODAY)
    expect(r.wwcc.status).toBe("UNVERIFIED")
    expect(r.wwcc.hasNumber).toBe(true)
    expect(r.safeMinistry.status).toBe("EXPIRED")
    expect(r.safeMinistry.hasNumber).toBe(false)
    expect(JSON.stringify(r)).not.toContain("WWC0000000E")
  })
  it("flags a verified clearance expiring within 60 days as EXPIRING", () => {
    const r = toComplianceRow(person({ clearances: [clr("WWCC", { expiresAt: d("2026-11-15") })] }), TODAY)
    expect(r.wwcc.status).toBe("EXPIRING")
  })
})

describe("filters and buckets", () => {
  const rows = [
    toComplianceRow(person({ id: 1, firstName: "Alex", clearances: [clr("WWCC", { expiresAt: d("2026-09-01") })] }), TODAY), // WWCC expired, SM missing
    toComplianceRow(person({ id: 2, firstName: "Blake", clearances: [clr("WWCC"), clr("SAFE_MINISTRY")] }), TODAY), // all verified
    toComplianceRow(person({ id: 3, firstName: "Casey", clearances: [clr("WWCC", { verifiedAt: null }), clr("SAFE_MINISTRY", { expiresAt: d("2026-11-15") })] }), TODAY), // unverified + expiring
  ]
  it("matches a row when either cell has the status", () => {
    expect(filterRows(rows, "expired").map((r) => r.personId)).toEqual([1])
    expect(filterRows(rows, "missing").map((r) => r.personId)).toEqual([1])
    expect(filterRows(rows, "unverified").map((r) => r.personId)).toEqual([3])
    expect(filterRows(rows, "expiring").map((r) => r.personId)).toEqual([3])
    expect(filterRows(rows, null)).toHaveLength(3)
    expect(matchesFilter(rows[1], "expired")).toBe(false)
  })
  it("buckets names with the clearance types that triggered them, in row order", () => {
    const b = bucketCompliance(rows)
    expect(b.expired).toEqual([{ personId: 1, name: "Alex Testperson", types: ["WWCC"] }])
    expect(b.missing).toEqual([{ personId: 1, name: "Alex Testperson", types: ["SAFE_MINISTRY"] }])
    expect(b.unverified).toEqual([{ personId: 3, name: "Casey Testperson", types: ["WWCC"] }])
    expect(b.expiring).toEqual([{ personId: 3, name: "Casey Testperson", types: ["SAFE_MINISTRY"] }])
    expect(bucketsEmpty(b)).toBe(false)
    expect(countFlaggedPeople(b)).toBe(2)
  })
  it("reports empty buckets when everyone is verified", () => {
    const b = bucketCompliance([rows[1]])
    expect(bucketsEmpty(b)).toBe(true)
    expect(countFlaggedPeople(b)).toBe(0)
  })
})

describe("loadComplianceRows", () => {
  const findMany = prisma.person.findMany as jest.Mock
  beforeEach(() => jest.clearAllMocks())

  it("queries active people with a ministry role or any clearance and never selects document bytes", async () => {
    findMany.mockResolvedValue([person()])
    const { rows, truncated } = await loadComplianceRows(TODAY)
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      archivedAt: null,
      OR: [{ ministryRoles: { isEmpty: false } }, { clearances: { some: {} } }],
    })
    expect(arg.select.clearances.select.document).toBeUndefined()
    expect(arg.take).toBe(COMPLIANCE_CAP + 1)
    expect(rows).toHaveLength(1)
    expect(truncated).toBe(false)
  })
  it("flags truncation when the cap is exceeded", async () => {
    findMany.mockResolvedValue(Array.from({ length: COMPLIANCE_CAP + 1 }, (_, i) => person({ id: i + 1 })))
    const { rows, truncated } = await loadComplianceRows(TODAY)
    expect(rows).toHaveLength(COMPLIANCE_CAP)
    expect(truncated).toBe(true)
  })
})

describe("loadWwccVerifyBatch", () => {
  const findMany = prisma.personClearance.findMany as jest.Mock
  beforeEach(() => jest.clearAllMocks())

  const dbRow = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({
    id: "c11", number: "enc:WWC0000000E", expiresAt: d("2027-06-01"), verifiedAt: null,
    person: { id: 1, firstName: "Alex", lastName: "Testperson", dateOfBirth: "enc:1990-03-05", ...p },
    ...over,
  })

  it("keeps only never-verified, unexpired WWCC rows, decrypts DOB + number, formats dd/mm/yyyy", async () => {
    findMany.mockResolvedValue([
      dbRow(),                                                                                   // unverified
      dbRow({ id: "c12", expiresAt: d("2026-11-15") }),                                             // unverified + expiring: keep
      dbRow({ id: "c15", verifiedAt: new Date("2026-09-01T00:00:00Z"), expiresAt: d("2026-11-15") }), // verified + expiring: skip (renewal clears verification)
      dbRow({ id: "c13", verifiedAt: new Date("2026-09-01T00:00:00Z") }),                           // verified: skip
      dbRow({ id: "c14", expiresAt: d("2026-09-01") }),                                             // expired: skip
    ])
    const out = await loadWwccVerifyBatch(TODAY)
    expect(findMany.mock.calls[0][0].where).toEqual({ type: "WWCC", person: { archivedAt: null } })
    expect(out.map((r) => [r.clearanceId, r.status])).toEqual([["c11", "UNVERIFIED"], ["c12", "EXPIRING"]])
    expect(out[0]).toMatchObject({
      personId: 1, familyName: "Testperson", givenName: "Alex",
      dobDmy: "05/03/1990", number: "WWC0000000E", expiresDmy: "01/06/2027", verifiedDmy: null,
    })
    expect(out[1].verifiedDmy).toBeNull()
  })
  it("treats a missing or undecryptable DOB / number as null so the row is flagged, never pasted as junk", async () => {
    findMany.mockResolvedValue([
      dbRow({ number: null }, { dateOfBirth: null }),
      dbRow({ id: "c12", number: "enc:bad" }, { dateOfBirth: "enc:bad" }),
    ])
    const out = await loadWwccVerifyBatch(TODAY)
    expect(out[0]).toMatchObject({ dobDmy: null, number: null })
    expect(out[1]).toMatchObject({ dobDmy: null, number: null })
  })
})
