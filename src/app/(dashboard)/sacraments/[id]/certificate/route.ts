import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewSacraments } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getSacramentRecord } from "@/lib/actions/sacrament"
import { renderSacramentCertificatePdf } from "@/lib/pdf/SacramentCertificatePdf"
import { getChurchSettings } from "@/lib/churchSettings"
import { parseRouteId } from "@/lib/validation"

/**
 * GET /sacraments/[id]/certificate. ADMIN | PASTOR | OFFICE_ADMIN only (#609).
 * Streams the certificate PDF inline and writes an audit row (ids only, no PII).
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewSacraments(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const id = parseRouteId(params.id)
  if (id === null) return NextResponse.json({ error: "Invalid ID" }, { status: 400 })

  const record = await getSacramentRecord(id)
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const church = await getChurchSettings()
  const pdf = await renderSacramentCertificatePdf(record, { name: church.name, address: church.address })

  void logAudit(actorId(session), "SACRAMENT_CERTIFICATE_PRINTED", "SacramentRecord", id, {
    registerNo: record.registerNo,
    type: record.type,
    personId: record.person.id,
  })

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // inline: the browser previews the PDF in a new tab instead of downloading it.
      "Content-Disposition": `inline; filename="${record.registerNo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
}
