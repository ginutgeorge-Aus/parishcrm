import { UserRole } from "@/lib/generated/prisma/enums"
import { canEditAttendance, canViewAttendance } from "../roleGuard"

const EDITORS = [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN]
const VIEW_ONLY = [UserRole.VIEWER]
const BLOCKED = [UserRole.AUDITOR, UserRole.EVENT_ORGANISER]

describe("canEditAttendance", () => {
  it.each(EDITORS)("allows %s", (role) => {
    expect(canEditAttendance(role)).toBe(true)
  })
  it.each([...VIEW_ONLY, ...BLOCKED])("denies %s", (role) => {
    expect(canEditAttendance(role)).toBe(false)
  })
  it("denies a role-less session", () => {
    expect(canEditAttendance(undefined)).toBe(false)
  })
})

describe("canViewAttendance", () => {
  it.each([...EDITORS, ...VIEW_ONLY])("allows %s", (role) => {
    expect(canViewAttendance(role)).toBe(true)
  })
  it.each(BLOCKED)("denies %s", (role) => {
    expect(canViewAttendance(role)).toBe(false)
  })
  it("denies a role-less session", () => {
    expect(canViewAttendance(undefined)).toBe(false)
  })
})
