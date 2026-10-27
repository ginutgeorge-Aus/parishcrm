import {
  Users, User, UserCog, LayoutDashboard, Upload,
  BookOpen, ArrowLeftRight, Landmark, PiggyBank, BarChart2,
  CalendarDays, Wallet, ReceiptText, Settings2, BadgeCheck, Send, History,
  SlidersHorizontal, ListChecks, Cake, HandCoins, Inbox, MonitorSmartphone,
  MessagesSquare, HelpCircle, Warehouse, ClipboardCheck, UserPlus, MailPlus, Heart, School, FileText, Building2,
  Church, Calculator, Settings,
} from "lucide-react"
import type { FeatureKey } from "@/lib/features"
import { featureOn, type NavFlags } from "@/components/layout/navGates"

// `badgeInformational` marks a count that is shown on the link but is not an
// action item, so it stays out of the collapsed group header's pending total.
export type NavItem = {
  href: string; label: string; icon: React.ElementType; show: boolean; badge?: number; badgeInformational?: boolean
}
export type NavEntry = NavItem | { subLabel: string; items: NavItem[] }
// `headless` groups render their links at the top level, with no collapsible
// header — used for the always-visible primary sections.
// `icon` is shown on collapsible group headers; headless groups have none.
export type NavGroup = { label: string; items: NavEntry[]; headless?: boolean; icon?: React.ElementType }

/** Sidebar groups for the viewer's role, badge counts and enabled features. */
export function buildNavGroups(flags: NavFlags): NavGroup[] {
  const {
    isAccounting, isAccountingViewer, isAdmin, isEditor, canUsers, canViewPeople,
    pendingUpdates, verifyPending, membershipPending, features, venueUsage,
  } = flags
  const on = (k: FeatureKey) => featureOn(features, k)
  const acct = on("accounting")

  // Every link has its own icon (asserted by the navData tests) so the
  // collapsed icon rail stays scannable. Individual reports live on the
  // /accounting/reports hub rather than in the sidebar.
  return [
    {
      label: "Main",
      headless: true,
      items: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard, show: true },
        { href: "/people", label: "People", icon: User, show: canViewPeople },
        { href: "/families", label: "Families", icon: Users, show: canViewPeople },
        { href: "/events", label: "Events", icon: CalendarDays, show: canViewPeople && on("events") },
      ],
    },
    {
      label: "Community",
      icon: Church,
      items: [
        { href: "/people/birthdays", label: "Birthdays", icon: Cake, show: canViewPeople && on("celebrations") },
        { href: "/people/anniversaries", label: "Anniversaries", icon: Heart, show: canViewPeople && on("celebrations") },
        { href: "/sunday-school", label: "Sunday School", icon: School, show: canViewPeople && on("sundaySchool") },
        { href: "/people/clearances", label: "Clearances", icon: BadgeCheck, show: isEditor && on("clearances") },
        { href: "/families/updates", label: "Family Updates", icon: Inbox, show: isEditor && on("familyUpdates"), badge: pendingUpdates },
        { href: "/memberships", label: "Membership Forms", icon: UserPlus, show: isEditor && on("memberships"), badge: membershipPending },
        { href: "/welcome-letter", label: "Welcome Letter", icon: MailPlus, show: isEditor && on("welcomeLetter") },
        { href: "/venue-usage", label: "Venue bookings", icon: Warehouse, show: isEditor && !!venueUsage },
      ],
    },
    {
      label: "Accounting",
      icon: Calculator,
      items: [
        {
          subLabel: "Books",
          items: [
            { href: "/accounting", label: "Overview", icon: BookOpen, show: isAccountingViewer && acct },
            { href: "/accounting/transactions", label: "Transactions", icon: ArrowLeftRight, show: isAccountingViewer && acct },
            { href: "/accounting/reconciliation", label: "Reconciliation", icon: ListChecks, show: isAccountingViewer && on("reconciliation") },
            { href: "/accounting/import", label: "Bank import", icon: Landmark, show: isAccounting && on("bankImport") },
            { href: "/accounting/petty-cash", label: "Petty cash", icon: Wallet, show: isAccountingViewer && on("pettyCash") },
            { href: "/accounting/dues", label: "Subscription dues", icon: HandCoins, show: isAccountingViewer && on("dues") },
            { href: "/accounting/reports", label: "Reports", icon: BarChart2, show: isAccountingViewer && acct },
          ],
        },
        {
          subLabel: "Billing & Receipts",
          items: [
            { href: "/accounting/invoices", label: "Invoices", icon: FileText, show: isAccountingViewer && on("invoices") },
            { href: "/accounting/customers", label: "Customers", icon: Building2, show: isAccountingViewer && on("invoices") },
            { href: "/accounting/send-receipts", label: "Send receipts", icon: Send, show: isAccounting && on("receipts") },
            { href: "/accounting/dgr-receipts", label: "DGR receipts", icon: ReceiptText, show: isAccountingViewer && on("dgrReceipts") },
            { href: "/accounting/receipt-audit", label: "Receipt log", icon: History, show: isAccountingViewer && on("receipts") },
          ],
        },
        {
          subLabel: "Admin",
          items: [
            { href: "/accounting/budget", label: "Budget", icon: PiggyBank, show: isAdmin && on("budget") },
            { href: "/accounting/settings", label: "Accounting settings", icon: SlidersHorizontal, show: isAdmin && acct },
          ],
        },
      ],
    },
    {
      label: "Settings",
      icon: Settings,
      items: [
        { href: "/account", label: "My Account", icon: MonitorSmartphone, show: true },
        { href: "/reports", label: "My Feedback", icon: MessagesSquare, show: true },
        { href: "/help", label: "Help", icon: HelpCircle, show: true },
        { href: "/import", label: "Import CSV", icon: Upload, show: isAdmin },
        { href: "/users", label: "Users", icon: UserCog, show: canUsers },
        { href: "/settings", label: "App Settings", icon: Settings2, show: isAdmin },
        { href: "/verify", label: "Release Checks", icon: ClipboardCheck, show: isAdmin, badge: verifyPending, badgeInformational: true },
      ],
    },
  ]
}

/**
 * Sum of actionable badge counts on a group's visible links (shown on its
 * header while collapsed). Informational badges, such as unverified release
 * checks, are left out so they don't drown real action items.
 */
export function pendingTotal(items: NavEntry[]): number {
  return flattenNavItems(items)
    .filter((i) => i.show && !i.badgeInformational)
    .reduce((sum, i) => sum + (i.badge ?? 0), 0)
}

/** Flattens sub-labelled entries into one list of links. */
export function flattenNavItems(items: NavEntry[]): NavItem[] {
  return items.flatMap((entry) => ("subLabel" in entry ? entry.items : [entry]))
}

/**
 * Visible links with a pending actionable count (the top-bar bell's list).
 * Informational badges, such as unverified release checks, are left out.
 */
export function attentionItems(groups: NavGroup[]): NavItem[] {
  return groups
    .flatMap((g) => flattenNavItems(g.items))
    .filter((i) => i.show && !i.badgeInformational && (i.badge ?? 0) > 0)
}
