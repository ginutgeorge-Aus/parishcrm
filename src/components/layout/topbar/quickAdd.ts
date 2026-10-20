import { User, Users, CalendarDays, ArrowLeftRight } from "lucide-react"
import { canAccessAccounting, canEdit } from "@/lib/roleGuard"
import type { UserRole } from "@/lib/generated/prisma/enums"
import type { FeatureKey } from "@/lib/features"

export type QuickAddItem = { href: string; label: string; icon: React.ElementType }

/**
 * Entries for the top bar's "+ New" menu. Gates mirror the create pages'
 * own guards (canEdit for people/families/events, canAccessAccounting for
 * transactions) so the menu never offers a page that would redirect.
 * `features` omitted = all on.
 */
export function buildQuickAddItems(role: UserRole | undefined, features?: ReadonlySet<FeatureKey>): QuickAddItem[] {
  const on = (k: FeatureKey) => !features || features.has(k)
  const editor = canEdit(role)
  const items: (QuickAddItem & { show: boolean })[] = [
    { href: "/people/new", label: "Person", icon: User, show: editor },
    { href: "/families/new", label: "Family", icon: Users, show: editor },
    { href: "/events/new", label: "Event", icon: CalendarDays, show: editor && on("events") },
    { href: "/accounting/transactions/new", label: "Transaction", icon: ArrowLeftRight, show: canAccessAccounting(role) && on("accounting") },
  ]
  return items.filter((i) => i.show).map(({ show: _show, ...i }) => i)
}
