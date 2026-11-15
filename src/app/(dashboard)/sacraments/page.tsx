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

type Props = { searchParams: Promise<{ type?: string; year?: string }> }

/** Most rows one page shows; a notice appears when the register is longer. */
const LIST_CAP = 500

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

  const rows = await prisma.sacramentRecord.findMany({
    where: { ...(type ? { type } : {}), ...(year ? { year } : {}) },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: LIST_CAP + 1,
    select: {
      id: true,
      type: true,
      registerNo: true,
      date: true,
      place: true,
      person: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  const capped = rows.length > LIST_CAP
  const shown = capped ? rows.slice(0, LIST_CAP) : rows

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
          {capped && (
            <p className="text-sm text-muted-foreground">
              Showing the latest {LIST_CAP} entries. Filter by sacrament or year to narrow the list.
            </p>
          )}
        </>
      )}
    </div>
  )
}
