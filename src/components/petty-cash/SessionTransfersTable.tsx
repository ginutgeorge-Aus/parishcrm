import { fmtAUD as fmt } from "@/lib/formatting"
import { isDateLocked } from "@/lib/accountingLock"
import { safeDecrypt } from "@/lib/crypto"
import { DeleteTransferButton } from "@/components/petty-cash/DeleteTransferButton"
import type { SessionTransfer } from "@/app/(dashboard)/accounting/petty-cash/sessions/[id]/page.data"
import { APP_LOCALE } from "@/lib/appConfig"

interface Props {
  transfers: SessionTransfer[]
  totalTransfers: number
  userIsAdmin: boolean
  isOpen: boolean
  lockDate: Date | null
}

/** Bank transfers section of the session detail page — mobile cards + desktop table. */
export function SessionTransfersTable({ transfers, totalTransfers, userIsAdmin, isOpen, lockDate }: Props) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Bank transfers ({transfers.length})</h3>
      {/* Mobile: card per transfer (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {transfers.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No transfers
          </li>
        )}
        {transfers.map((t) => {
          const locked = isDateLocked(t.date, lockDate)
          return (
            <li key={t.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{safeDecrypt(t.depositedByName)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })} · Slip: {t.depositSlipRef ?? "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Retained float: {Number(t.retainedFloat) > 0 ? fmt(Number(t.retainedFloat)) : "—"}
                  </p>
                </div>
                <span className="shrink-0 tabular font-medium whitespace-nowrap">
                  {fmt(Number(t.amount))}
                </span>
              </div>
              {userIsAdmin && isOpen && (
                <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                  <DeleteTransferButton id={t.id} locked={locked} />
                </div>
              )}
            </li>
          )
        })}
        {transfers.length > 0 && (
          <li className="rounded-lg border bg-secondary p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total transferred</span>
              <span className="tabular font-medium">{fmt(totalTransfers)}</span>
            </div>
          </li>
        )}
      </ul>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-table text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="pb-2 font-medium">Date</th>
            <th scope="col" className="pb-2 font-medium">Deposited by</th>
            <th scope="col" className="pb-2 font-medium">Deposit slip</th>
            <th scope="col" className="pb-2 font-medium">Retained float</th>
            <th scope="col" className="pb-2 font-medium text-right">Amount</th>
            {userIsAdmin && isOpen && <th scope="col" className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {transfers.length === 0 && (
            <tr>
              <td colSpan={userIsAdmin && isOpen ? 6 : 5} className="py-4 text-center text-muted-foreground">
                No transfers
              </td>
            </tr>
          )}
          {transfers.map((t) => {
            const locked = isDateLocked(t.date, lockDate)
            return (
            <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="py-2 pr-4 whitespace-nowrap">
                {t.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}
              </td>
              <td className="py-2 pr-4">{safeDecrypt(t.depositedByName)}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {t.depositSlipRef ?? "—"}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {Number(t.retainedFloat) > 0 ? fmt(Number(t.retainedFloat)) : "—"}
              </td>
              <td className="py-2 pr-4 text-right tabular font-medium">
                {fmt(Number(t.amount))}
              </td>
              {userIsAdmin && isOpen && (
                <td className="py-2 whitespace-nowrap">
                  <DeleteTransferButton id={t.id} locked={locked} />
                </td>
              )}
            </tr>
            )
          })}
          {transfers.length > 0 && (
            <tr className="border-t font-medium">
              <td colSpan={4} className="pt-3 text-muted-foreground text-sm">
                Total transferred
              </td>
              <td className="pt-3 text-right tabular">{fmt(totalTransfers)}</td>
              {userIsAdmin && isOpen && <td />}
            </tr>
          )}
        </tbody>
      </table></div>
    </div>
  )
}
