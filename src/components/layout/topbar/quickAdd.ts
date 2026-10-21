import { User, Users, CalendarDays, ArrowLeftRight } from "lucide-react"
import { featureOn, navFlagsFor } from "@/components/layout/sidebar/navData"
import type { UserRole } from "@/lib/generated/prisma/enums"
import type { FeatureKey } from "@/lib/features"

export type QuickAddItem = { href: string; label: string; icon: React.ElementType }

/**
 * Entries for the top bar's "+ New" menu. Gates mirror the create pages'
 * own guards (editor for people/families/events, accounting for
 * transactions) so the menu never offers a page that would redirect. Role
 * flags and the feature check come from navData, shared with the sidebar.
 * `features` omitted = all on.
 */
export function buildQuickAddItems(role: UserRole | undefined, features?: ReadonlySet<FeatureKey>): QuickAddItem[] {
  const on = (k: FeatureKey) => featureOn(features, k)
  const { isEditor, isAccounting } = navFlagsFor(role)
  const items: (QuickAddItem & { show: boolean })[] = [
    { href: "/people/new", label: "Person", icon: User, show: isEditor },
    { href: "/families/new", label: "Family", icon: Users, show: isEditor },
    { href: "/events/new", label: "Event", icon: CalendarDays, show: isEditor && on("events") },
    { href: "/accounting/transactions/new", label: "Transaction", icon: ArrowLeftRight, show: isAccounting && on("accounting") },
  ]
  return items.filter((i) => i.show).map(({ show: _show, ...i }) => i)
}
