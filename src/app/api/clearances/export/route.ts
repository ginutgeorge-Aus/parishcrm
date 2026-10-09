import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canManageClearances } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { escapeCsv } from "@/lib/csvUtils"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
import { loadComplianceRows, filterRows, capRows, type ComplianceCell } from "@/lib/clearanceCompliance"
import { CLEARANCE_STATUS_LABELS, dmy, parseComplianceFilter } from "@/lib/clearanceComplianceView"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HEADERS = [
  "Family name", "Given name", "Ministry roles",
  "WWCC status", "WWCC expires", "WWCC verified",
  "Safe Ministry status", "Safe Ministry expires", "Safe Ministry verified",
]

/** Three CSV cells (status label, expiry, verified date) for one clearance type. */
function cells(c: ComplianceCell): string[] {
  return [c.status ? CLEARANCE_STATUS_LABELS[c.status] : "", dmy(c.expiresAt) ?? "", dmy(c.verifiedAt) ?? ""]
}

/**
 * Compliance CSV for ADMIN / PASTOR / OFFICE_ADMIN. Names, roles, statuses and
 * dates only: never the WWC number or date of birth. Every cell goes through
 * `escapeCsv` (formula-injection guard). Optional `?status=` mirrors the page.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canManageClearances(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!rateLimit(`export:clearances:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const filter = parseComplianceFilter(req.nextUrl.searchParams.get("status"))
  const now = new Date()
  const { rows: all } = await loadComplianceRows(sydneyToday(now))
  const { rows, truncated } = capRows(filterRows(all, filter))

  const csv = [
    HEADERS,
    ...rows.map((r) => [
      r.lastName, r.firstName, r.ministryRoles.map((m) => MINISTRY_ROLE_LABELS[m]).join("; "),
      ...cells(r.wwcc), ...cells(r.safeMinistry),
    ]),
  ].map((line) => line.map(escapeCsv).join(",")).join("\n")

  await logAudit(actorId(session), "CLEARANCE_EXPORTED", "Person", undefined, { rowCount: rows.length, filter }, getClientIp(req))

  const headers: Record<string, string> = {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="clearance-compliance-${sydneyTodayYMD(now)}.csv"`,
    "Cache-Control": "no-store",
  }
  if (truncated) headers["X-Export-Truncated"] = "true"
  return new NextResponse(csv, { headers })
}
