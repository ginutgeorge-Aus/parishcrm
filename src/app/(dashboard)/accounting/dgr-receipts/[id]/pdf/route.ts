import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { buildDgrPdfModel, type DgrLine } from "@/lib/dgr"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import { getChurchSettingsStrict } from "@/lib/churchSettings"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { parseRouteId } from "@/lib/validation"

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const id = parseRouteId(params.id)
  if (id === null) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  }

  const row = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const church = await getChurchSettingsStrict()
  const receipt = await getReceiptSettings()
  const model = buildDgrPdfModel(
    {
      receiptNo: row.receiptNo,
      fyEndYear: row.fyEndYear,
      issueDate: row.createdAt,
      donorName: row.donorName,
      lines: row.lines as DgrLine[],
    },
    church,
    receipt
  )
  const pdf = await renderDgrReceiptPdf(model)

  void logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "DgrReceipt", id, {
    report: "dgr-receipt",
    receiptNo: row.receiptNo,
  })

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // inline → the browser previews the PDF in a new tab instead of downloading it.
      "Content-Disposition": `inline; filename="${row.receiptNo}.pdf"`,
    },
  })
}
