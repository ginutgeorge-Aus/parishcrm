/** @jest-environment node */
import {
  parseComplianceFilter, dmy, batchRowIssues, isBatchRowReady, batchRowTsv, batchTsv, type WwccBatchRow,
} from "@/lib/clearanceComplianceView"

const row = (over: Partial<WwccBatchRow> = {}): WwccBatchRow => ({
  clearanceId: "c1", personId: 10, familyName: "Testperson", givenName: "Alex",
  dobDmy: "05/03/1990", number: "WWC0000000E", status: "UNVERIFIED",
  expiresDmy: "01/06/2027", verifiedDmy: null, updatedAt: "2026-09-30T01:02:03.000Z", ...over,
})

describe("parseComplianceFilter", () => {
  it.each(["expired", "expiring", "missing", "unverified"])("accepts %s", (v) => {
    expect(parseComplianceFilter(v)).toBe(v)
  })
  it.each([undefined, "", "EXPIRED", "verified", "x"])("rejects %s", (v) => {
    expect(parseComplianceFilter(v)).toBeNull()
  })
})

describe("dmy", () => {
  it("formats a UTC-midnight date as dd/mm/yyyy", () => {
    expect(dmy(new Date("2027-06-01T00:00:00.000Z"))).toBe("01/06/2027")
  })
  it("returns null for null", () => {
    expect(dmy(null)).toBeNull()
  })
})

describe("batch rows", () => {
  it("is ready when DOB and number are present", () => {
    expect(batchRowIssues(row())).toEqual([])
    expect(isBatchRowReady(row())).toBe(true)
  })
  it("flags a missing DOB and a missing number", () => {
    expect(batchRowIssues(row({ dobDmy: null }))).toEqual(["Missing date of birth"])
    expect(batchRowIssues(row({ number: null }))).toEqual(["Missing WWC number"])
    expect(batchRowIssues(row({ dobDmy: null, number: null }))).toHaveLength(2)
    expect(isBatchRowReady(row({ number: null }))).toBe(false)
  })
  it("renders one TSV line in OCG field order: family name, DOB, WWC number", () => {
    expect(batchRowTsv(row())).toBe("Testperson\t05/03/1990\tWWC0000000E")
  })
  it("strips tabs/newlines from cells so a paste cannot shift columns", () => {
    expect(batchRowTsv(row({ familyName: "Test\tperson\n" }))).toBe("Test person\t05/03/1990\tWWC0000000E")
  })
  it("joins only ready rows for copy-all", () => {
    const rows = [row(), row({ clearanceId: "c2", number: null }), row({ clearanceId: "c3", familyName: "Other" })]
    expect(batchTsv(rows)).toBe("Testperson\t05/03/1990\tWWC0000000E\nOther\t05/03/1990\tWWC0000000E")
  })
})
