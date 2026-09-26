import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { canViewAccounting, canAccessAccounting } from "@/lib/roleGuard"
import { ReconciliationFilters } from "@/components/accounting/ReconciliationFilters"
import { ReconcileTable } from "@/components/accounting/ReconcileTable"
import { StatementBalanceInput } from "@/components/accounting/StatementBalanceInput"
import { computeRunningBalances } from "@/lib/reconcileRunning"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { sydneyToday, endOfDayUTC } from "@/lib/dates"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { currentFYYear } from "@/lib/fiscalYear"
import { fmtAUD, MONTH_ABBR_TITLE, toCents, centsToNumber } from "@/lib/formatting"

// Cap the rendered transaction list so a wide (e.g. all-time) date range can't
// load thousands of rows into memory and the DOM. The reconciliation
// equation/summary use server-side groupBy aggregates, so they stay accurate
// regardless of this cap — only the table below is bounded.
const RECON_TX_CAP = 1000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function parseDate(s: string | undefined): Date | null {
  if (!s || !ISO_DATE.test(s)) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

// UTC getters throughout — the rest of the accounting pages read/display dates in
// UTC, so a non-UTC host must not shift a boundary-time transaction's day.
function toYMD(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function fmtDate(d: Date) {
  return `${d.getUTCDate()} ${MONTH_ABBR_TITLE[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export default async function ReconciliationPage(props: {
  searchParams: Promise<{ paymentAccount?: string; from?: string; to?: string; status?: string }>
}) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const searchParams = await props.searchParams

  const today = sydneyToday()
  const fyYear = currentFYYear()
  const fyStart = new Date(Date.UTC(fyYear, 6, 1)) // 1 July, UTC anchor

  // Reports show all accounts (incl. deactivated-with-history), not just active ones.
  const accounts = await getPaymentAccounts({ activeOnly: false })
  const parsedAccountId = searchParams.paymentAccount ? Number.parseInt(searchParams.paymentAccount, 10) : Number.NaN
  const selectedAccount =
    accounts.find((a) => a.id === parsedAccountId) ??
    accounts.find((a) => a.kind === "BANK") ??
    accounts[0] ??
    null

  const fromDate = parseDate(searchParams.from) ?? fyStart
  const toDate = parseDate(searchParams.to) ?? today

  // Status filter applies to the transaction LIST only — the summary bar and
  // equation stay full-period so their totals never depend on the view.
  const statusFilter: "all" | "pending" | "reconciled" =
    searchParams.status === "pending" || searchParams.status === "reconciled"
      ? searchParams.status
      : "all"
  const statusWhere =
    statusFilter === "pending"
      ? { reconciled: false }
      : statusFilter === "reconciled"
        ? { reconciled: true }
        : {}

  const fromStr = toYMD(fromDate)
  const toStr = toYMD(toDate)

  if (!selectedAccount) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-foreground">Reconciliation</h1>
        </div>
        <div className="p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          No payment accounts configured yet. Add one in{" "}
          <a href="/accounting/settings" className="underline font-medium">
            Accounting Settings
          </a>.
        </div>
      </div>
    )
  }

  // Step 1: fetch opening balance for this account (fast, single row)
  const openingBalance = await prisma.accountOpeningBalance.findUnique({
    where: { paymentAccountId: selectedAccount.id },
  })

  const beforeOpeningBalance =
    !!openingBalance && endOfDayUTC(toDate) < openingBalance.asOfDate

  // Step 2: parallel queries
  const txWhere = {
    paymentAccountId: selectedAccount.id,
    // lte must reach end-of-day so a transaction stamped any time on `toDate`
    // is included — matches the reconciliation report page.
    date: { gte: fromDate, lte: endOfDayUTC(toDate) },
  }

  const [
    transactions,
    reconciledByType,
    unreconciledByType,
    runningBalanceIncome,
    runningBalanceExpense,
    savedStatement,
  ] = await Promise.all([
      prisma.transaction.findMany({
        where: { ...txWhere, ...statusWhere },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: RECON_TX_CAP,
        select: {
          id: true,
          date: true,
          description: true,
          amount: true,
          type: true,
          reconciled: true,
          family: { select: { name: true } },
        },
      }),
      // Group by type so income and expense are reported separately — summing
      // amount across both types nets income against expense into a figure
      // that means nothing beside a bank statement.
      prisma.transaction.groupBy({
        by: ["type"],
        where: { ...txWhere, reconciled: true },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.groupBy({
        by: ["type"],
        where: { ...txWhere, reconciled: false },
        _sum: { amount: true },
        _count: true,
      }),
      // Book balance counts ALL transactions in the period (not just reconciled):
      // saving a closing balance that matches this book balance is what marks the
      // period reconciled (reconcile-on-save). lte reaches end-of-day so a tx
      // stamped any time on `toDate` is included — must match the bound in
      // saveStatementBalance so the Difference shown here equals the save decision.
      openingBalance && !beforeOpeningBalance
        ? prisma.transaction.aggregate({
            where: {
              paymentAccountId: selectedAccount.id,
              type: TransactionType.INCOME,
              date: { gte: openingBalance.asOfDate, lte: endOfDayUTC(toDate) },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      openingBalance && !beforeOpeningBalance
        ? prisma.transaction.aggregate({
            where: {
              paymentAccountId: selectedAccount.id,
              type: TransactionType.EXPENSE,
              date: { gte: openingBalance.asOfDate, lte: endOfDayUTC(toDate) },
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      prisma.reconciliationStatement.findUnique({
        where: {
          paymentAccountId_statementDate: {
            paymentAccountId: selectedAccount.id,
            statementDate: toDate,
          },
        },
      }),
    ])

  const decryptedTransactions = transactions.map((tx) => ({
    ...tx,
    description: safeDecrypt(tx.description),
  }))

  const periodIn    = centsToNumber(toCents(runningBalanceIncome._sum.amount ?? 0))
  const periodOut   = centsToNumber(toCents(runningBalanceExpense._sum.amount ?? 0))
  // Compute in integer cents to match reconcileIfBalanced's server-side math —
  // a float sum here could show "Difference: $0.00" while the action's cent
  // comparison still finds diffCents >= 1 and refuses to auto-reconcile.
  const calculated  = openingBalance && !beforeOpeningBalance
    ? centsToNumber(
        toCents(openingBalance.amount) +
        toCents(runningBalanceIncome._sum.amount ?? 0) -
        toCents(runningBalanceExpense._sum.amount ?? 0)
      )
    : null
  const userCanEdit = canAccessAccounting(session?.user?.role)

  // No cast — let TS validate the real groupBy shape (_count: true → number).
  const sumOf = (rows: typeof reconciledByType, t: TransactionType) =>
    centsToNumber(toCents(rows.find((r) => r.type === t)?._sum.amount ?? 0))
  const countOf = (rows: typeof reconciledByType) => rows.reduce((n, r) => n + r._count, 0)

  const reconciledIn = sumOf(reconciledByType, TransactionType.INCOME)
  const reconciledOut = sumOf(reconciledByType, TransactionType.EXPENSE)
  const reconciledCount = countOf(reconciledByType)
  const pendingIn = sumOf(unreconciledByType, TransactionType.INCOME)
  const pendingOut = sumOf(unreconciledByType, TransactionType.EXPENSE)
  const unreconciledCount = countOf(unreconciledByType)

  // Running book balance down the list. Only meaningful when there is an
  // opening-balance anchor, the view isn't status-filtered (a running balance
  // that skips rows means nothing), and the window starts on or after the anchor
  // (else pre-anchor rows would double-count against the opening balance).
  const showRunningBalance =
    !!openingBalance && statusFilter === "all" && fromDate >= openingBalance.asOfDate
  let runningCents: number[] = []
  if (showRunningBalance) {
    // Balance carried into the window: opening + net movement strictly before
    // the window's start (matches the list's `gte: fromDate` lower bound).
    const preRange = { gte: openingBalance!.asOfDate, lt: fromDate }
    const [preIn, preExp] = await Promise.all([
      prisma.transaction.aggregate({
        where: { paymentAccountId: selectedAccount.id, type: TransactionType.INCOME, date: preRange },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { paymentAccountId: selectedAccount.id, type: TransactionType.EXPENSE, date: preRange },
        _sum: { amount: true },
      }),
    ])
    const startCents =
      toCents(openingBalance!.amount) + toCents(preIn._sum.amount) - toCents(preExp._sum.amount)
    runningCents = computeRunningBalances(
      decryptedTransactions.map((t) => ({ type: t.type, amountCents: toCents(t.amount) })),
      startCents
    )
  }

  const tableRows = decryptedTransactions.map((tx, i) => ({
    id: tx.id,
    dateLabel: fmtDate(tx.date),
    description: tx.description,
    amount: Number(tx.amount),
    familyName: tx.family?.name ?? null,
    type: tx.type as "INCOME" | "EXPENSE",
    reconciled: tx.reconciled,
    runningBalance: showRunningBalance ? centsToNumber(runningCents[i]) : null,
  }))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-foreground">Reconciliation</h1>
      </div>

      <div className="mb-4">
        <ReconciliationFilters
          accounts={accounts}
          paymentAccountId={selectedAccount.id}
          from={fromStr}
          to={toStr}
          status={statusFilter}
        />
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-6 mb-4 p-4 bg-muted rounded-lg border border-border">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Reconciled</p>
          <p className="text-sm font-semibold">
            {reconciledCount} transactions · <span className="text-income">{fmtAUD(reconciledIn)} in</span> · <span className="text-expense">{fmtAUD(reconciledOut)} out</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p>
          <p className="text-sm font-semibold">
            {unreconciledCount} transactions · <span className="text-income">{fmtAUD(pendingIn)} in</span> · <span className="text-expense">{fmtAUD(pendingOut)} out</span>
          </p>
        </div>
      </div>

      {/* Equation panel */}
      {openingBalance && calculated !== null ? (
        <div className="mb-4 p-4 bg-card rounded-lg border border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Reconciliation Equation
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Book balance — opening balance plus every transaction this period. When it matches
            the statement closing balance, saving the balance reconciles the period.
          </p>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center">
              <span className="text-muted-foreground w-52">
                Opening Balance{" "}
                <span className="text-muted-foreground text-xs">
                  (since {fmtDate(openingBalance.asOfDate)})
                </span>
              </span>
              <span className="tabular">{fmtAUD(Number(openingBalance.amount))}</span>
            </div>
            <div className="flex items-center">
              <span className="text-muted-foreground w-52">+ Income (this period)</span>
              <span className="tabular text-income">+ {fmtAUD(periodIn)}</span>
            </div>
            <div className="flex items-center">
              <span className="text-muted-foreground w-52">− Expenses (this period)</span>
              <span className="tabular text-expense">− {fmtAUD(periodOut)}</span>
            </div>
            <div className="flex items-center border-t pt-1.5 font-semibold">
              <span className="w-52">Calculated Balance</span>
              <span className="tabular">{fmtAUD(calculated)}</span>
            </div>
            <div className="border-t pt-2">
              <StatementBalanceInput
                key={`${selectedAccount.id}-${toStr}`}
                paymentAccountId={selectedAccount.id}
                statementDate={toStr}
                initialValue={
                  savedStatement
                    ? savedStatement.closingBalance.toString()
                    : null
                }
                calculatedBalance={calculated}
                canEdit={userCanEdit}
              />
            </div>
          </div>
        </div>
      ) : openingBalance ? (
        <div className="mb-4 p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          This account has no defined position until its opening-balance date, {fmtDate(openingBalance.asOfDate)}.
        </div>
      ) : (
        !openingBalance && (
          <div className="mb-4 p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
            Set an opening balance in{" "}
            <a href="/accounting/settings" className="underline font-medium">
              Accounting Settings
            </a>{" "}
            to use the reconciliation equation.
          </div>
        )
      )}

      {/* Transactions table */}
      {decryptedTransactions.length === RECON_TX_CAP && (
        <div className="mb-3 p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
          Showing the first {RECON_TX_CAP.toLocaleString()} transactions for this date range. Narrow the date range to see the rest. The equation and summary totals above still reflect the full period.
        </div>
      )}
      <ReconcileTable
        rows={tableRows}
        userCanEdit={userCanEdit}
        paymentAccountId={selectedAccount.id}
        showRunningBalance={showRunningBalance}
      />
    </div>
  )
}
