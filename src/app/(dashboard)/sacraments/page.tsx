import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEditSacraments, canViewSacraments } from "@/lib/roleGuard"
import { SacramentType } from "@/lib/generated/prisma/enums"
import { SACRAMENT_LABEL, formatLongYmd } from "@/lib/sacraments"
import { utcYmd } from "@/lib/dates"
import { ScrollText } from "lucide-react"
import { EmptyState } from "@/components/shared/EmptyState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Props = { searchParams: Promise<{ type?: string; year?: string; page?: string }> }

/** Rows per register page. */
const PAGE_SIZE = 100

/**
 * Parse the `?page=` param: a positive safe integer, else 1.
 * @param raw query-string value
 */
function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 1
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

/**
 * Parse the `?year=` filter: a 4-digit year in range, else null (all years).
 * @param raw query-string value
 */
function parseYear(raw: string | undefined): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1800 && n <= 2100 ? n : null // 1800: oldest year the register accepts (sacraments.ts)
}

/** Sacramental register: every entry, filterable by rite and year. ADMIN | PASTOR | OFFICE_ADMIN (read-only). */
export default async function SacramentsPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewSacraments(session.user.role)) redirect("/")
  const editor = canEditSacraments(session.user.role)
  const sp = await props.searchParams
  const type = Object.values(SacramentType).find((t) => t === sp.type) ?? null
  const year = parseYear(sp.year)

  const where = { ...(type ? { type } : {}), ...(year ? { year } : {}) }
  const total = await prisma.sacramentRecord.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(parsePage(sp.page), totalPages)
  const shown = await prisma.sacramentRecord.findMany({
    where,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      type: true,
      registerNo: true,
      date: true,
      place: true,
      person: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  const filtered = Boolean(type || year)

  /**
   * Build a register URL for a page, carrying the active type and year filters.
   * @param p target page number
   */
  const pageHref = (p: number): string => {
    const params = new URLSearchParams()
    if (type) params.set("type", type)
    if (year) params.set("year", String(year))
    if (p > 1) params.set("page", String(p))
    const qs = params.toString()
    return qs ? `/sacraments?${qs}` : "/sacraments"
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Sacramental register</h2>
        {editor && !(shown.length === 0 && !filtered) && (
          <Button asChild>
            <Link href="/sacraments/new">Add entry</Link>
          </Button>
        )}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="type">Sacrament</Label>
          <select id="type" name="type" defaultValue={type ?? ""} className={SELECT_CLASS}>
            <option value="">All</option>
            {Object.values(SacramentType).map((t) => (
              <option key={t} value={t}>{SACRAMENT_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="year">Year</Label>
          <Input id="year" name="year" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="All" defaultValue={year ?? ""} className="w-28" />
        </div>
        <Button type="submit" variant="outline">Filter</Button>
        {(type || year) && (
          <Button variant="ghost" asChild>
            <Link href="/sacraments">Clear</Link>
          </Button>
        )}
      </form>

      {shown.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? "No entries match these filters" : "No entries in the register yet"}
          description={filtered ? "Try a different sacrament or year." : "Entries you add will appear here."}
          actions={
            filtered
              ? [{ label: "Clear filters", href: "/sacraments" }]
              : editor
                ? [{ label: "Add entry", href: "/sacraments/new" }]
                : []
          }
        />
      ) : (
        <>
          <Table aria-label="Sacramental register">
            <TableHeader>
              <TableRow>
                <TableHead>Register no.</TableHead>
                <TableHead>Sacrament</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="hidden sm:table-cell">Place</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/sacraments/${r.id}`} className="font-medium hover:underline">{r.registerNo}</Link>
                  </TableCell>
                  <TableCell>{SACRAMENT_LABEL[r.type]}</TableCell>
                  <TableCell>
                    <Link href={`/people/${r.person.id}`} className="hover:underline">
                      {r.person.firstName} {r.person.lastName}
                    </Link>
                  </TableCell>
                  <TableCell>{formatLongYmd(utcYmd(r.date))}</TableCell>
                  <TableCell className="hidden sm:table-cell">{r.place}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <nav aria-label="Register pages" className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              {page > 1 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(page - 1)}>Previous</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>Previous</Button>
              )}
              <span>Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(page + 1)}>Next</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>Next</Button>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
