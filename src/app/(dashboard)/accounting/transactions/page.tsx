import { redirect } from "next/navigation"
import Link from "next/link"
import { Suspense } from "react"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canAccessAccounting, canViewAccounting, isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { Button } from "@/components/ui/button"
import { TransactionFilters } from "@/components/accounting/TransactionFilters"
import { TransactionMobileList } from "@/components/accounting/TransactionMobileList"
import { TransactionTable } from "@/components/accounting/TransactionTable"
import { TransactionPagination } from "@/components/accounting/TransactionPagination"
import { transactionExportQuery, transactionListQuery } from "@/lib/transactionFilters"
import { getTransactionsData, TX_CAP, SEARCH_SCAN_CAP, type TransactionsSearchParams } from "@/lib/reports/transactionsQuery"

export default async function TransactionsPage(
  props: Readonly<{
    searchParams: Promise<TransactionsSearchParams>
  }>
) {
  const searchParams = await props.searchParams;
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const {
    transactions: filteredTransactions,
    accounts,
    families,
    paymentAccounts,
    months,
    lockDate,
    total,
    totalPages,
    page,
    q,
    income,
    expense,
    net,
    startIdx,
    endIdx,
    searchTruncated,
    type,
    paymentAccountId,
    accountId,
  } = await getTransactionsData(searchParams)

  const userIsAdmin = isAdmin(session?.user?.role)
  const userCanEdit = canAccessAccounting(session?.user?.role)

  // Log VIEW_TRANSACTION_LIST for every accounting role, not just AUDITOR —
  // ADMIN/PASTOR bulk-views of financial data must leave a trail too (
  // matching the all-roles receipt-audit logging from).
  void logAudit(actorId(session), "VIEW_TRANSACTION_LIST", "Transaction")

  // Same allow-list as listQuery (minus `page`); forwards the validated
  // account/type/paymentAccount, not the raw searchParams strings, so an
  // invalid value can't be passed through to the export route.
  const exportQuery = transactionExportQuery(searchParams, {
    account: accountId === undefined ? undefined : String(accountId),
    type: type || undefined,
    paymentAccount: paymentAccountId === undefined ? undefined : String(paymentAccountId),
  })
  const listQuery = transactionListQuery(searchParams)
  const exportHref = `/api/accounting/transactions/export-csv?${exportQuery}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Transactions</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref} download>Export CSV</a>
          </Button>
          {userCanEdit && (
            <Button asChild size="sm">
              <Link href="/accounting/transactions/new">New transaction</Link>
            </Button>
          )}
        </div>
      </div>

      <Suspense fallback={<div className="h-10 rounded bg-muted animate-pulse" />}>
        <TransactionFilters accounts={accounts} families={families} paymentAccounts={paymentAccounts} months={months} />
      </Suspense>

      {searchTruncated && (
        <p className="text-sm text-warning">
          Searched only the {SEARCH_SCAN_CAP.toLocaleString()} most recent transactions. Older
          matches may exist — narrow with the date, account, or family filters.
        </p>
      )}

      {total > TX_CAP && (
        <p className="text-sm text-muted-foreground">
          Showing {startIdx.toLocaleString()}–{endIdx.toLocaleString()} of {total.toLocaleString()}
          {q ? <> matches for &ldquo;{q}&rdquo;</> : " transactions"}
        </p>
      )}

      <TransactionMobileList
        transactions={filteredTransactions}
        lockDate={lockDate}
        userCanEdit={userCanEdit}
        userIsAdmin={userIsAdmin}
        total={total}
        income={income}
        expense={expense}
        net={net}
        listQuery={listQuery}
      />

      <TransactionTable
        transactions={filteredTransactions}
        lockDate={lockDate}
        userCanEdit={userCanEdit}
        userIsAdmin={userIsAdmin}
        total={total}
        income={income}
        expense={expense}
        net={net}
        listQuery={listQuery}
      />

      <TransactionPagination searchParams={searchParams} page={page} totalPages={totalPages} />
    </div>
  )
}
