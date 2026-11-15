import { UserRole } from "@/lib/generated/prisma/enums"
import { canEditSacraments, canViewSacraments } from "../roleGuard"

// PO decision #605: ADMIN + PASTOR edit; OFFICE_ADMIN view/print only; others none.
const EDITORS: UserRole[] = [UserRole.ADMIN, UserRole.PASTOR]
const VIEW_ONLY: UserRole[] = [UserRole.OFFICE_ADMIN]
const BLOCKED = Object.values(UserRole).filter((r) => !EDITORS.includes(r) && !VIEW_ONLY.includes(r))

describe("canEditSacraments", () => {
  it.each(EDITORS)("allows %s", (role) => {
    expect(canEditSacraments(role)).toBe(true)
  })
  it.each([...VIEW_ONLY, ...BLOCKED])("denies %s", (role) => {
    expect(canEditSacraments(role)).toBe(false)
  })
  it("denies a role-less session", () => {
    expect(canEditSacraments(undefined)).toBe(false)
  })
})

describe("canViewSacraments", () => {
  it.each([...EDITORS, ...VIEW_ONLY])("allows %s", (role) => {
    expect(canViewSacraments(role)).toBe(true)
  })
  it.each(BLOCKED)("denies %s", (role) => {
    expect(canViewSacraments(role)).toBe(false)
  })
  it("denies a role-less session", () => {
    expect(canViewSacraments(undefined)).toBe(false)
  })
})
