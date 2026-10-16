import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { fmtAUD, centsToNumber, toCents } from "@/lib/formatting"
import { isRealCalendarDate } from "@/lib/validation"
import { sydneyMonthKey, sydneyTodayYMD } from "@/lib/dates"
import { getInvoiceSummary, listInvoices } from "@/lib/actions/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { parseInvoiceCursor } from "@/lib/invoice"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { Button } from "@/components/ui/button"
import { InvoiceStatusBadge } from "@/components/accounting/InvoiceStatusBadge"
import { EmptyState } from "@/components/shared/EmptyState"
import { FileText } from "lucide-react"

type Props = { searchParams: Promise<{ status?: string; from?: string; to?: string; after?: string; before?: string }> }

const STATUSES = Object.values(InvoiceStatus)
const money = (cents: number) => fmtAUD(centsToNumber(cents))

/** First and last day (YYYY-MM-DD) of the current Sydney month. */
function currentMonthRange(): { from: string; to: string } {
  const key = sydneyMonthKey()
  const [y, m] = key.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, "0")}` }
}

/** One stat tile above the invoice table. */
function Stat({ label, value, note }: Readonly<{ label: string; value: string; note?: string }>) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Previous/Next links for the cursor-paginated list; the validated filters ride along on every link. */
function Pager({ filters, prevCursor, nextCursor }: Readonly<{ filters: Record<string, string | undefined>; prevCursor: string | null; nextCursor: string | null }>) {
  if (!prevCursor && !nextCursor) return null
  /** Link to the page reached by `dir` from `cursor`, keeping the active filters. */
  const href = (dir: "after" | "before", cursor: string) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
    params.set(dir, cursor)
    return `/accounting/invoices?${params.toString()}`
  }
  return (
    <nav aria-label="Invoice pages" className="flex items-center justify-end gap-1 print:hidden">
      {prevCursor ? (
        <Button variant="outline" size="sm" asChild><Link href={href("before", prevCursor)} rel="prev">Previous</Link></Button>
      ) : (
        <Button variant="outline" size="sm" disabled>Previous</Button>
      )}
      {nextCursor ? (
        <Button variant="outline" size="sm" asChild><Link href={href("after", nextCursor)} rel="next">Next</Link></Button>
      ) : (
        <Button variant="outline" size="sm" disabled>Next</Button>
      )}
    </nav>
  )
}

/**
 * Empty invoice list, picking the right way out: back to page one (a stale
 * cursor page), Clear filters (filters hid everything) or, on a first run,
 * New invoice for roles that can create one.
 */
function InvoicesEmptyState({
  onCursorPage,
  isFiltered,
  firstPageHref,
  canManage,
}: Readonly<{ onCursorPage: boolean; isFiltered: boolean; firstPageHref: string; canManage: boolean }>) {
  if (onCursorPage) {
    return (
      <EmptyState
        icon={FileText}
        title="No invoices on this page"
        description="They may have been deleted or changed status since this link was made."
        actions={[{ label: "Back to the first page", href: firstPageHref, variant: "outline" }]}
      />
    )
  }
  if (isFiltered) {
    return (
      <EmptyState
        icon={FileText}
        title="No invoices match your filters"
        description="Try another status or date range."
        actions={[{ label: "Clear filters", href: "/accounting/invoices", variant: "outline" }]}
      />
    )
  }
  return (
    <EmptyState
      icon={FileText}
      title="No invoices yet"
      description="Invoice outside groups for hall hire, venue fees and the like."
      actions={canManage ? [{ label: "New invoice", href: "/accounting/invoices/new" }] : []}
    />
  )
}

/** Invoice list with status/date filters, 50 per page via keyset cursors. */
export default async function InvoicesPage(props: Readonly<Props>) {
  const sp = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")
  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "Invoice", undefined, { report: "invoices" })

  const status = STATUSES.find((s) => s === sp.status)
  const from = sp.from && isRealCalendarDate(sp.from) ? sp.from : undefined
  const to = sp.to && isRealCalendarDate(sp.to) ? sp.to : undefined
  // Strictly validated; a malformed cursor is dropped so the list falls back to the first page.
  const after = parseInvoiceCursor(sp.after) ? sp.after : undefined
  const before = sp.after ? undefined : parseInvoiceCursor(sp.before) ? sp.before : undefined
  const month = currentMonthRange()
  // Paid / GST figures use the date filters as the payment period when both are set, else this month.
  const period = from && to && from <= to ? { from, to } : month
  const [result, summary, { gstRegistered }] = await Promise.all([listInvoices({ status, from, to, after, before }), getInvoiceSummary(period), getInvoiceSettings()])
  if ("error" in result || "error" in summary) redirect("/")
  const { rows, nextCursor, prevCursor } = result
  // Dead-end escape: a cursor page can be empty if rows were deleted or changed status since the link was made.
  const firstPageParams = new URLSearchParams()
  for (const [k, v] of Object.entries({ status, from, to })) if (v) firstPageParams.set(k, v)
  const firstPageQs = firstPageParams.toString()
  const firstPageHref = firstPageQs ? `/accounting/invoices?${firstPageQs}` : "/accounting/invoices"
  const periodLabel = `${period.from} to ${period.to}`
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Outstanding" value={money(summary.outstandingCents)} note={`${summary.outstandingCount} sent, unpaid`} />
        <Stat label="Paid" value={money(summary.paidCents)} note={`${summary.paidCount} paid ${periodLabel}`} />
        {gstRegistered && <Stat label="GST collected" value={money(summary.gstCollectedCents)} note={`On invoices paid ${periodLabel}`} />}
      </div>

      {rows.length === 0 ? (
        <InvoicesEmptyState
          onCursorPage={Boolean(after || before)}
          isFiltered={Boolean(status || from || to)}
          firstPageHref={firstPageHref}
          canManage={canManage}
        />
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
              {rows.map((r) => {
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
      <Pager filters={{ status, from, to }} prevCursor={prevCursor} nextCursor={nextCursor} />
    </div>
  )
}
