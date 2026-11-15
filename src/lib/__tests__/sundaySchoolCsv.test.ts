import { buildRosterCsv, parseEnrolmentCsv, rosterFilename, MAX_ENROL_ROWS } from "@/lib/sundaySchoolCsv"

const HEAD = "family_name,first_name,last_name,class_name,location\n"

describe("parseEnrolmentCsv", () => {
  it("parses rows, trims, handles BOM and quoted commas", () => {
    const r = parseEnrolmentCsv(`﻿${HEAD}Smith, Ava ,Smith,"Years 1,2",Main\nJones,Cara,Jones,Kindy,`)
    expect(r.errors).toEqual([])
    expect(r.rows).toEqual([
      { row: 2, familyName: "Smith", firstName: "Ava", lastName: "Smith", className: "Years 1,2", location: "Main" },
      { row: 3, familyName: "Jones", firstName: "Cara", lastName: "Jones", className: "Kindy", location: undefined },
    ])
  })
  it("reports missing columns", () => {
    const r = parseEnrolmentCsv("family_name,first_name\nA,B")
    expect(r.rows).toEqual([])
    expect(r.errors[0].message).toBe("Missing columns: last_name, class_name")
  })
  it("reports per-row required and length errors", () => {
    const r = parseEnrolmentCsv(`${HEAD}Smith,,Smith,Kindy,\nSmith,Ava,Smith,${"x".repeat(81)},`)
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([
      [2, "first_name is required"],
      [3, "class_name must be 80 characters or fewer"],
    ])
  })
  it("collapses a same-class duplicate and rejects a different-class one", () => {
    const r = parseEnrolmentCsv(`${HEAD}A,B,C,Kindy,\na,b,c,kindy,\nA,B,C,Year 1,`)
    expect(r.rows).toHaveLength(1)
    expect(r.errors).toEqual([{ row: 4, message: "B C is already listed for a different class in this file" }])
  })
  it("caps the row count", () => {
    const body = Array.from({ length: MAX_ENROL_ROWS + 1 }, (_, i) => `F,N${i},L,Kindy,`).join("\n")
    expect(parseEnrolmentCsv(HEAD + body).errors[0].message).toMatch(/too many rows/)
  })
  it("survives a __proto__ family name", () => {
    expect(parseEnrolmentCsv(`${HEAD}__proto__,A,B,Kindy,`).rows).toHaveLength(1)
  })
})

describe("buildRosterCsv", () => {
  const cls = { name: "Years 1-2", level: 1, location: "Main, hall", year: 2026 }
  it("writes header and escaped rows", () => {
    expect(buildRosterCsv(cls, [{ firstName: "Ava", lastName: "Smith", familyName: "Smith" }])).toBe(
      'Student,Family,Class,Level,Location,Year\r\nAva Smith,Smith,Years 1-2,1,"Main, hall",2026\r\n',
    )
  })
  it("neutralises formula injection", () => {
    const out = buildRosterCsv(cls, [{ firstName: "=cmd", lastName: "x", familyName: "@fam" }])
    expect(out).toContain("'=cmd x,'@fam")
  })
  it("builds a safe filename", () => {
    expect(rosterFilename({ name: "Years 1/2 ../x", year: 2026 })).toBe("sunday-school-years-1-2-x-2026.csv")
  })
})
