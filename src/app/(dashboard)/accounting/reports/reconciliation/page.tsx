import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { ReconReportControls } from "@/components/accounting/ReconReportControls"
import { toFloat } from "@/lib/utils"
import { fmtAUD as fmt, parseISODate as parseDate, MONTH_ABBR_TITLE, sumCents, centsToNumber, toCents } from "@/lib/formatting"
import { sydneyToday } from "@/lib/dates"
import { currentFYYear } from "@/lib/fiscalYear"
import { getChurchSettings } from "@/lib/churchSettings"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { fetchIf } from "@/lib/asyncOr"
import { pickDefaultAccount } from "@/lib/reports/pickDefaultAccount"
import { computeReconciliationEquation, centsToNumberOrNull } from "@/lib/reports/reconciliationEquation"

// statementDate is UTC-midnight anchored (sydneyToday / parseISODate both build
// via Date.UTC), so read it with UTC getters — local getters shift the calendar
// day by the server's offset, matching the Sydney-tz render fixes.
function toYMD(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function fmtDate(d: Date) {
  return `${d.getUTCDate()} ${MONTH_ABBR_TITLE[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export default async function ReconciliationReportPage(props: {
  searchParams: Promise<{ paymentAccount?: string; statementDate?: string }>
}) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const searchParams = await props.searchParams

  // Reports show all accounts (incl. deactivated-with-history), not just active ones.
  const accounts = await getPaymentAccounts({ activeOnly: false })
  const parsedAccountId = searchParams.paymentAccount ? Number.parseInt(searchParams.paymentAccount, 10) : Number.NaN
  const selectedAccount = pickDefaultAccount(accounts, parsedAccountId)

  const today = sydneyToday()
  const statementDate = parseDate(searchParams.statementDate) ?? today
  const statementDateStr = toYMD(statementDate)
  const statementEndOfDay = new Date(statementDateStr + "T23:59:59.999Z")

  const fyYear = currentFYYear(statementDate)
  const fyLabel = `FY ${fyYear}–${String(fyYear + 1).slice(2)}`

  if (!selectedAccount) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-foreground mb-4">Bank Reconciliation Report</h1>
        <div className="p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          No payment accounts configured yet. Add one in{" "}
          <Link href="/accounting/settings" className="underline font-medium">
            Accounting Settings
          </Link>.
        </div>
      </div>
    )
  }

  const openingBalance = await prisma.accountOpeningBalance.findUnique({
    where: { paymentAccountId: selectedAccount.id },
  })

  // Page view, not an export.
  await logAudit(
    actorId(session),
    "VIEW_FINANCIAL_REPORT",
    "ReconciliationReport",
    undefined,
    { report: "reconciliation", paymentAccountId: selectedAccount.id, statementDate: statementDateStr }
  )

  const [
    savedStatement,
    outstandingDeposits,
    outstandingPayments,
    clearedIncomeAgg,
    clearedExpenseAgg,
  ] = await Promise.all([
    prisma.reconciliationStatement.findUnique({
      where: {
        paymentAccountId_statementDate: {
          paymentAccountId: selectedAccount.id,
          statementDate,
        },
      },
    }),
    fetchIf(
      openingBalance,
      () =>
        prisma.transaction.findMany({
          where: {
            paymentAccountId: selectedAccount.id,
            type: TransactionType.INCOME,
            reconciled: false,
            // Anchored to asOfDate like the equation aggregates —
            // fyStart left pre-anchor uncleared rows in these lists but out
            // of the equation, corrupting the difference display.
            date: { gte: openingBalance!.asOfDate, lte: statementEndOfDay },
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            date: true,
            description: true,
            amount: true,
            family: { select: { name: true } },
          },
        }),
      [] as Array<{
        id: number
        date: Date
        description: string
        amount: { toString(): string }
        family: { name: string } | null
      }>
    ),
    fetchIf(
      openingBalance,
      () =>
        prisma.transaction.findMany({
          where: {
            paymentAccountId: selectedAccount.id,
            type: TransactionType.EXPENSE,
            reconciled: false,
            // Anchored to asOfDate like the equation aggregates —
            // fyStart left pre-anchor uncleared rows in these lists but out
            // of the equation, corrupting the difference display.
            date: { gte: openingBalance!.asOfDate, lte: statementEndOfDay },
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            date: true,
            description: true,
            amount: true,
            family: { select: { name: true } },
          },
        }),
      [] as Array<{
        id: number
        date: Date
        description: string
        amount: { toString(): string }
        family: { name: string } | null
      }>
    ),
    fetchIf(
      openingBalance,
      () =>
        prisma.transaction.aggregate({
          where: {
            paymentAccountId: selectedAccount.id,
            type: TransactionType.INCOME,
            reconciled: true,
            date: { gte: openingBalance!.asOfDate, lte: statementEndOfDay },
          },
          _sum: { amount: true },
          _count: true,
        }),
      { _sum: { amount: null }, _count: 0 }
    ),
    fetchIf(
      openingBalance,
      () =>
        prisma.transaction.aggregate({
          where: {
            paymentAccountId: selectedAccount.id,
            type: TransactionType.EXPENSE,
            reconciled: true,
            date: { gte: openingBalance!.asOfDate, lte: statementEndOfDay },
          },
          _sum: { amount: true },
          _count: true,
        }),
      { _sum: { amount: null }, _count: 0 }
    ),
  ])

  const decryptedDeposits = outstandingDeposits.map((tx) => ({
    ...tx,
    description: safeDecrypt(tx.description),
  }))
  const decryptedPayments = outstandingPayments.map((tx) => ({
    ...tx,
    description: safeDecrypt(tx.description),
  }))

  // Compute the whole book-vs-bank equation in integer cents so the verdict is
  // exact — no float drift, no 0.005 tolerance workaround. Display
  // values are derived back to dollars from the same integer cents.
  const clearedInCents = toCents(clearedIncomeAgg._sum.amount ?? 0)
  const clearedOutCents = toCents(clearedExpenseAgg._sum.amount ?? 0)
  const openingCents = openingBalance ? toCents(openingBalance.amount) : null

  const outstandingDepositsCents = sumCents(decryptedDeposits.map((tx) => tx.amount))
  const outstandingPaymentsCents = sumCents(decryptedPayments.map((tx) => tx.amount))

  const statementClosingCents = savedStatement ? toCents(savedStatement.closingBalance) : null

  const { calculatedCents, adjustedCents, differenceCents } = computeReconciliationEquation({
    openingCents,
    clearedInCents,
    clearedOutCents,
    statementClosingCents,
    outstandingDepositsCents,
    outstandingPaymentsCents,
  })
  const differenceIsZero = differenceCents === 0

  const clearedIn = centsToNumber(clearedInCents)
  const clearedOut = centsToNumber(clearedOutCents)
  const opening = centsToNumberOrNull(openingCents)
  const calculated = centsToNumberOrNull(calculatedCents)
  const outstandingDepositsTotal = centsToNumber(outstandingDepositsCents)
  const outstandingPaymentsTotal = centsToNumber(outstandingPaymentsCents)
  const statementClosing = centsToNumberOrNull(statementClosingCents)
  const adjusted = centsToNumberOrNull(adjustedCents)
  const difference = centsToNumberOrNull(differenceCents)

  const { name: churchName } = await getChurchSettings()

  return (
    <div className="max-w-3xl mx-auto">
      {/* Screen header */}
      <div className="mb-4 print:hidden">
        <h1 className="text-xl font-semibold text-foreground">Bank Reconciliation Report</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {churchName} · {fyLabel}
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6">
        <ReconReportControls
          accounts={accounts}
          paymentAccountId={selectedAccount.id}
          statementDate={statementDateStr}
        />
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold">Bank Reconciliation Report</h1>
        <p className="text-sm text-muted-foreground">
          {churchName} · {selectedAccount.name} · {fyLabel}
        </p>
        <p className="text-sm text-muted-foreground">Statement Date: {fmtDate(statementDate)}</p>
      </div>

      {!openingBalance && (
        <div className="p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          Set an opening balance in{" "}
          <Link href="/accounting/settings" className="underline font-medium">
            Accounting Settings
          </Link>{" "}
          to use this report.
        </div>
      )}

      {openingBalance && !savedStatement && (
        <div className="p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          No statement balance saved for {selectedAccount.name} on{" "}
          {fmtDate(statementDate)}.{" "}
          <Link href="/accounting/reconciliation" className="underline font-medium">
            Go to Reconciliation →
          </Link>
        </div>
      )}

      {openingBalance && savedStatement && calculated !== null && adjusted !== null && (
        <div className="space-y-6 text-sm">
          <div className="flex justify-between items-center p-4 bg-muted rounded-lg border border-border">
            <span className="font-medium text-muted-foreground">Statement Closing Balance</span>
            <span className="tabular font-semibold">{fmt(statementClosing!)}</span>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted border-b border-border">
              <h2 className="font-semibold text-muted-foreground">
                Outstanding Deposits — uncleared income (since {fmtDate(openingBalance.asOfDate)})
              </h2>
            </div>
            {decryptedDeposits.length === 0 ? (
              <p className="px-4 py-3 text-muted-foreground italic">None — all transactions cleared</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-table-narrow">
                <tbody>
                  {decryptedDeposits.map((tx) => (
                    <tr key={tx.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-muted-foreground w-28">{fmtDate(tx.date)}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {tx.description}
                        {tx.family ? ` — ${tx.family.name}` : ""}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {fmt(toFloat(tx.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <div className="px-4 py-2 bg-muted border-t border-border flex justify-between font-semibold">
              <span>Total Outstanding Deposits</span>
              <span className="tabular text-income">+ {fmt(outstandingDepositsTotal)}</span>
            </div>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted border-b border-border">
              <h2 className="font-semibold text-muted-foreground">
                Outstanding Payments — uncleared expenses (since {fmtDate(openingBalance.asOfDate)})
              </h2>
            </div>
            {decryptedPayments.length === 0 ? (
              <p className="px-4 py-3 text-muted-foreground italic">None — all transactions cleared</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full min-w-table-narrow">
                <tbody>
                  {decryptedPayments.map((tx) => (
                    <tr key={tx.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-muted-foreground w-28">{fmtDate(tx.date)}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {tx.description}
                        {tx.family ? ` — ${tx.family.name}` : ""}
                      </td>
                      <td className="px-4 py-2 text-right tabular">
                        {fmt(toFloat(tx.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <div className="px-4 py-2 bg-muted border-t border-border flex justify-between font-semibold">
              <span>Total Outstanding Payments</span>
              <span className="tabular text-expense">− {fmt(outstandingPaymentsTotal)}</span>
            </div>
          </div>

          <div className="flex justify-between items-center p-4 bg-info/10 rounded-lg border border-info/30">
            <span className="font-semibold text-primary">Adjusted Bank Balance</span>
            <span className="tabular font-bold text-primary text-base">{fmt(adjusted)}</span>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted border-b border-border">
              <h2 className="font-semibold text-muted-foreground">Book Balance (Calculated)</h2>
            </div>
            <div className="px-4 py-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Opening Balance{" "}
                  <span className="text-xs text-muted-foreground">
                    (since {fmtDate(openingBalance.asOfDate)})
                  </span>
                </span>
                <span className="tabular">{fmt(opening!)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">+ Cleared Income</span>
                <span className="tabular text-income">+ {fmt(clearedIn)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">− Cleared Expenses</span>
                <span className="tabular text-expense">− {fmt(clearedOut)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <span>Calculated Balance</span>
                <span className="tabular">{fmt(calculated)}</span>
              </div>
            </div>
          </div>

          <div
            className={`flex justify-between items-center p-4 rounded-lg border font-semibold text-base ${
              differenceIsZero
                ? "bg-success/10 border-success/40 text-success"
                : "border-destructive/40 bg-destructive/5 text-destructive"
            }`}
          >
            <span>Difference</span>
            <span className="tabular">
              {fmt(difference!)}{" "}
              {differenceIsZero ? "✓ Reconciled" : "— Out of balance"}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
