/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"
import {
  dueByTodayWhere,
  followUpViewerFromSession,
  followUpVisibilityWhere,
  liveFollowUpTarget,
} from "@/lib/pastoralAccess"
import {
  canBeFollowUpAssignee,
  canManageFollowUps,
  canManagePrayerRequests,
  canViewSharedPrayerRequests,
} from "@/lib/roleGuard"

const ALL = Object.values(UserRole)

describe("dueByTodayWhere", () => {
  it("matches tasks dated on or before the given day", () => {
    const today = new Date("2026-11-18T00:00:00.000Z")
    expect(dueByTodayWhere(today)).toEqual({ dueDate: { lte: today } })
  })
})

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

describe("followUpViewerFromSession", () => {
  const s = (role: UserRole, id = "4") => ({ user: { id, role } }) as never

  it("null when signed out or the role may see no tasks", () => {
    expect(followUpViewerFromSession(null)).toBeNull()
    expect(followUpViewerFromSession(s(UserRole.VIEWER))).toBeNull()
  })

  it("managers get every task; an assignee is scoped to their own", () => {
    expect(followUpViewerFromSession(s(UserRole.PASTOR))).toEqual({ viewer: { id: 4, role: UserRole.PASTOR }, scope: {} })
    expect(followUpViewerFromSession(s(UserRole.OFFICE_ADMIN))).toEqual({
      viewer: { id: 4, role: UserRole.OFFICE_ADMIN },
      scope: { assigneeId: 4 },
    })
  })
})
