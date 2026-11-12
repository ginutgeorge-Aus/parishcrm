import { UserRole } from "@/lib/generated/prisma/enums"
import { canManageFundraiser, canViewFundraiserTotals } from "@/lib/roleGuard"

const MANAGERS: UserRole[] = [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN]

describe("fundraiser role guards", () => {
  it.each(Object.values(UserRole))("canManageFundraiser(%s)", (role) => {
    expect(canManageFundraiser(role)).toBe(MANAGERS.includes(role))
  })

  it.each(Object.values(UserRole))("canViewFundraiserTotals(%s)", (role) => {
    expect(canViewFundraiserTotals(role)).toBe(MANAGERS.includes(role) || role === UserRole.AUDITOR)
  })

  it("denies undefined role", () => {
    expect(canManageFundraiser(undefined)).toBe(false)
    expect(canViewFundraiserTotals(undefined)).toBe(false)
  })
})
