import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { formatSydneyDate } from "@/lib/dates"
import {
  REPORT_COLUMNS,
  REPORT_COLUMN_LABELS,
  buildReport,
  classLabel,
  formatCell,
  parseReportOptions,
  reportQuery,
} from "@/lib/sundaySchoolReport"
import { loadReportInput } from "@/lib/sundaySchoolReportData"
import { MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { Button } from "@/components/ui/button"

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** A Next.js searchParams record as URLSearchParams (repeated keys kept). */
function toSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, item)
  }
  return q
}

const field = "h-11 rounded-md border border-input bg-background px-3 text-sm sm:h-9"

/**
 * Sunday School report builder: pick a year, a class (or all) and column
 * groups, preview the table, then download it as Excel or PDF from
 * /sunday-school/reports/export. canBrowseSundaySchool (VIEWER, HEADMASTER, editors).
 * A plain GET form, so the options live in the URL and need no client code.
 */
export default async function SundaySchoolReportsPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const picked = parseReportOptions(toSearchParams(await props.searchParams))

  const classes = await prisma.sundaySchoolClass.findMany({
    where: { year: picked.year, archivedAt: null },
    orderBy: [{ location: "asc" }, { level: "asc" }, { name: "asc" }],
    select: { id: true, name: true, location: true },
  })
  // A class from another year (year changed in the form) falls back to all classes.
  const opts = { ...picked, classId: classes.some((c) => c.id === picked.classId) ? picked.classId : null }
  const table = buildReport(await loadReportInput(opts.year, opts.classId), opts, formatSydneyDate(new Date()))
  const exportHref = (format: "xlsx" | "pdf") => `/sunday-school/reports/export?${reportQuery(opts)}&format=${format}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Sunday School reports</h2>
        <Link href={`/sunday-school?year=${opts.year}`} className="text-sm text-muted-foreground underline hover:text-foreground min-h-11 inline-flex items-center sm:min-h-0">
          ← Classes
        </Link>
      </div>

      <form method="get" className="space-y-3 rounded-xl border border-border p-4">
        <input type="hidden" name="applied" value="1" />
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Year</span>
            <input type="number" name="year" min={MIN_YEAR} max={MAX_YEAR} defaultValue={opts.year} className={`${field} w-28`} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:flex-none">
            <span className="font-medium text-foreground">Class</span>
            {/* Native select: "All classes" is an empty value, which Radix Select can't hold. */}
            <select name="class" defaultValue={opts.classId ?? ""} className={`${field} sm:w-64`}>
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{classLabel(c)}</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-foreground">Columns (child name is always shown)</legend>
          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-4">
            {REPORT_COLUMNS.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                <input type="checkbox" name="col" value={c} defaultChecked={opts.columns.includes(c)} className="size-4" />
                {REPORT_COLUMN_LABELS[c]}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" className="w-full sm:w-auto">Show report</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-foreground">{table.title}</h3>
          <p className="text-sm text-muted-foreground">{table.subtitle}</p>
        </div>
        {table.rows.length > 0 && (
          <div className="flex w-full gap-2 sm:w-auto">
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href={exportHref("xlsx")}>Download Excel</a>
            </Button>
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href={exportHref("pdf")}>Download PDF</a>
            </Button>
          </div>
        )}
      </div>

      {table.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No enrolled children for this selection.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {table.headers.map((h, i) => (
                  <th key={`${i}:${h}`} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium text-foreground ${i === 0 ? "sticky left-0 bg-muted text-left" : "text-center"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={`${r}:${String(row[0])}`} className="border-t border-border">
                  {row.map((cell, i) => (
                    <td key={`${i}:${table.headers[i]}`} className={`whitespace-nowrap px-3 py-2 ${i === 0 ? "sticky left-0 bg-background text-left" : "text-center tabular-nums"}`}>
                      {formatCell(table.headers[i], cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
