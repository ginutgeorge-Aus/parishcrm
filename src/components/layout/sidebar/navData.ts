import {
  Users, User, UserCog, Home, Upload,
  BookOpen, ArrowLeftRight, Landmark, PiggyBank, TrendingUp, BarChart2, BarChart3,
  CalendarDays, Wallet, ReceiptText, Settings2, ShieldCheck,
  SlidersHorizontal, ListChecks, Scale, Cake, HandCoins, Gift, Inbox, MonitorSmartphone,
  MessagesSquare, HelpCircle, ClipboardCheck, UserPlus, MailPlus, Heart,
} from "lucide-react"

export type NavItem = { href: string; label: string; icon: React.ElementType; show: boolean; badge?: number }
export type NavEntry = NavItem | { subLabel: string; items: NavItem[] }
export type NavGroup = { label: string; basePath: string; items: NavEntry[] }

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

  return [
    {
      label: "Members",
      basePath: "",
      items: [
        { href: "/", label: "Dashboard", icon: Home, show: true },
        { href: "/families", label: "Families", icon: Users, show: canViewPeople },
        { href: "/people", label: "People", icon: User, show: canViewPeople },
        { href: "/people/birthdays", label: "Birthdays", icon: Cake, show: canViewPeople },
        { href: "/people/anniversaries", label: "Anniversaries", icon: Heart, show: canViewPeople },
        { href: "/families/updates", label: "Family Updates", icon: Inbox, show: isEditor, badge: pendingUpdates },
        { href: "/memberships", label: "Membership Forms", icon: UserPlus, show: isEditor, badge: membershipPending },
        { href: "/welcome-letter", label: "Welcome Letter", icon: MailPlus, show: isEditor },
      ],
    },
    {
      label: "Events",
      basePath: "/events",
      items: [
        { href: "/events", label: "Events", icon: CalendarDays, show: canViewPeople },
      ],
    },
    {
      label: "Accounting",
      basePath: "/accounting",
      items: [
        {
          subLabel: "Transactions",
          items: [
            { href: "/accounting", label: "Overview", icon: BookOpen, show: isAccountingViewer },
            { href: "/accounting/transactions", label: "Transactions", icon: ArrowLeftRight, show: isAccountingViewer },
            { href: "/accounting/reconciliation", label: "Reconciliation", icon: ListChecks, show: isAccountingViewer },
            { href: "/accounting/import", label: "Bank Import", icon: Landmark, show: isAccounting },
            { href: "/accounting/petty-cash", label: "Petty Cash", icon: Wallet, show: isAccountingViewer },
            { href: "/accounting/dues", label: "Subscription Dues", icon: HandCoins, show: isAccountingViewer },
          ],
        },
        {
          subLabel: "Reports",
          items: [
            { href: "/accounting/reports/pl", label: "P&L Report", icon: TrendingUp, show: isAccountingViewer },
            { href: "/accounting/reports/budget-vs-actual", label: "Budget vs Actual", icon: BarChart2, show: isAccountingViewer },
            { href: "/accounting/reports/balance-sheet", label: "Balance Sheet", icon: Scale, show: isAccountingViewer },
            { href: "/accounting/reports/trial-balance", label: "Trial Balance", icon: Scale, show: isAccountingViewer },
            { href: "/accounting/reports/cash-flow", label: "Cash Flow", icon: ArrowLeftRight, show: isAccountingViewer },
            { href: "/accounting/reports/general-ledger", label: "General Ledger", icon: BookOpen, show: isAccountingViewer },
            { href: "/accounting/reports/reconciliation", label: "Reconciliation Report", icon: Scale, show: isAccountingViewer },
            { href: "/accounting/reports/giving-summary", label: "Giving Summary", icon: Gift, show: isAccountingViewer },
          ],
        },
        {
          subLabel: "Admin",
          items: [
            { href: "/accounting/send-receipts", label: "Send Receipts", icon: ReceiptText, show: isAccounting },
            { href: "/accounting/receipt-audit", label: "Receipt Audit Log", icon: ReceiptText, show: isAccountingViewer },
            { href: "/accounting/dgr-receipts", label: "DGR Receipts", icon: ReceiptText, show: isAccountingViewer },
            { href: "/accounting/budget", label: "Budget", icon: PiggyBank, show: isAdmin },
            { href: "/accounting/settings", label: "Acct. Settings", icon: SlidersHorizontal, show: isAdmin },
          ],
        },
      ],
    },
    {
      label: "Settings",
      basePath: "",
      items: [
        { href: "/account", label: "My Account", icon: MonitorSmartphone, show: true },
        { href: "/reports", label: "My Reports", icon: MessagesSquare, show: true },
        { href: "/help", label: "Help", icon: HelpCircle, show: true },
        { href: "/import", label: "Import CSV", icon: Upload, show: isAdmin },
        { href: "/users", label: "Users", icon: UserCog, show: canUsers },
        { href: "/settings", label: "App Settings", icon: Settings2, show: isAdmin },
        { href: "/settings/audit-log", label: "Audit Log", icon: ShieldCheck, show: isAdmin },
        { href: "/settings/usage", label: "Usage", icon: BarChart3, show: isAdmin },
        { href: "/verify", label: "Verify", icon: ClipboardCheck, show: isAdmin, badge: verifyPending },
      ],
    },
  ]
}

export function flattenNavItems(items: NavEntry[]): NavItem[] {
  return items.flatMap((entry) => ("subLabel" in entry ? entry.items : [entry]))
}
