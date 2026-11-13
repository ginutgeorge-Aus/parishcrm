import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { featureNotFound } from "@/lib/featureFlags"
import { formatSydneyDate } from "@/lib/dates"
import { getChurchSettings } from "@/lib/churchSettings"
import { buildReport, parseReportOptions } from "@/lib/sundaySchoolReport"
import { loadReportInput } from "@/lib/sundaySchoolReportData"
import { buildXlsx } from "@/lib/xlsx"
import { renderSundaySchoolReportPdf } from "@/lib/pdf/SundaySchoolReportPdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Filename-safe slug of a class name ("Years 1–2" → "years-1-2"). */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "class"
}

/**
 * GET /sunday-school/reports/export?format=xlsx|pdf&year=&class=&applied=1&col=…
 * Downloads the Sunday School report (same options as the reports page).
 * canBrowseSundaySchool only (lives under /sunday-school so HEADMASTER's
 * middleware confinement admits it); rate-limited and audited (no names logged).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canBrowseSundaySchool(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const off = await featureNotFound("sundaySchool")
  if (off) return off

  const sp = req.nextUrl.searchParams
  const format = sp.get("format")
  if (format !== "xlsx" && format !== "pdf") return NextResponse.json({ error: "Invalid format" }, { status: 400 })
  if (!rateLimit(`export:sunday-school:${actorId(session)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // A malformed year/class must not silently fall back to another report (same rule as fyYearParamOr400).
  const opts = parseReportOptions(sp)
  const rawYear = sp.get("year")
  const rawClass = sp.get("class")
  if ((rawYear !== null && String(opts.year) !== rawYear) || (rawClass && opts.classId === null)) {
    return NextResponse.json({ error: "Invalid year or class" }, { status: 400 })
  }
  const input = await loadReportInput(opts.year, opts.classId)
  if (opts.classId !== null && input.classes.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const table = buildReport(input, opts, formatSydneyDate(new Date()))

  const name = `sunday-school-${opts.classId === null ? "all-classes" : slug(input.classes[0].name)}-${opts.year}.${format}`
  const body = format === "xlsx"
    ? buildXlsx(`Sunday School ${opts.year}`, [table.headers, ...table.rows])
    : await renderSundaySchoolReportPdf(table, (await getChurchSettings()).name)

  await logAudit(actorId(session), "SUNDAY_SCHOOL_REPORT_EXPORTED", "SundaySchoolClass", opts.classId ?? undefined, {
    year: opts.year, format, columns: opts.columns, rowCount: table.rows.length,
  }, auditIpFromRequest(req))

  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      "Content-Type": format === "xlsx" ? XLSX_TYPE : "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      // Children's names and marks: never cache in the browser or a proxy.
      "Cache-Control": "no-store",
    },
  })
}
