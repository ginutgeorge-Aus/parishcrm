import { UserRole } from "@/lib/generated/prisma/enums"
import {
  canBrowseSundaySchool,
  canEdit,
  canManageSundaySchool,
  canViewAccounting,
  canViewPeople,
  canViewSundaySchool,
  isHeadmaster,
  isTeacher,
} from "../roleGuard"

const MANAGERS = [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN, UserRole.HEADMASTER]
const VIEW_ONLY = [UserRole.VIEWER, UserRole.TEACHER]
const BLOCKED = [UserRole.AUDITOR, UserRole.EVENT_ORGANISER]

describe("isHeadmaster / isTeacher", () => {
  it("match only their own role", () => {
    for (const role of Object.values(UserRole)) {
      expect(isHeadmaster(role)).toBe(role === UserRole.HEADMASTER)
      expect(isTeacher(role)).toBe(role === UserRole.TEACHER)
    }
    expect(isHeadmaster(undefined)).toBe(false)
    expect(isTeacher(undefined)).toBe(false)
  })
})

describe("canManageSundaySchool", () => {
  it.each(MANAGERS)("allows %s", (role) => expect(canManageSundaySchool(role)).toBe(true))
  it.each([...VIEW_ONLY, ...BLOCKED])("denies %s", (role) => expect(canManageSundaySchool(role)).toBe(false))
  it("denies a role-less session", () => expect(canManageSundaySchool(undefined)).toBe(false))
})

describe("canViewSundaySchool", () => {
  it.each([...MANAGERS, ...VIEW_ONLY])("allows %s", (role) => expect(canViewSundaySchool(role)).toBe(true))
  it.each(BLOCKED)("denies %s", (role) => expect(canViewSundaySchool(role)).toBe(false))
  it("denies a role-less session", () => expect(canViewSundaySchool(undefined)).toBe(false))
})

describe("canBrowseSundaySchool", () => {
  it.each([...MANAGERS, UserRole.VIEWER])("allows %s", (role) => expect(canBrowseSundaySchool(role)).toBe(true))
  it.each([UserRole.TEACHER, ...BLOCKED])("denies %s", (role) => expect(canBrowseSundaySchool(role)).toBe(false))
  it("denies a role-less session", () => expect(canBrowseSundaySchool(undefined)).toBe(false))
})

// Headmasters and teachers run Sunday school only: no people/PII, no accounting,
// and no general edit rights.
describe.each([UserRole.HEADMASTER, UserRole.TEACHER])("%s outside Sunday school", (role) => {
  it("has no people, accounting or edit access", () => {
    expect(canViewPeople(role)).toBe(false)
    expect(canViewAccounting(role)).toBe(false)
    expect(canEdit(role)).toBe(false)
  })
})
