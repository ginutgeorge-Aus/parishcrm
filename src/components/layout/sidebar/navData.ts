import {
  Users, User, UserCog, LayoutDashboard, Upload,
  BookOpen, ArrowLeftRight, Landmark, PiggyBank, BarChart2, Activity,
  CalendarDays, Wallet, ReceiptText, Settings2, ShieldCheck, BadgeCheck, Send, History,
  SlidersHorizontal, ListChecks, Cake, HandCoins, Inbox, MonitorSmartphone,
  MessagesSquare, HelpCircle, ClipboardCheck, UserPlus, MailPlus, Heart, School, FileText, Building2,
} from "lucide-react"

export type NavItem = { href: string; label: string; icon: React.ElementType; show: boolean; badge?: number }
export type NavEntry = NavItem | { subLabel: string; items: NavItem[] }
// `headless` groups render their links at the top level, with no collapsible
// header — used for the always-visible primary sections.
export type NavGroup = { label: string; items: NavEntry[]; headless?: boolean }

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
}

export function buildNavGroups(flags: NavFlags): NavGroup[] {
  const {
    isAccounting, isAccountingViewer, isAdmin, isEditor, canUsers, canViewPeople,
    pendingUpdates, verifyPending, membershipPending,
  } = flags

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
        { href: "/events", label: "Events", icon: CalendarDays, show: canViewPeople },
      ],
    },
    {
      label: "Community",
      items: [
        { href: "/people/birthdays", label: "Birthdays", icon: Cake, show: canViewPeople },
        { href: "/people/anniversaries", label: "Anniversaries", icon: Heart, show: canViewPeople },
        { href: "/sunday-school", label: "Sunday School", icon: School, show: canViewPeople },
        { href: "/people/clearances", label: "Clearances", icon: BadgeCheck, show: isEditor },
        { href: "/families/updates", label: "Family Updates", icon: Inbox, show: isEditor, badge: pendingUpdates },
        { href: "/memberships", label: "Membership Forms", icon: UserPlus, show: isEditor, badge: membershipPending },
        { href: "/welcome-letter", label: "Welcome Letter", icon: MailPlus, show: isEditor },
      ],
    },
    {
      label: "Accounting",
      items: [
        {
          subLabel: "Books",
          items: [
            { href: "/accounting", label: "Overview", icon: BookOpen, show: isAccountingViewer },
            { href: "/accounting/transactions", label: "Transactions", icon: ArrowLeftRight, show: isAccountingViewer },
            { href: "/accounting/reconciliation", label: "Reconciliation", icon: ListChecks, show: isAccountingViewer },
            { href: "/accounting/import", label: "Bank Import", icon: Landmark, show: isAccounting },
            { href: "/accounting/petty-cash", label: "Petty Cash", icon: Wallet, show: isAccountingViewer },
            { href: "/accounting/dues", label: "Subscription Dues", icon: HandCoins, show: isAccountingViewer },
            { href: "/accounting/reports", label: "Reports", icon: BarChart2, show: isAccountingViewer },
          ],
        },
        {
          subLabel: "Billing & Receipts",
          items: [
            { href: "/accounting/invoices", label: "Invoices", icon: FileText, show: isAccountingViewer },
            { href: "/accounting/customers", label: "Customers", icon: Building2, show: isAccountingViewer },
            { href: "/accounting/send-receipts", label: "Send Receipts", icon: Send, show: isAccounting },
            { href: "/accounting/dgr-receipts", label: "DGR Receipts", icon: ReceiptText, show: isAccountingViewer },
            { href: "/accounting/receipt-audit", label: "Receipt Log", icon: History, show: isAccountingViewer },
          ],
        },
        {
          subLabel: "Admin",
          items: [
            { href: "/accounting/budget", label: "Budget", icon: PiggyBank, show: isAdmin },
            { href: "/accounting/settings", label: "Accounting Settings", icon: SlidersHorizontal, show: isAdmin },
          ],
        },
      ],
    },
    {
      label: "Settings",
      items: [
        { href: "/account", label: "My Account", icon: MonitorSmartphone, show: true },
        { href: "/reports", label: "My Feedback", icon: MessagesSquare, show: true },
        { href: "/help", label: "Help", icon: HelpCircle, show: true },
        { href: "/import", label: "Import CSV", icon: Upload, show: isAdmin },
        { href: "/users", label: "Users", icon: UserCog, show: canUsers },
        { href: "/settings", label: "App Settings", icon: Settings2, show: isAdmin },
        { href: "/settings/audit-log", label: "Audit Log", icon: ShieldCheck, show: isAdmin },
        { href: "/settings/usage", label: "App Usage", icon: Activity, show: isAdmin },
        { href: "/verify", label: "Release Checks", icon: ClipboardCheck, show: isAdmin, badge: verifyPending },
      ],
    },
  ]
}

/** Sum of badge counts on a group's visible links (shown on its header while collapsed). */
export function pendingTotal(items: NavEntry[]): number {
  return flattenNavItems(items)
    .filter((i) => i.show)
    .reduce((sum, i) => sum + (i.badge ?? 0), 0)
}

export function flattenNavItems(items: NavEntry[]): NavItem[] {
  return items.flatMap((entry) => ("subLabel" in entry ? entry.items : [entry]))
}
