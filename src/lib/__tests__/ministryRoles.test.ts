import {
  MINISTRY_ROLES,
  MINISTRY_ROLE_LABELS,
  parseMinistryRoles,
  parseMinistryRoleFilter,
} from "@/lib/ministryRoles"
import { MinistryRole } from "@/lib/generated/prisma/enums"

describe("MINISTRY_ROLES / MINISTRY_ROLE_LABELS", () => {
  it("lists every enum value exactly once, in display order", () => {
    expect([...MINISTRY_ROLES].sort()).toEqual(Object.values(MinistryRole).sort())
    expect(MINISTRY_ROLES[0]).toBe("STAFF")
  })

  it("has a non-empty label for every role", () => {
    for (const r of MINISTRY_ROLES) expect(MINISTRY_ROLE_LABELS[r].length).toBeGreaterThan(0)
    expect(MINISTRY_ROLE_LABELS.SUNDAY_SCHOOL_TEACHER).toBe("Sunday school teacher")
  })
})

describe("parseMinistryRoles", () => {
  it("returns [] for no values", () => {
    expect(parseMinistryRoles([])).toEqual([])
  })

  it("accepts valid values", () => {
    expect(parseMinistryRoles(["STAFF", "VOLUNTEER"])).toEqual(["STAFF", "VOLUNTEER"])
  })

  it("dedupes while keeping first-seen order", () => {
    expect(parseMinistryRoles(["VOLUNTEER", "STAFF", "VOLUNTEER"])).toEqual(["VOLUNTEER", "STAFF"])
  })

  it("returns null when any value is invalid", () => {
    expect(parseMinistryRoles(["STAFF", "PRESIDENT"])).toBeNull()
    expect(parseMinistryRoles([""])).toBeNull()
    expect(parseMinistryRoles(["staff"])).toBeNull()
  })
})

describe("parseMinistryRoleFilter", () => {
  it("returns the role for a valid value", () => {
    expect(parseMinistryRoleFilter("YOUTH_LEADER")).toBe("YOUTH_LEADER")
  })

  it("returns null for missing or invalid values", () => {
    expect(parseMinistryRoleFilter(undefined)).toBeNull()
    expect(parseMinistryRoleFilter(null)).toBeNull()
    expect(parseMinistryRoleFilter("")).toBeNull()
    expect(parseMinistryRoleFilter("nope")).toBeNull()
  })
})
