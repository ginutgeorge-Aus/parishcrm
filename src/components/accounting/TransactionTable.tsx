import Link from "next/link"
import { isDateLocked } from "@/lib/accountingLock"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DeleteTransactionButton } from "@/components/accounting/DeleteTransactionButton"
import { ReconcileToggleButton } from "@/components/accounting/ReconcileToggleButton"
import { RiskFlagBadges } from "@/components/accounting/RiskFlagBadges"
import { fmtAUD } from "@/lib/formatting"
import type { TransactionRow, TransactionsData } from "@/lib/reports/transactionsQuery"
import { APP_LOCALE } from "@/lib/appConfig"

type Props = {
  transactions: TransactionRow[]
  lockDate: TransactionsData["lockDate"]
  userCanEdit: boolean
  userIsAdmin: boolean
  total: number
  income: number
  expense: number
  net: number
}

export function TransactionTable({
  transactions,
  lockDate,
  userCanEdit,
  userIsAdmin,
  total,
  income,
  expense,
  net,
}: Props) {
  return (
    // Desktop: full table
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="sticky top-0 bg-background pb-2 font-medium">Date</th>
            <th className="sticky top-0 bg-background pb-2 font-medium">Description</th>
            <th className="sticky top-0 bg-background pb-2 font-medium">Category</th>
            <th className="sticky top-0 bg-background pb-2 font-medium">Payment account</th>
            <th className="sticky top-0 bg-background pb-2 font-medium">Family</th>
            <th className="sticky top-0 bg-background pb-2 pr-4 font-medium text-right">Amount</th>
            <th className="sticky top-0 bg-background pb-2 font-medium">Status</th>
            <th className="sticky top-0 bg-background pb-2 print:hidden" />
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-muted-foreground">
                No transactions found
              </td>
            </tr>
          )}
          {transactions.map((tx) => {
            const isPettyCash = tx.pettyCashReceiptId != null || tx.pettyCashExpenseId != null || tx.pettyCashTransferId != null
            const pcSessionId = tx.pettyCashReceipt?.sessionId ?? tx.pettyCashExpense?.sessionId ?? tx.pettyCashTransfer?.sessionId
            const locked = isDateLocked(tx.date, lockDate)
            return (
            <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 pr-4 whitespace-nowrap">
                {tx.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}
              </td>
              <td className="py-2 pr-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{tx.description}</span>
                  {isPettyCash && (
                    <Badge variant="secondary" className="text-xs">Petty Cash</Badge>
                  )}
                  <RiskFlagBadges tx={tx} />
                </div>
              </td>
              <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                {tx.account.code} {tx.account.name}
              </td>
              <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                {tx.paymentAccountRel?.name ?? "—"}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{tx.family?.name ?? "—"}</td>
              <td className={`py-2 pr-4 text-right tabular whitespace-nowrap font-medium ${tx.type === "INCOME" ? "text-income" : "text-expense"}`}>
                {tx.type === "INCOME" ? "+" : "-"}{fmtAUD(Number(tx.amount))}
              </td>
              <td className="py-2 pr-4">
                {userCanEdit && tx.paymentAccountId ? (
                  <ReconcileToggleButton id={tx.id} reconciled={tx.reconciled} paymentAccountId={tx.paymentAccountId} />
                ) : (
                  tx.reconciled
                    ? <Badge variant="default">Reconciled</Badge>
                    : <Badge variant="outline">Pending</Badge>
                )}
              </td>
              <td className="py-2 print:hidden">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/accounting/transactions/${tx.id}`}>View</Link>
                  </Button>
                  {isPettyCash ? (
                    pcSessionId != null && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/accounting/petty-cash/sessions/${pcSessionId}`}>View Session</Link>
                      </Button>
                    )
                  ) : (
                    <>
                      {userCanEdit && (
                        locked ? (
                          <Button variant="ghost" size="sm" disabled aria-label="Edit — period locked">Edit</Button>
                        ) : (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/accounting/transactions/${tx.id}/edit`}>Edit</Link>
                          </Button>
                        )
                      )}
                      {userIsAdmin && <DeleteTransactionButton id={tx.id} locked={locked} />}
                      {locked && !userIsAdmin && <span className="text-xs text-muted-foreground">Period locked</span>}
                    </>
                  )}
                </div>
              </td>
            </tr>
            )
          })}
        </tbody>
        {transactions.length > 0 && (
          <tfoot>
            <tr className="border-t font-medium">
              <td colSpan={5} className="pt-3 text-muted-foreground text-sm">
                {total.toLocaleString()} transaction{total !== 1 ? "s" : ""}
              </td>
              <td className="pt-3 text-right tabular text-sm space-y-0.5 whitespace-nowrap">
                <div className="text-income">+{fmtAUD(income)}</div>
                <div className="text-expense">-{fmtAUD(expense)}</div>
                <div className={`border-t pt-0.5 ${net >= 0 ? "text-income" : "text-expense"}`}>
                  {net >= 0 ? "+" : "-"}{fmtAUD(Math.abs(net))}
                </div>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
