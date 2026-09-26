import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting, canViewPeople } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { getGivingSummary, generateGivingSummaryCsv } from "@/lib/givingSummary"
import { currentFYYear } from "@/lib/fiscalYear"
import { sydneyTodayYMD } from "@/lib/dates"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Read-only accounting roles (ADMIN|PASTOR|AUDITOR|OFFICE_ADMIN) — matches
  // the report page guard; exporting a read-only report shouldn't require
  // mutation permission.
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Each call decrypts one email per giving family; cap per-user volume.
  if (!rateLimit(`export:giving-summary:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const parsed = Number.parseInt(req.nextUrl.searchParams.get("year") ?? String(currentFYYear()), 10)
  const year = parsed >= 2000 && parsed <= 2100 ? parsed : currentFYYear()

  // Primary email is member PII — AUDITOR is accounting-only and must not
  // see it decrypted, on-screen or in the export.
  const showEmail = canViewPeople(session.user.role)
  const rows = await getGivingSummary(year, showEmail)
  const csv = generateGivingSummaryCsv(rows, showEmail)

  const ip = getClientIp(req)
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
