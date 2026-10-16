import type { UserRole } from "@/lib/generated/prisma/enums"
import { canAccessAccounting, canEdit, canViewPeople } from "@/lib/roleGuard"

/**
 * Unreconciled transactions for one payment account, as returned by the
 * dashboard's `transaction.groupBy({ by: ["paymentAccountId"], _count, _min: { date } })`.
 */
export type UnreconciledAccountRow = {
  paymentAccountId: number
  count: number
  /** Date of the account's oldest unreconciled transaction (UTC-midnight date). */
  earliest: Date
}

/** Raw pending-work data the dashboard loads; a role only sees the items it may act on. */
export type AttentionCounts = {
  pendingFamilyUpdates: number
  pendingMemberships: number
  unreconciled: UnreconciledAccountRow[]
  openPettyCash: number
  upcomingBirthdays: number
  /** The birthday source fetch hit its cap, so the count is a lower bound. */
  birthdaysTruncated?: boolean
}

/** One row of the dashboard "Needs attention" list. */
export type AttentionItem = {
  key: "familyUpdates" | "memberships" | "unreconciled" | "pettyCash" | "birthdays"
  label: string
  count: number
  /** True when `count` is a lower bound (rendered as "N+"). */
  atLeast?: boolean
  href: string
}

type Candidate = AttentionItem & { allowed: boolean }

/**
 * Link for the "Unreconciled transactions" row: the Reconciliation page's
 * pending view for the account with the most unreconciled rows, starting at
 * that account's oldest one. The page's `to` defaults to today, matching the
 * count's upper bound, so every counted row for that account is listed there.
 * Ties go to the lowest account id so the link is stable.
 *
 * @param rows - Per-account unreconciled counts (non-empty for a useful link).
 */
export function unreconciledHref(rows: UnreconciledAccountRow[]): string {
  const top = [...rows].sort((a, b) => b.count - a.count || a.paymentAccountId - b.paymentAccountId)[0]
  if (!top) return "/accounting/reconciliation?status=pending"
  const from = top.earliest.toISOString().slice(0, 10)
  return `/accounting/reconciliation?paymentAccount=${top.paymentAccountId}&from=${from}&status=pending`
}

/**
 * Build the role-aware "Needs attention" list for the dashboard: only items
 * the role can see and act on, zero counts dropped, in priority order (review
 * queues first, then accounting housekeeping, then celebrations). An empty
 * result means the viewer is all caught up.
 *
 * Gating: family updates and membership applications → `canEdit` (the inbox
 * pages' own guard); unreconciled transactions and open petty cash →
 * `canAccessAccounting` (ADMIN/PASTOR, the roles that can reconcile or close a
 * session — view-only accounting roles get nothing to act on); birthdays
 * (member PII) → `canViewPeople`.
 *
 * @param role - The viewer's role (undefined → nothing).
 * @param counts - Pending-work data already loaded by the dashboard.
 */
export function buildAttentionItems(role: UserRole | undefined, counts: AttentionCounts): AttentionItem[] {
  /** Pick the singular or plural label for a count. */
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
  const unreconciledCount = counts.unreconciled.reduce((n, r) => n + r.count, 0)

  const candidates: Candidate[] = [
    {
      key: "familyUpdates",
      allowed: canEdit(role),
      count: counts.pendingFamilyUpdates,
      label: plural(counts.pendingFamilyUpdates, "Family update to review", "Family updates to review"),
      href: "/families/updates",
    },
    {
      key: "memberships",
      allowed: canEdit(role),
      count: counts.pendingMemberships,
      label: plural(counts.pendingMemberships, "Membership application to review", "Membership applications to review"),
      href: "/memberships?status=PENDING",
    },
    {
      key: "unreconciled",
      allowed: canAccessAccounting(role),
      count: unreconciledCount,
      label: plural(unreconciledCount, "Unreconciled transaction", "Unreconciled transactions"),
      href: unreconciledHref(counts.unreconciled),
    },
    {
      key: "pettyCash",
      allowed: canAccessAccounting(role),
      count: counts.openPettyCash,
      label: plural(counts.openPettyCash, "Open petty cash session", "Open petty cash sessions"),
      href: "/accounting/petty-cash",
    },
    {
      key: "birthdays",
      allowed: canViewPeople(role),
      count: counts.upcomingBirthdays,
      atLeast: counts.birthdaysTruncated || undefined,
      label: plural(counts.upcomingBirthdays, "Birthday in the next 7 days", "Birthdays in the next 7 days"),
      href: "/people/birthdays",
    },
  ]

  return candidates
    .filter((c) => c.allowed && c.count > 0)
    .map(({ allowed: _allowed, ...item }) => item)
}
