import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getChurchSettingsStrict } from "@/lib/churchSettings"
import { renderGivingStatementPdf } from "@/lib/pdf/GivingStatementPdf"
import { buildStatementModel, parseStatementYear } from "@/lib/givingStatement"
import { loadStatements, loadStatementFamilies } from "@/lib/givingStatementData"
import { parseRouteId } from "@/lib/validation"
import { featureNotFound } from "@/lib/featureFlags"

/** GET /accounting/giving-statements/[familyId]/pdf?year=YYYY. Accounting viewers only. */
export async function GET(req: NextRequest, props: { params: Promise<{ familyId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const off = await featureNotFound("receipts")
  if (off) return off

  const familyId = parseRouteId(params.familyId)
  if (familyId === null) return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  const year = parseStatementYear(req.nextUrl.searchParams.get("year"))
  if (year === null) return NextResponse.json({ error: "Invalid year" }, { status: 400 })

  const [statements, families] = await Promise.all([loadStatements(year, [familyId]), loadStatementFamilies([familyId])])
  const statement = statements.get(familyId)
  const family = families.get(familyId)
  if (!statement || !family) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const church = await getChurchSettingsStrict()
  const pdf = await renderGivingStatementPdf(buildStatementModel(statement, family.name, year, church))

  void logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "Family", familyId, {
    report: "giving-statement",
    fyStartYear: year,
  })

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="giving-statement-${familyId}-${year}.pdf"`,
    },
  })
}
