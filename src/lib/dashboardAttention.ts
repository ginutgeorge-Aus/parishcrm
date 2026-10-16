import type { UserRole } from "@/lib/generated/prisma/enums"
import { canEdit, canViewAccounting, canViewPeople } from "@/lib/roleGuard"

/** Raw pending-work counts the dashboard loads; a role only sees the ones it may act on. */
export type AttentionCounts = {
  pendingFamilyUpdates: number
  pendingMemberships: number
  unreconciledTransactions: number
  openPettyCash: number
  upcomingBirthdays: number
}

/** One row of the dashboard "Needs attention" list. */
export type AttentionItem = {
  key: "familyUpdates" | "memberships" | "unreconciled" | "pettyCash" | "birthdays"
  label: string
  count: number
  href: string
}

type Candidate = AttentionItem & { allowed: boolean }

/**
 * Build the role-aware "Needs attention" list for the dashboard: only items
 * the role can see and act on, zero counts dropped, in priority order (review
 * queues first, then accounting housekeeping, then celebrations). An empty
 * result means the viewer is all caught up.
 *
 * Gating mirrors each destination page's own guard, so a row never links to a
 * page that would bounce the viewer back here: family updates and membership
 * applications → `canEdit`; reconciliation and petty cash → `canViewAccounting`;
 * birthdays (member PII) → `canViewPeople`.
 *
 * @param role - The viewer's role (undefined → nothing).
 * @param counts - Pending-work counts already loaded by the dashboard.
 * @param opts.unreconciledHref - Override for the unreconciled row's link (e.g.
 *   pre-selecting the one account that has pending transactions).
 */
export function buildAttentionItems(
  role: UserRole | undefined,
  counts: AttentionCounts,
  opts: { unreconciledHref?: string } = {},
): AttentionItem[] {
  /** Pick the singular or plural label for a count. */
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

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
      allowed: canViewAccounting(role),
      count: counts.unreconciledTransactions,
      label: plural(counts.unreconciledTransactions, "Unreconciled transaction", "Unreconciled transactions"),
      href: opts.unreconciledHref ?? "/accounting/reconciliation?status=pending",
    },
    {
      key: "pettyCash",
      allowed: canViewAccounting(role),
      count: counts.openPettyCash,
      label: plural(counts.openPettyCash, "Open petty cash session", "Open petty cash sessions"),
      href: "/accounting/petty-cash",
    },
    {
      key: "birthdays",
      allowed: canViewPeople(role),
      count: counts.upcomingBirthdays,
      label: plural(counts.upcomingBirthdays, "Birthday in the next 7 days", "Birthdays in the next 7 days"),
      href: "/people/birthdays",
    },
  ]

  return candidates
    .filter((c) => c.allowed && c.count > 0)
    .map(({ allowed: _allowed, ...item }) => item)
}
