import type { FeatureKey } from "@/lib/features"
import type { UserRole } from "@/lib/generated/prisma/enums"
import {
  canAccessAccounting, canBrowseSundaySchool, canEdit, canManageUsers, canViewAccounting, canViewPeople, isAdmin, isHeadmaster, canManagePrayerRequests,
} from "@/lib/roleGuard"

// Role/feature gates shared by the sidebar, the top-bar bell and the quick-add
// menu. Kept out of sidebar/ so the top bar doesn't import sidebar internals.

export type NavFlags = {
  isAccounting: boolean
  isAccountingViewer: boolean
  isAdmin: boolean
  isEditor: boolean
  canUsers: boolean
  canViewPeople: boolean
  /** Prayer requests link (ADMIN | PASTOR, canManagePrayerRequests). */
  canPrayerRequests: boolean
  /** Staff Sunday School link (canBrowseSundaySchool). */
  canBrowseSundaySchool: boolean
  /** HEADMASTER: confined to Sunday School, so hide links middleware would bounce. */
  sundaySchoolOnly?: boolean
  /** Venue Usage nav link (AppSetting `venueUsage.enabled`). */
  venueUsage?: boolean
  pendingUpdates: number
  verifyPending: number
  membershipPending: number
  /** The viewer's own follow-ups due today or earlier (badge on the Follow-ups link). */
  dueFollowUps?: number
  /** Enabled features; omitted = all on. Off features drop their links. */
  features?: ReadonlySet<FeatureKey>
}

/** True when feature `k` is enabled; `features` omitted = all on. */
export function featureOn(features: ReadonlySet<FeatureKey> | undefined, k: FeatureKey): boolean {
  return !features || features.has(k)
}

/**
 * Nav flags for a role. One source for the sidebar, the top-bar bell and the
 * quick-add menu, so their role gates can't drift apart.
 */
export function navFlagsFor(
  role: UserRole | undefined,
  counts: Partial<Pick<NavFlags, "pendingUpdates" | "verifyPending" | "membershipPending" | "dueFollowUps">> = {},
  features?: ReadonlySet<FeatureKey>,
  venueUsage = false,
): NavFlags {
  return {
    isAccounting: canAccessAccounting(role),
    isAccountingViewer: canViewAccounting(role),
    isAdmin: isAdmin(role),
    isEditor: canEdit(role),
    canUsers: canManageUsers(role),
    canViewPeople: canViewPeople(role),
    canPrayerRequests: canManagePrayerRequests(role),
    canBrowseSundaySchool: canBrowseSundaySchool(role),
    sundaySchoolOnly: isHeadmaster(role),
    venueUsage,
    pendingUpdates: counts.pendingUpdates ?? 0,
    verifyPending: counts.verifyPending ?? 0,
    membershipPending: counts.membershipPending ?? 0,
    dueFollowUps: counts.dueFollowUps ?? 0,
    features,
  }
}
