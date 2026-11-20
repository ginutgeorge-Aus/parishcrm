import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEditSacraments, canViewSacraments } from "@/lib/roleGuard"
import { SacramentType } from "@/lib/generated/prisma/enums"
import { SACRAMENT_LABEL, formatLongYmd } from "@/lib/sacraments"
import { utcYmd } from "@/lib/dates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Props = { searchParams: Promise<{ type?: string; year?: string; page?: string }> }

/** Rows per page; Previous/Next links appear when the register is longer. */
const PAGE_SIZE = 500

/**
 * Parse the `?page=` value: a positive integer, else 1.
 * @param raw query-string value
 */
function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d{1,6}$/.test(raw)) return 1
  return Math.max(1, Number(raw))
}

/**
 * Build a register URL that keeps the active filters.
 * @param type rite filter, or null
 * @param year year filter, or null
 * @param page page number (omitted for page 1)
 */
function pageHref(type: string | null, year: number | null, page: number): string {
  const qs = new URLSearchParams()
  if (type) qs.set("type", type)
  if (year) qs.set("year", String(year))
  if (page > 1) qs.set("page", String(page))
  const s = qs.toString()
  return s ? `/sacraments?${s}` : "/sacraments"
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
  const page = parsePage(sp.page)

  const rows = await prisma.sacramentRecord.findMany({
    where: { ...(type ? { type } : {}), ...(year ? { year } : {}) },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      type: true,
      registerNo: true,
      date: true,
      place: true,
      person: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  const hasNext = rows.length > PAGE_SIZE
  const shown = hasNext ? rows.slice(0, PAGE_SIZE) : rows

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Sacramental register</h2>
        {editor && (
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
        <p className="text-sm text-muted-foreground">
          {type || year ? "No entries match these filters." : "No entries in the register yet."}
        </p>
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
          {(page > 1 || hasNext) && (
            <nav aria-label="Register pages" className="flex items-center gap-3 text-sm text-muted-foreground">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(type, year, page - 1)}>Previous</Link>
                </Button>
              )}
              <span>Page {page}</span>
              {hasNext && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(type, year, page + 1)}>Next</Link>
                </Button>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
