import { escapeCsv } from "@/lib/csvUtils"
import {
  GroupFormSchema, GROUP_CSV_HEADERS, groupCsvCells, MemberFieldsSchema, parseCategoryFilter, sortMembers,
} from "@/lib/groups"

describe("parseCategoryFilter", () => {
  it("accepts known categories only", () => {
    expect(parseCategoryFilter("MINISTRY")).toBe("MINISTRY")
    expect(parseCategoryFilter("COMMITTEE")).toBe("COMMITTEE")
    expect(parseCategoryFilter("ministry")).toBeNull()
    expect(parseCategoryFilter("DROP")).toBeNull()
    expect(parseCategoryFilter(undefined)).toBeNull()
  })
})

describe("schemas", () => {
  it("validates and trims the group form", () => {
    expect(GroupFormSchema.parse({ name: "  Choir ", category: "MINISTRY" })).toEqual({ name: "Choir", category: "MINISTRY", description: "" })
    expect(GroupFormSchema.safeParse({ name: "", category: "MINISTRY" }).success).toBe(false)
    expect(GroupFormSchema.safeParse({ name: "x".repeat(101), category: "MINISTRY" }).success).toBe(false)
    expect(GroupFormSchema.safeParse({ name: "Choir", category: "BAD" }).success).toBe(false)
  })

  it("bounds member role and title", () => {
    expect(MemberFieldsSchema.parse({ role: "LEADER", title: " Secretary " })).toEqual({ role: "LEADER", title: "Secretary" })
    expect(MemberFieldsSchema.safeParse({ role: "OWNER", title: "" }).success).toBe(false)
    expect(MemberFieldsSchema.safeParse({ role: "MEMBER", title: "x".repeat(61) }).success).toBe(false)
  })
})

describe("sortMembers", () => {
  it("puts leaders first, then sorts by surname and first name", () => {
    const rows = [
      { role: "MEMBER" as const, lastName: "Adams", firstName: "Zoe" },
      { role: "LEADER" as const, lastName: "Young", firstName: "Amy" },
      { role: "MEMBER" as const, lastName: "Adams", firstName: "Ann" },
    ]
    expect(sortMembers(rows).map((r) => r.firstName)).toEqual(["Amy", "Ann", "Zoe"])
  })
})

describe("groupCsvCells", () => {
  it("emits a header and one row per member, neutralising formula cells once escaped", () => {
    const cells = groupCsvCells([{
      firstName: "=cmd|' /C calc'!A0", lastName: "Doe", familyName: "Doe", role: "LEADER",
      title: "@SUM(1)", joinedAt: new Date("2026-11-01T00:00:00Z"), email: "a@example.com", mobile: "+61400000000",
    }])
    expect(cells[0]).toEqual(GROUP_CSV_HEADERS)
    const line = cells[1].map(escapeCsv)
    expect(line[1]).toBe("'=cmd|' /C calc'!A0")
    expect(line[3]).toBe("Leader")
    expect(line[4]).toBe("'@SUM(1)")
    expect(line[5]).toBe("2026-11-01")
    expect(line[7]).toBe("'+61400000000")
  })

  it("uses the Sydney calendar day for the joined date", () => {
    const cells = groupCsvCells([{
      firstName: "A", lastName: "B", familyName: "B", role: "MEMBER", title: "",
      joinedAt: new Date("2026-11-01T20:00:00Z"), email: "", mobile: "",
    }])
    expect(cells[1][5]).toBe("2026-11-02")
  })
})
