import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { AuditLogFilters } from "@/components/settings/AuditLogFilters"
import { buildCreatedAtFilter } from "@/lib/auditLogFilter"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { APP_LOCALE } from "@/lib/appConfig"

const PAGE_SIZE = 50
const MAX_PAGE = 1000

type Props = {
  searchParams: Promise<{ action?: string; from?: string; to?: string; page?: string }>
}

export default async function AuditLogPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")

  const rawPage = parseInt(searchParams.page ?? "1", 10)
  const page = Number.isSafeInteger(rawPage) ? Math.min(Math.max(1, rawPage), MAX_PAGE) : 1

  const createdAtFilter = buildCreatedAtFilter(searchParams.from, searchParams.to)

  // Cap the LIKE pattern length — unbounded `contains` is a scan-cost vector.
  const actionFilter = searchParams.action?.slice(0, 100)
  const where = {
    ...(actionFilter ? { action: { contains: actionFilter } } : {}),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Carry the active filters across pagination — page links that drop them break
  // filtered multi-page navigation.
  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    if (actionFilter) params.set("action", actionFilter)
    if (searchParams.from) params.set("from", searchParams.from)
    if (searchParams.to) params.set("to", searchParams.to)
    params.set("page", String(p))
    return `/settings/audit-log?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-foreground">Audit Log</h2>
      <p className="text-sm text-muted-foreground">
        Security-relevant actions. Read-only. {total} total entries.
      </p>

      <Suspense>
        <AuditLogFilters />
      </Suspense>

      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {log.createdAt.toLocaleString(APP_LOCALE)}
                </TableCell>
                <TableCell>{log.user?.name ?? "System"}</TableCell>
                <TableCell className="font-mono text-xs">{log.action}</TableCell>
                <TableCell>{log.resourceType}</TableCell>
                <TableCell className="text-muted-foreground">{log.resourceId ?? "Not available"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{log.ip ?? "Not available"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {log.metadata ? JSON.stringify(log.metadata) : "Not available"}
                </TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No audit log entries found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden">
        {logs.map((log) => (
          <li key={log.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {log.user?.name ?? "System"} <span className="font-mono text-xs font-normal">{log.action}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {log.createdAt.toLocaleString(APP_LOCALE)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {log.resourceType} · ID {log.resourceId ?? "Not available"} · IP {log.ip ?? "Not available"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {log.metadata ? JSON.stringify(log.metadata) : "Not available"}
            </p>
          </li>
        ))}
        {logs.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No audit log entries found.
          </li>
        )}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={pageHref(page - 1)}>Previous</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}
          <span>Page {page} of {totalPages}</span>
          {page < Math.min(totalPages, MAX_PAGE) ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={pageHref(page + 1)}>Next</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
