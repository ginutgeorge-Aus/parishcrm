import type { FeatureKey } from "@/lib/features"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { canAccessAccounting, canEdit, canManageUsers, canViewAccounting, canViewPeople, isAdmin } from "@/lib/roleGuard"

// Role/feature gates shared by the sidebar, the top-bar bell and the quick-add
// menu. Kept out of sidebar/ so the top bar doesn't import sidebar internals.

export type NavFlags = {
  isAccounting: boolean
  isAccountingViewer: boolean
  isAdmin: boolean
  isEditor: boolean
  canUsers: boolean
  canViewPeople: boolean
  pendingUpdates: number
  verifyPending: number
  membershipPending: number
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
  counts: Partial<Pick<NavFlags, "pendingUpdates" | "verifyPending" | "membershipPending">> = {},
  features?: ReadonlySet<FeatureKey>,
): NavFlags {
  return {
    isAccounting: canAccessAccounting(role),
    isAccountingViewer: canViewAccounting(role),
    isAdmin: isAdmin(role),
    isEditor: canEdit(role),
    canUsers: canManageUsers(role),
    canViewPeople: canViewPeople(role),
    pendingUpdates: counts.pendingUpdates ?? 0,
    verifyPending: counts.verifyPending ?? 0,
    membershipPending: counts.membershipPending ?? 0,
    features,
  }
}
