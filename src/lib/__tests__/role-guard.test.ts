import { UserRole } from "@/lib/generated/prisma/enums"
import {
  canEdit, canViewPeople, canViewAccounting,
  canManageUsers, canAccessAccounting, canSeePastoralNotes, isAdmin,
} from "@/lib/roleGuard"

const O = UserRole.OFFICE_ADMIN

describe("OFFICE_ADMIN permissions", () => {
  it("can edit content (people/families/events)", () => {
    expect(canEdit(O)).toBe(true)
  })
  it("can view people", () => {
    expect(canViewPeople(O)).toBe(true)
  })
  it("can view accounting", () => {
    expect(canViewAccounting(O)).toBe(true)
  })
  it("can manage users", () => {
    expect(canManageUsers(O)).toBe(true)
  })
  it("cannot mutate accounting", () => {
    expect(canAccessAccounting(O)).toBe(false)
  })
  it("cannot see pastoral notes", () => {
    expect(canSeePastoralNotes(O)).toBe(false)
  })
  it("is not admin", () => {
    expect(isAdmin(O)).toBe(false)
  })
})

describe("canManageUsers", () => {
  it("ADMIN yes", () => expect(canManageUsers(UserRole.ADMIN)).toBe(true))
  it("OFFICE_ADMIN yes", () => expect(canManageUsers(O)).toBe(true))
  it("PASTOR no", () => expect(canManageUsers(UserRole.PASTOR)).toBe(false))
  it("VIEWER no", () => expect(canManageUsers(UserRole.VIEWER)).toBe(false))
  it("AUDITOR no", () => expect(canManageUsers(UserRole.AUDITOR)).toBe(false))
  it("undefined no", () => expect(canManageUsers(undefined)).toBe(false))
})
