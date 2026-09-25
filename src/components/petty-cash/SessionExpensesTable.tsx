import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DeleteExpenseButton } from "@/components/petty-cash/DeleteExpenseButton"
import { fmtAUD as fmt } from "@/lib/formatting"
import { isDateLocked } from "@/lib/accountingLock"
import { safeDecrypt } from "@/lib/crypto"
import type { SessionExpense } from "@/app/(dashboard)/accounting/petty-cash/sessions/[id]/page.data"
import { APP_LOCALE } from "@/lib/appConfig"

interface Props {
  sessionId: number
  expenses: SessionExpense[]
  totalExpenses: number
  userCanEdit: boolean
  userIsAdmin: boolean
  isOpen: boolean
  lockDate: Date | null
}

/** Expenses section of the session detail page — mobile cards + desktop table. */
export function SessionExpensesTable({
  sessionId,
  expenses,
  totalExpenses,
  userCanEdit,
  userIsAdmin,
  isOpen,
  lockDate,
}: Props) {
  // Empty-state colSpan must match the rendered header columns — the action
  // column only exists for editors on an open session.
  const expenseColSpan = userCanEdit && isOpen ? 7 : 6

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Expenses ({expenses.length})</h3>
      {/* Mobile: card per expense (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {expenses.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No expenses
          </li>
        )}
        {expenses.map((e) => {
          const locked = isDateLocked(e.date, lockDate)
          return (
            <li key={e.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{safeDecrypt(e.payee)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })} · {e.account.code} {e.account.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{safeDecrypt(e.description)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Receipt ref: {e.receiptRef ?? "—"}</p>
                </div>
                <span className="shrink-0 tabular font-semibold text-expense whitespace-nowrap">
                  -{fmt(Number(e.amount))}
                </span>
              </div>
              {userCanEdit && isOpen && (
                <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                  {locked ? (
                    <Button variant="ghost" size="sm" disabled aria-label="Edit — period locked">Edit</Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/accounting/petty-cash/sessions/${sessionId}/expenses/${e.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                  {userIsAdmin && <DeleteExpenseButton id={e.id} locked={locked} />}
                  {locked && !userIsAdmin && <span className="text-xs text-muted-foreground">Period locked</span>}
                </div>
              )}
            </li>
          )
        })}
        {expenses.length > 0 && (
          <li className="rounded-lg border bg-secondary p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="tabular font-semibold text-expense">-{fmt(totalExpenses)}</span>
            </div>
          </li>
        )}
      </ul>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-table text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">Date</th>
            <th scope="col" className="pb-2 font-medium">Payee</th>
            <th scope="col" className="pb-2 font-medium">Category</th>
            <th scope="col" className="pb-2 font-medium">Description</th>
            <th scope="col" className="pb-2 font-medium">Receipt ref</th>
            <th scope="col" className="pb-2 font-medium text-right">Amount</th>
            {userCanEdit && isOpen && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {expenses.length === 0 && (
            <tr>
              <td colSpan={expenseColSpan} className="py-4 text-center text-muted-foreground">
                No expenses
              </td>
            </tr>
          )}
          {expenses.map((e) => {
            const locked = isDateLocked(e.date, lockDate)
            return (
            <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 pr-4 whitespace-nowrap">
                {e.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}
              </td>
              <td className="py-2 pr-4">{safeDecrypt(e.payee)}</td>
              <td className="py-2 pr-4">
                {e.account.code} — {e.account.name}
              </td>
              <td className="py-2 pr-4">{safeDecrypt(e.description)}</td>
              <td className="py-2 pr-4 text-muted-foreground">{e.receiptRef ?? "—"}</td>
              <td className="py-2 pr-4 text-right tabular text-expense">
                -{fmt(Number(e.amount))}
              </td>
              {userCanEdit && isOpen && (
                <td className="py-2 whitespace-nowrap">
                  {locked ? (
                    <Button variant="ghost" size="sm" disabled aria-label="Edit — period locked">Edit</Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/accounting/petty-cash/sessions/${sessionId}/expenses/${e.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                  {userIsAdmin && <DeleteExpenseButton id={e.id} locked={locked} />}
                  {locked && !userIsAdmin && <span className="text-xs text-muted-foreground">Period locked</span>}
                </td>
              )}
            </tr>
            )
          })}
          {expenses.length > 0 && (
            <tr className="border-t font-medium">
              <td colSpan={5} className="pt-3 text-muted-foreground text-sm">
                Total
              </td>
              <td className="pt-3 text-right tabular text-expense">
                -{fmt(totalExpenses)}
              </td>
              {userCanEdit && isOpen && <td />}
            </tr>
          )}
        </tbody>
      </table></div>
    </div>
  )
}
