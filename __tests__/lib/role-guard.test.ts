import { canEdit, canSeePastoralNotes, isAdmin, canAccessAccounting, canViewAccounting, canViewPeople, canManageUsers } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"

describe("role-guard", () => {
  describe("canEdit", () => {
    it("ADMIN can edit", () => expect(canEdit(UserRole.ADMIN)).toBe(true))
    it("PASTOR can edit", () => expect(canEdit(UserRole.PASTOR)).toBe(true))
    it("VIEWER cannot edit", () => expect(canEdit(UserRole.VIEWER)).toBe(false))
    it("undefined cannot edit", () => expect(canEdit(undefined)).toBe(false))
  })

  describe("canSeePastoralNotes", () => {
    it("ADMIN can see pastoral notes", () => expect(canSeePastoralNotes(UserRole.ADMIN)).toBe(true))
    it("PASTOR can see pastoral notes", () => expect(canSeePastoralNotes(UserRole.PASTOR)).toBe(true))
    it("VIEWER cannot see pastoral notes", () => expect(canSeePastoralNotes(UserRole.VIEWER)).toBe(false))
    it("undefined cannot see pastoral notes", () => expect(canSeePastoralNotes(undefined)).toBe(false))
  })

  describe("isAdmin", () => {
    it("ADMIN is admin", () => expect(isAdmin(UserRole.ADMIN)).toBe(true))
    it("PASTOR is not admin", () => expect(isAdmin(UserRole.PASTOR)).toBe(false))
    it("VIEWER is not admin", () => expect(isAdmin(UserRole.VIEWER)).toBe(false))
    it("undefined is not admin", () => expect(isAdmin(undefined)).toBe(false))
  })

  describe("canAccessAccounting", () => {
    it("ADMIN can access accounting", () => expect(canAccessAccounting(UserRole.ADMIN)).toBe(true))
    it("PASTOR can access accounting", () => expect(canAccessAccounting(UserRole.PASTOR)).toBe(true))
    it("VIEWER cannot access accounting", () => expect(canAccessAccounting(UserRole.VIEWER)).toBe(false))
    it("AUDITOR cannot access accounting", () => expect(canAccessAccounting(UserRole.AUDITOR)).toBe(false))
    it("undefined cannot access accounting", () => expect(canAccessAccounting(undefined)).toBe(false))
  })

  describe("canViewAccounting", () => {
    it("ADMIN can view accounting", () => expect(canViewAccounting(UserRole.ADMIN)).toBe(true))
    it("PASTOR can view accounting", () => expect(canViewAccounting(UserRole.PASTOR)).toBe(true))
    it("AUDITOR can view accounting", () => expect(canViewAccounting(UserRole.AUDITOR)).toBe(true))
    it("VIEWER cannot view accounting", () => expect(canViewAccounting(UserRole.VIEWER)).toBe(false))
    it("undefined cannot view accounting", () => expect(canViewAccounting(undefined)).toBe(false))
  })

  describe("canManageUsers", () => {
    it("ADMIN can manage users", () => expect(canManageUsers(UserRole.ADMIN)).toBe(true))
    it("OFFICE_ADMIN can manage users", () => expect(canManageUsers(UserRole.OFFICE_ADMIN)).toBe(true))
    it("PASTOR cannot manage users", () => expect(canManageUsers(UserRole.PASTOR)).toBe(false))
    it("VIEWER cannot manage users", () => expect(canManageUsers(UserRole.VIEWER)).toBe(false))
    it("AUDITOR cannot manage users", () => expect(canManageUsers(UserRole.AUDITOR)).toBe(false))
    it("undefined cannot manage users", () => expect(canManageUsers(undefined)).toBe(false))
  })

  describe("canViewPeople", () => {
    it("ADMIN can view people", () => expect(canViewPeople(UserRole.ADMIN)).toBe(true))
    it("PASTOR can view people", () => expect(canViewPeople(UserRole.PASTOR)).toBe(true))
    it("VIEWER can view people", () => expect(canViewPeople(UserRole.VIEWER)).toBe(true))
    it("AUDITOR cannot view people (accounting-only)", () => expect(canViewPeople(UserRole.AUDITOR)).toBe(false))
    it("undefined cannot view people", () => expect(canViewPeople(undefined)).toBe(false))
  })
})
