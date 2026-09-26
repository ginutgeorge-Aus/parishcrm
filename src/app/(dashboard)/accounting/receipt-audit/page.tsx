import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { safeDecrypt } from "@/lib/crypto"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatSydneyDateTime, sydneyToday, endOfDayUTC } from "@/lib/dates"
import { currentFYYear } from "@/lib/fiscalYear"
import { fmtAUD } from "@/lib/formatting"

const PAGE_SIZE = 50

type Props = {
  searchParams: Promise<{ from?: string; to?: string; status?: string; page?: string }>
}

export default async function ReceiptAuditPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  // Log every access to this donor-PII page (decrypted sentTo emails), not just
  // AUDITOR reads — ADMIN/PASTOR access must leave an audit trail too.
  void logAudit(actorId(session), "VIEW_RECEIPT_AUDIT_LOG", "ReceiptSend", undefined, {
    role: session?.user?.role,
  })

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  const fyYear = currentFYYear()
  const defaultFrom = new Date(`${fyYear}-07-01`)

  // ISO_DATE only checks shape — `2025-13-01`/`2025-00-10` pass the regex but
  // `new Date` yields Invalid Date, which crashes `format` (RangeError) and the
  // Prisma query. Reject NaN dates and fall back to the default.
  // Impossible dates like `2025-02-30` round-trip: `new Date` rolls them into
  // March, shifting the audit window, filters, pagination and lookup URLs
  //. Compare parsed UTC year/month/day against the input components and
  // return null on any mismatch so the default-period fallback applies.
  const parseISODate = (value: string | undefined): Date | null => {
    if (!value || !ISO_DATE.test(value)) return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    const [y, m, day] = value.split("-").map(Number)
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== day) return null
    return d
  }
  const fromParsed = parseISODate(searchParams.from)
  const fromDate = fromParsed ?? defaultFrom
  // End-of-day UTC so `lte` covers sends stamped anywhere on the selected 'To'
  // date — a bare UTC-midnight bound would exclude every send that day.
  const toParsed = parseISODate(searchParams.to)
  const toDate = toParsed ? endOfDayUTC(toParsed) : endOfDayUTC(sydneyToday())

  const statusFilter = searchParams.status === "SUCCESS" || searchParams.status === "FAILED"
    ? searchParams.status
    : undefined

  const rawPage = Number.parseInt(searchParams.page ?? "1", 10)
  const MAX_PAGE = 10000
  // parseInt accepts oversized decimal strings and can yield Infinity (or
  // lossy large ints), which flows into `skip` and crashes Prisma's integer
  // pagination argument. Require a finite, safe integer and clamp to a sane
  // maximum so `skip` stays a safe finite integer.
  let page = Number.isSafeInteger(rawPage) && rawPage > 0
    ? Math.min(rawPage, MAX_PAGE)
    : 1
  const skip = (page - 1) * PAGE_SIZE

  const where = {
    sentAt: { gte: fromDate, lte: toDate },
    ...(statusFilter ? { status: statusFilter } : {}),
  }

  const [sendsRaw, totalCount] = await Promise.all([
    prisma.receiptSend.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      skip,
      include: {
        transaction: { select: { id: true, description: true, amount: true, account: { select: { code: true, name: true } } } },
        sentBy: { select: { name: true } },
      },
    }),
    prisma.receiptSend.count({ where }),
  ])

  const sends = sendsRaw.map((s) => ({
    ...s,
    sentTo: safeDecrypt(s.sentTo),
    transaction: {
      ...s.transaction,
      description: safeDecrypt(s.transaction.description),
    },
  }))

  const fromStr = fromDate.toISOString().slice(0, 10)
  const toStr = toDate.toISOString().slice(0, 10)
  const statusStr = searchParams.status ?? "ALL"
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  // The query already ran with a safe bounded `skip`; re-clamp `page` so the
  // UI doesn't advertise or navigate beyond the available page count.
  page = Math.min(page, totalPages)

  function pageUrl(p: number) {
    const params = new URLSearchParams({ from: fromStr, to: toStr })
    if (statusStr !== "ALL") params.set("status", statusStr)
    if (p > 1) params.set("page", String(p))
    return `?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-foreground">Receipt Audit Log</h2>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
        <div>
          <Label htmlFor="filter-from" className="text-xs text-muted-foreground mb-1">From</Label>
          <Input type="date" id="filter-from" name="from" defaultValue={fromStr} className="min-h-11 w-auto" />
        </div>
        <div>
          <Label htmlFor="filter-to" className="text-xs text-muted-foreground mb-1">To</Label>
          <Input type="date" id="filter-to" name="to" defaultValue={toStr} className="min-h-11 w-auto" />
        </div>
        <div>
          <Label htmlFor="filter-status" className="text-xs text-muted-foreground mb-1">Status</Label>
          <Select name="status" defaultValue={statusStr}>
            <SelectTrigger id="filter-status" className="w-32 min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="SUCCESS">Success</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="min-h-11">
          Filter
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {totalCount.toLocaleString()} record{totalCount !== 1 ? "s" : ""}
        {totalPages > 1 && ` — page ${page} of ${totalPages}`}
      </p>

      {sends.length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipt sends found for this period.</p>
      ) : (
        <>
        {/* Mobile: card per send (avoids sideways scroll on PII-dense table) */}
        <ul className="space-y-2 md:hidden">
          {sends.map((s) => (
            <li key={s.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/accounting/transactions/${s.transaction.id}`}
                  className="min-w-0 font-medium text-primary hover:underline"
                >
                  {s.transaction.description}
                </Link>
                <span className="shrink-0 tabular font-semibold whitespace-nowrap">
                  {fmtAUD(Number(s.transaction.amount))}
                </span>
              </div>
              <p className="mt-0.5 break-all text-xs text-muted-foreground">{s.sentTo}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {s.transaction.account.code} — {s.transaction.account.name}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatSydneyDateTime(s.sentAt)} · {s.sentBy.name}
                </span>
                <Badge variant={s.status === "SUCCESS" ? "default" : "destructive"}>
                  {s.status}
                </Badge>
              </div>
              {s.errorMessage && (
                <p className="mt-1 text-xs text-destructive">{s.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>

        {/* Desktop: full table */}
        <div className="hidden bg-card border border-border rounded-lg overflow-x-auto md:block">
          <table className="w-full min-w-table-wide text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                {["Sent At", "Sent To", "Transaction", "Amount", "Account", "Sent By", "Status", "Error"].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sends.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {formatSydneyDateTime(s.sentAt)}
                  </td>
                  <td className="px-4 py-2">{s.sentTo}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/accounting/transactions/${s.transaction.id}`}
                      className="hover:underline text-primary"
                    >
                      {s.transaction.description}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-medium">
                    {fmtAUD(Number(s.transaction.amount))}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {s.transaction.account.code} — {s.transaction.account.name}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{s.sentBy.name}</td>
                  <td className="px-4 py-2">
                    <Badge variant={s.status === "SUCCESS" ? "default" : "destructive"}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-destructive">{s.errorMessage ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-3">
          {page > 1 ? (
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href={pageUrl(page - 1)}>← Previous</Link>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">← Previous</span>
          )}
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href={pageUrl(page + 1)}>Next →</Link>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Next →</span>
          )}
        </div>
      )}
    </div>
  )
}
