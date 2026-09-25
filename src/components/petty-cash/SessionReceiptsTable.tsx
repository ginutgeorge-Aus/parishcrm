import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DeleteReceiptButton } from "@/components/petty-cash/DeleteReceiptButton"
import { fmtAUD as fmt } from "@/lib/formatting"
import { isDateLocked } from "@/lib/accountingLock"
import type { SessionReceipt } from "@/app/(dashboard)/accounting/petty-cash/sessions/[id]/page.data"
import { APP_LOCALE } from "@/lib/appConfig"

interface Props {
  sessionId: number
  receipts: SessionReceipt[]
  totalReceipts: number
  userCanEdit: boolean
  userIsAdmin: boolean
  isOpen: boolean
  lockDate: Date | null
}

/** Receipts section of the session detail page — mobile cards + desktop table. */
export function SessionReceiptsTable({
  sessionId,
  receipts,
  totalReceipts,
  userCanEdit,
  userIsAdmin,
  isOpen,
  lockDate,
}: Props) {
  // Empty-state colSpan must match the rendered header columns — the action
  // column only exists for editors on an open session.
  const receiptColSpan = userCanEdit && isOpen ? 6 : 5

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Receipts ({receipts.length})</h3>
      {/* Mobile: card per receipt (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {receipts.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No receipts
          </li>
        )}
        {receipts.map((r) => {
          const locked = isDateLocked(r.date, lockDate)
          return (
            <li key={r.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.account.code} — {r.account.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}
                    {r.serviceType?.name ? ` · ${r.serviceType.name}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Donor: {r.person ? `${r.person.firstName} ${r.person.lastName}` : "—"}
                  </p>
                </div>
                <span className="shrink-0 tabular font-semibold text-income whitespace-nowrap">
                  +{fmt(Number(r.amount))}
                </span>
              </div>
              {userCanEdit && isOpen && (
                <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                  {locked ? (
                    <Button variant="ghost" size="sm" disabled aria-label="Edit — period locked">Edit</Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/accounting/petty-cash/sessions/${sessionId}/receipts/${r.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                  {userIsAdmin && <DeleteReceiptButton id={r.id} locked={locked} />}
                  {locked && !userIsAdmin && <span className="text-xs text-muted-foreground">Period locked</span>}
                </div>
              )}
            </li>
          )
        })}
        {receipts.length > 0 && (
          <li className="rounded-lg border bg-secondary p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="tabular font-semibold text-income">+{fmt(totalReceipts)}</span>
            </div>
          </li>
        )}
      </ul>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-table text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">Date</th>
            <th scope="col" className="pb-2 font-medium">Category</th>
            <th scope="col" className="pb-2 font-medium">Service type</th>
            <th scope="col" className="pb-2 font-medium">Donor</th>
            <th scope="col" className="pb-2 font-medium text-right">Amount</th>
            {userCanEdit && isOpen && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {receipts.length === 0 && (
            <tr>
              <td colSpan={receiptColSpan} className="py-4 text-center text-muted-foreground">
                No receipts
              </td>
            </tr>
          )}
          {receipts.map((r) => {
            const locked = isDateLocked(r.date, lockDate)
            return (
            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 pr-4 whitespace-nowrap">
                {r.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}
              </td>
              <td className="py-2 pr-4">
                {r.account.code} — {r.account.name}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.serviceType?.name ?? "—"}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.person ? `${r.person.firstName} ${r.person.lastName}` : "—"}
              </td>
              <td className="py-2 pr-4 text-right tabular text-income">
                +{fmt(Number(r.amount))}
              </td>
              {userCanEdit && isOpen && (
                <td className="py-2 whitespace-nowrap">
                  {locked ? (
                    <Button variant="ghost" size="sm" disabled aria-label="Edit — period locked">Edit</Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/accounting/petty-cash/sessions/${sessionId}/receipts/${r.id}/edit`}>Edit</Link>
                    </Button>
                  )}
                  {userIsAdmin && <DeleteReceiptButton id={r.id} locked={locked} />}
                  {locked && !userIsAdmin && <span className="text-xs text-muted-foreground">Period locked</span>}
                </td>
              )}
            </tr>
            )
          })}
          {receipts.length > 0 && (
            <tr className="border-t font-medium">
              <td colSpan={4} className="pt-3 text-muted-foreground text-sm">
                Total
              </td>
              <td className="pt-3 text-right tabular text-income">
                +{fmt(totalReceipts)}
              </td>
              {userCanEdit && isOpen && <td />}
            </tr>
          )}
        </tbody>
      </table></div>
    </div>
  )
}
