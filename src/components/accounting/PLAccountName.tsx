import Link from "next/link"
import type { PLAccountRow } from "@/lib/reports/plQuery"
import { plTransactionsHref } from "@/components/accounting/plFormat"

/** P&L category name, linked to its FY transactions, with an inactive tag. */
export function PLAccountName({ account, year }: Readonly<{ account: PLAccountRow; year: number }>) {
  return (
    <>
      <Link href={plTransactionsHref(account.id, year)} className="hover:underline">
        {account.name}
      </Link>
      {!account.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
    </>
  )
}
