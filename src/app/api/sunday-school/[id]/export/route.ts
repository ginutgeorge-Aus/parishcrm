import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { featureNotFound } from "@/lib/featureFlags"
import { getChurchSettings } from "@/lib/churchSettings"
import { parseRouteId } from "@/lib/validation"
import { formatDMY } from "@/lib/formatting"
import { renderSundaySchoolReportPdf } from "@/lib/pdf/SundaySchoolReportPdf"
import { classYear, loadReportInput } from "@/lib/sundaySchoolReportsLoad"
import { REPORT_KINDS, buildReport, parseYmd, reportToCsv, slugify, validRange, type ReportKind } from "@/lib/sundaySchoolReports"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
const RANGE_ERROR = "Date range must end on or after its start and be at most 2 years"

/**
 * Class report download (CSV or PDF): `?report=summary|history|exams&format=csv|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD`.
 * Same access as the progress pages (canBrowseSundaySchool). A missing bound defaults to the
 * class's school year; to before from, or over 2 years, is a 400. Child names and counts only. CSV
 * cells go through `escapeCsv` (formula-injection guard). Rate-limited, audited, never cached.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canBrowseSundaySchool(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const off = await featureNotFound("sundaySchool")
  if (off) return off
  const id = parseRouteId((await ctx.params).id)
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const q = req.nextUrl.searchParams
  const kind = (q.get("report") ?? "summary") as ReportKind
  if (!REPORT_KINDS.includes(kind)) return bad("Unknown report")
  const format = q.get("format") ?? "csv"
  if (format !== "csv" && format !== "pdf") return bad("Unknown format")
  const fromRaw = q.get("from")
  const toRaw = q.get("to")
  const from = fromRaw ? parseYmd(fromRaw) : null
  const to = toRaw ? parseYmd(toRaw) : null
  if ((fromRaw && !from) || (toRaw && !to)) return bad("Dates must be YYYY-MM-DD")
  if (from && to && !validRange(from, to)) return bad(RANGE_ERROR)

  if (!rateLimit(`export:sunday-school:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const year = await classYear(id)
  if (year === null) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const start = from ?? new Date(Date.UTC(year, 0, 1))
  const end = to ?? new Date(Date.UTC(year, 11, 31))
  if (!validRange(start, end)) return bad(RANGE_ERROR)
  const input = await loadReportInput(id, start, end)
  if (!input) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const table = buildReport(kind, input)
  const fromYmd = start.toISOString().slice(0, 10)
  const toYmd = end.toISOString().slice(0, 10)
  await logAudit(actorId(session), "SUNDAY_SCHOOL_REPORT_EXPORTED", "SundaySchoolClass", id, { report: kind, format, from: fromYmd, to: toYmd, rowCount: table.rows.length }, auditIpFromRequest(req))

  const filename = `sunday-school-${slugify(input.className)}-${kind}-${fromYmd}-to-${toYmd}.${format}`
  const headers = { "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" }
  if (format === "pdf") {
    const church = await getChurchSettings()
    const pdf = await renderSundaySchoolReportPdf(table, church.name, `${formatDMY(start)} to ${formatDMY(end)}`)
    return new NextResponse(pdf as unknown as BodyInit, { headers: { ...headers, "Content-Type": "application/pdf" } })
  }
  return new NextResponse(reportToCsv(table), { headers: { ...headers, "Content-Type": "text/csv" } })
}
