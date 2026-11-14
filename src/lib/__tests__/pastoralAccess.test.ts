import { UserRole } from "@/lib/generated/prisma/enums"
import { followUpVisibilityWhere, liveFollowUpTarget } from "@/lib/pastoralAccess"
import {
  canBeFollowUpAssignee,
  canManageFollowUps,
  canManagePrayerRequests,
  canViewSharedPrayerRequests,
} from "@/lib/roleGuard"

const ALL = Object.values(UserRole)

describe("pastoral role helpers", () => {
  it("manage follow-ups = ADMIN | PASTOR", () => {
    expect(ALL.filter(canManageFollowUps).sort()).toEqual([UserRole.ADMIN, UserRole.PASTOR].sort())
    expect(canManageFollowUps(undefined)).toBe(false)
  })

  it("assignable = editors (VIEWER is read-only)", () => {
    expect(ALL.filter(canBeFollowUpAssignee).sort()).toEqual(
      [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN].sort(),
    )
  })

  it("manage prayer requests = ADMIN | PASTOR", () => {
    expect(ALL.filter(canManagePrayerRequests).sort()).toEqual([UserRole.ADMIN, UserRole.PASTOR].sort())
  })

  it("shared bulletin list = editors", () => {
    expect(ALL.filter(canViewSharedPrayerRequests).sort()).toEqual(
      [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN].sort(),
    )
  })
})

describe("followUpVisibilityWhere", () => {
  it.each([UserRole.ADMIN, UserRole.PASTOR])("%s sees every task", (role) => {
    expect(followUpVisibilityWhere({ id: 5, role })).toEqual({})
  })

  it.each([UserRole.OFFICE_ADMIN])("%s sees only their own", (role) => {
    expect(followUpVisibilityWhere({ id: 5, role })).toEqual({ assigneeId: 5 })
  })

  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.HEADMASTER, UserRole.TEACHER, undefined])(
    "%s sees nothing",
    (role) => {
      expect(followUpVisibilityWhere({ id: 5, role })).toBeNull()
    },
  )
})

it("liveFollowUpTarget hides archived people and families", () => {
  expect(liveFollowUpTarget()).toEqual({
    OR: [{ person: { is: { archivedAt: null } } }, { family: { is: { archivedAt: null } } }],
  })
})
