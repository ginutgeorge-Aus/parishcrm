import { redirect } from "next/navigation"
import Link from "next/link"
import {
  TrendingUp, BarChart2, Scale, Calculator, ArrowLeftRight, BookOpen, ListChecks, Gift, Layers, HandCoins,
} from "lucide-react"
import { auth } from "@/auth"
import { canViewAccounting } from "@/lib/roleGuard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata = { title: "Reports" }

const REPORTS = [
  { href: "/accounting/reports/pl", title: "Profit & Loss", description: "Income and expenses by category for a financial year.", icon: TrendingUp },
  { href: "/accounting/reports/budget-vs-actual", title: "Budget vs Actual", description: "Budgeted amounts against actual income and expenses for a financial year.", icon: BarChart2 },
  { href: "/accounting/reports/balance-sheet", title: "Balance Sheet", description: "Balances of each account as at a chosen date.", icon: Scale },
  { href: "/accounting/reports/trial-balance", title: "Trial Balance", description: "Totals per account for a financial year, to check the books balance.", icon: Calculator },
  { href: "/accounting/reports/cash-flow", title: "Cash Flow", description: "Operating cash in and out for a financial year.", icon: ArrowLeftRight },
  { href: "/accounting/reports/general-ledger", title: "General Ledger", description: "Every transaction for one account across a financial year.", icon: BookOpen },
  { href: "/accounting/reports/reconciliation", title: "Reconciliation Report", description: "A statement closing balance against the recorded transactions.", icon: ListChecks },
  { href: "/accounting/reports/giving-summary", title: "Giving Summary", description: "Giving totals for a financial year.", icon: Gift },
  { href: "/accounting/dues", title: "Dues", description: "Subscription dues paid and owing per family for a financial year.", icon: HandCoins },
  { href: "/accounting/reports/funds", title: "Fund Report", description: "Income, expenses and net movement per fund.", icon: Layers },
] as const

/** One linked report card on the hub. */
const ReportCard = ({ href, title, description, icon: Icon }: (typeof REPORTS)[number]) => (
  <Link href={href} className="block h-full rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
    <Card className="h-full transition-colors hover:bg-muted/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  </Link>
)

/** Hub page listing every accounting report — replaces the per-report sidebar links. */
// skipcq -- module scope, not global; Next.js pages export a default function.
export default async function ReportsHubPage() {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold text-foreground">Reports</h1>
      <p className="mb-6 text-sm text-muted-foreground">Financial reports for the church&apos;s books.</p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <li key={report.href}>
            <ReportCard {...report} />
          </li>
        ))}
      </ul>
    </div>
  )
}
