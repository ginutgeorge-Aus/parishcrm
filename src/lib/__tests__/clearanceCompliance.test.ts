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
  loadComplianceRows, capRows, loadWwccVerifyBatch, COMPLIANCE_CAP, type CompliancePerson,
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
  it("leaves a person with no ministry role out of every bucket, even with an expired WWCC", () => {
    const noRole = toComplianceRow(person({ id: 9, ministryRoles: [], clearances: [clr("WWCC", { expiresAt: d("2026-09-01") })] }), TODAY)
    expect(noRole.wwcc.status).toBe("EXPIRED") // still listed on the page
    const b = bucketCompliance([noRole])
    expect(bucketsEmpty(b)).toBe(true)
    expect(countFlaggedPeople(b)).toBe(0)
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
    const { rows } = await loadComplianceRows(TODAY)
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      archivedAt: null,
      OR: [{ ministryRoles: { isEmpty: false } }, { clearances: { some: {} } }],
    })
    expect(arg.select.clearances.select.document).toBeUndefined()
    expect(arg.take).toBeUndefined() // not capped: filters and the digest must see everyone
    expect(rows).toHaveLength(1)
  })
  it("returns more than COMPLIANCE_CAP people", async () => {
    findMany.mockResolvedValue(Array.from({ length: COMPLIANCE_CAP + 5 }, (_, i) => person({ id: i + 1 })))
    const { rows } = await loadComplianceRows(TODAY)
    expect(rows).toHaveLength(COMPLIANCE_CAP + 5)
  })
})

describe("capRows", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => toComplianceRow(person({ id: i + 1 }), TODAY))
  it("keeps everything at or under the cap", () => {
    const r = capRows(many(COMPLIANCE_CAP))
    expect(r.rows).toHaveLength(COMPLIANCE_CAP)
    expect(r.truncated).toBe(false)
  })
  it("cuts to the cap and flags truncation when over", () => {
    const r = capRows(many(COMPLIANCE_CAP + 1))
    expect(r.rows).toHaveLength(COMPLIANCE_CAP)
    expect(r.truncated).toBe(true)
  })
})

describe("loadWwccVerifyBatch", () => {
  const findMany = prisma.personClearance.findMany as jest.Mock
  beforeEach(() => jest.clearAllMocks())

  const dbRow = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({
    id: "c11", number: "enc:WWC0000000E", expiresAt: d("2027-06-01"), verifiedAt: null, updatedAt: new Date("2026-09-30T01:02:03.000Z"),
    person: { id: 1, firstName: "Alex", lastName: "Testperson", dateOfBirth: "enc:1990-03-05", updatedAt: new Date("2026-09-29T05:06:07.000Z"), ...p },
    ...over,
  })

  it("keeps only never-verified, unexpired WWCC rows, decrypts DOB + number, formats dd/mm/yyyy", async () => {
    // The DB applies the verified/expired filters (asserted on `where` below), so it returns only these.
    findMany.mockResolvedValue([
      dbRow(),                                       // unverified
      dbRow({ id: "c12", expiresAt: d("2026-11-15") }), // unverified + expiring: keep
    ])
    const { rows: out, truncated } = await loadWwccVerifyBatch(TODAY)
    expect(truncated).toBe(false)
    expect(findMany.mock.calls[0][0].where).toEqual({
      type: "WWCC", person: { archivedAt: null }, verifiedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gte: TODAY } }],
    })
    expect(findMany.mock.calls[0][0].take).toBe(COMPLIANCE_CAP + 1)
    expect(out.map((r) => [r.clearanceId, r.status])).toEqual([["c11", "UNVERIFIED"], ["c12", "EXPIRING"]])
    expect(out[0]).toMatchObject({
      personId: 1, familyName: "Testperson", givenName: "Alex",
      dobDmy: "05/03/1990", number: "WWC0000000E", expiresDmy: "01/06/2027",
      updatedAt: "2026-09-30T01:02:03.000Z", personUpdatedAt: "2026-09-29T05:06:07.000Z",
    })
    expect(out[0]).not.toHaveProperty("verifiedDmy")
  })
  it("flags truncation when more than the cap needs checking, returning only the cap", async () => {
    findMany.mockResolvedValue(Array.from({ length: COMPLIANCE_CAP + 1 }, (_, i) => dbRow({ id: `c${i}` })))
    const { rows, truncated } = await loadWwccVerifyBatch(TODAY)
    expect(rows).toHaveLength(COMPLIANCE_CAP)
    expect(truncated).toBe(true)
  })
  it("treats a missing or undecryptable DOB / number as null so the row is flagged, never pasted as junk", async () => {
    findMany.mockResolvedValue([
      dbRow({ number: null }, { dateOfBirth: null }),
      dbRow({ id: "c12", number: "enc:bad" }, { dateOfBirth: "enc:bad" }),
    ])
    const { rows: out } = await loadWwccVerifyBatch(TODAY)
    expect(out[0]).toMatchObject({ dobDmy: null, number: null })
    expect(out[1]).toMatchObject({ dobDmy: null, number: null })
  })
})
