import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { OpeningBalanceForm } from "@/components/accounting/OpeningBalanceForm"
import { PettyCashCustodianForm } from "@/components/accounting/PettyCashCustodianForm"
import { PeriodLockForm } from "@/components/accounting/PeriodLockForm"
import { PaymentAccountsManager } from "@/components/accounting/PaymentAccountsManager"
import { getPettyCashDefaultCustodianId } from "@/lib/actions/settings"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { getPaymentAccounts } from "@/lib/paymentAccounts"

export default async function AccountingSettingsPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const [balances, people, custodianId, lockDate, accounts] = await Promise.all([
    prisma.accountOpeningBalance.findMany(),
    prisma.person.findMany({
      where: { archivedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: PERSON_PICKER_CAP,
    }),
    getPettyCashDefaultCustodianId(),
    getAccountingLockDate(),
    getPaymentAccounts(),
  ])

  const balancesByAccountId = new Map(
    balances.map((b) => [b.paymentAccountId, { amount: b.amount.toString(), asOfDate: b.asOfDate }])
  )

  let allPeople = people
  if (custodianId && !people.some((p) => p.id === custodianId)) {
    const custodian = await prisma.person.findUnique({
      where: { id: custodianId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (custodian) allPeople = [...people, custodian]
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Accounting Settings</h1>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Opening Balances
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Set the starting balance and as-of date for each payment account.
          The dashboard will show: opening balance + all income − all expenses recorded after that date.
        </p>
        <div className="flex gap-3 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 ml-24">
          <span className="w-36">Opening Amount</span>
          <span>As-of Date</span>
        </div>
        <OpeningBalanceForm accounts={accounts} balancesByAccountId={balancesByAccountId} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Petty Cash Auto-open
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          A petty cash session for each Sunday is opened automatically (zero opening balance)
          under this custodian when someone opens the Petty Cash page. Set to &ldquo;None&rdquo; to disable.
        </p>
        <PettyCashCustodianForm people={allPeople} currentId={custodianId} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">Period Lock</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Transactions dated on or before this date become read-only — no create, edit, or delete.
          Leave blank to remove the lock. ADMIN only.
        </p>
        <PeriodLockForm currentLockDate={lockDate ? lockDate.toISOString().slice(0, 10) : null} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Payment Accounts
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Manage the bank and cash accounts used across transactions, reconciliation, and reports.
        </p>
        <PaymentAccountsManager accounts={accounts} />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Funds
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Fund / ministry tracking — split transactions, petty cash receipts, and expenses across
          funds (e.g. General, Building). Manage the fund list, active status, and sort order here.
        </p>
        <Button asChild>
          <Link href="/accounting/settings/funds">Manage Funds</Link>
        </Button>
      </div>
    </div>
  )
}
