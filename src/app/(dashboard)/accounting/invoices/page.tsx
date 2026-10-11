import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { fmtAUD, centsToNumber, toCents } from "@/lib/formatting"
import { isRealCalendarDate } from "@/lib/validation"
import { sydneyTodayYMD } from "@/lib/dates"
import { listInvoices } from "@/lib/actions/invoice"
import { INVOICE_LIST_LIMIT } from "@/lib/invoice"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { Button } from "@/components/ui/button"
import { InvoiceStatusBadge } from "@/components/accounting/InvoiceStatusBadge"

type Props = { searchParams: Promise<{ status?: string; from?: string; to?: string }> }

const STATUSES = Object.values(InvoiceStatus)

/** Invoice list with status/date filters. */
export default async function InvoicesPage(props: Readonly<Props>) {
  const sp = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")
  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "Invoice", undefined, { report: "invoices" })

  const status = STATUSES.find((s) => s === sp.status)
  const from = sp.from && isRealCalendarDate(sp.from) ? sp.from : undefined
  const to = sp.to && isRealCalendarDate(sp.to) ? sp.to : undefined
  const result = await listInvoices({ status, from, to })
  if ("error" in result) redirect("/")
  const canManage = canAccessAccounting(session?.user?.role)
  const today = sydneyTodayYMD()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-foreground">Invoices</h2>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/accounting/customers">Customers</Link></Button>
          {canManage && <Button asChild><Link href="/accounting/invoices/new">New invoice</Link></Button>}
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-muted-foreground">Status</span>
          <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border border-input bg-background px-2">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">Issued from</span>
          <input type="date" name="from" defaultValue={from ?? ""} className="h-9 rounded-md border border-input bg-background px-2" />
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">to</span>
          <input type="date" name="to" defaultValue={to ?? ""} className="h-9 rounded-md border border-input bg-background px-2" />
        </label>
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      {result.length >= INVOICE_LIST_LIMIT && (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the newest {INVOICE_LIST_LIMIT} invoices. Narrow the status or date filters to see older ones.
        </p>
      )}

      {result.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Recipient</th>
                <th className="px-3 py-2 font-medium">Issued</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.map((r) => {
                const overdue = r.status === "SENT" && r.dueDate < today
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link className="underline-offset-2 hover:underline" href={`/accounting/invoices/${r.id}`}>{r.invoiceNo ?? "Draft"}</Link>
                    </td>
                    <td className="px-3 py-2">{r.recipientName}</td>
                    <td className="px-3 py-2">{r.issueDate}</td>
                    <td className={overdue ? "px-3 py-2 font-medium text-destructive" : "px-3 py-2"}>
                      {r.dueDate}{overdue && <span className="sr-only"> (overdue)</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtAUD(centsToNumber(toCents(r.total)))}</td>
                    <td className="px-3 py-2"><InvoiceStatusBadge status={r.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
