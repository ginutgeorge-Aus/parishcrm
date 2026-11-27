import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewPeople } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { guardAccountingExport, fyYearParamOr400 } from "@/lib/reports/exportGuard"
import { getGivingSummary, generateGivingSummaryCsv } from "@/lib/givingSummary"
import { sydneyTodayYMD } from "@/lib/dates"
import { featureNotFound } from "@/lib/featureFlags"

/** GET /api/accounting/reports/giving-summary/export-csv. Accounting viewers only. */
export async function GET(req: NextRequest) {
  // Read-only accounting roles (ADMIN|PASTOR|AUDITOR|OFFICE_ADMIN) — matches the report page
  // guard; also rate-limits per actor because each call decrypts one email per giving family.
  const guard = await guardAccountingExport("giving-summary")
  if (guard instanceof NextResponse) return guard
  const off = await featureNotFound("accounting")
  if (off) return off

  // A malformed ?year= is a 400, not a silent fall-back to the current FY (AUD-2-10).
  const year = fyYearParamOr400(req.nextUrl.searchParams)
  if (year instanceof NextResponse) return year

  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Primary email is member PII — AUDITOR is accounting-only and must not
  // see it decrypted, on-screen or in the export.
  const showEmail = canViewPeople(session.user.role)
  const rows = await getGivingSummary(year, showEmail)
  const csv = generateGivingSummaryCsv(rows, showEmail)

  const ip = auditIpFromRequest(req)
  await logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "Transaction", undefined, {
    report: "giving-summary",
    year,
    rowCount: rows.length,
  }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="giving-summary-fy${year}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
