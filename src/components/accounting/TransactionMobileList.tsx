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

export function TransactionMobileList({
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
    // Mobile: card per transaction (avoids sideways table scroll)
    <ul className="space-y-2 md:hidden">
      {transactions.length === 0 && (
        <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          No transactions found
        </li>
      )}
      {transactions.map((tx) => {
        const isPettyCash = tx.pettyCashReceiptId != null || tx.pettyCashExpenseId != null || tx.pettyCashTransferId != null
        const pcSessionId = tx.pettyCashReceipt?.sessionId ?? tx.pettyCashExpense?.sessionId ?? tx.pettyCashTransfer?.sessionId
        const locked = isDateLocked(tx.date, lockDate)
        const meta = [
          tx.paymentAccountRel?.name ?? null,
          tx.family?.name ?? null,
        ].filter(Boolean).join(" · ")
        return (
          <li key={tx.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {tx.description}
                  {isPettyCash && <Badge variant="secondary" className="ml-2 text-xs">Petty Cash</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tx.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })} · {tx.account.code} {tx.account.name}
                </p>
                <RiskFlagBadges tx={tx} className="mt-1" />
              </div>
              <span className={`shrink-0 tabular font-semibold whitespace-nowrap ${tx.type === "INCOME" ? "text-income" : "text-expense"}`}>
                {tx.type === "INCOME" ? "+" : "-"}{fmtAUD(Number(tx.amount))}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-muted-foreground">{meta || "—"}</span>
              {userCanEdit && tx.paymentAccountId ? (
                <ReconcileToggleButton id={tx.id} reconciled={tx.reconciled} paymentAccountId={tx.paymentAccountId} />
              ) : tx.reconciled ? (
                <Badge variant="default">Reconciled</Badge>
              ) : (
                <Badge variant="outline">Pending</Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 border-t pt-2 print:hidden">
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
          </li>
        )
      })}
      {transactions.length > 0 && (
        <li className="rounded-lg border bg-secondary p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{total.toLocaleString()} transaction{total !== 1 ? "s" : ""}</span>
            <span className={`tabular font-semibold ${net >= 0 ? "text-income" : "text-expense"}`}>
              {net >= 0 ? "+" : "-"}{fmtAUD(Math.abs(net))}
            </span>
          </div>
          <div className="mt-1 flex justify-end gap-4 text-xs">
            <span className="text-income tabular">+{fmtAUD(income)}</span>
            <span className="text-expense tabular">-{fmtAUD(expense)}</span>
          </div>
        </li>
      )}
    </ul>
  )
}
