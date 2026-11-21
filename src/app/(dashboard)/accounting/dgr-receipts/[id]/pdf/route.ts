import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { buildDgrPdfModel, parseIssuerSnapshot, DGR_STATUS, type DgrLine } from "@/lib/dgr"
import { decryptBytes } from "@/lib/crypto"
import { logger } from "@/lib/logger"
import { sydneyToday } from "@/lib/dates"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"
import { getChurchSettingsStrict } from "@/lib/churchSettings"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { parseRouteId } from "@/lib/validation"
import { featureNotFound } from "@/lib/featureFlags"

/** GET /accounting/dgr-receipts/[id]/pdf. Accounting viewers only. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const off = await featureNotFound("dgrReceipts")
  if (off) return off

  const id = parseRouteId(params.id)
  if (id === null) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  }

  const row = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const isSent = row.status === DGR_STATUS.SENT
  let pdf: Uint8Array | null = null
  // A sent receipt serves the exact bytes the donor was emailed, so later edits to the
  // ABN, legal wording or letterhead never change the office copy.
  if (isSent && row.frozenPdf) {
    try {
      pdf = decryptBytes(row.frozenPdf)
    } catch (e) {
      logger.error("dgr frozenPdf unreadable, rendering from snapshot", { id, message: e instanceof Error ? e.message : "unknown" })
    }
  }
  if (!pdf) {
    const church = await getChurchSettingsStrict()
    const receipt = await getReceiptSettings()
    const snapshot = isSent ? parseIssuerSnapshot(row.issuer) : null
    const model = buildDgrPdfModel(
      {
        receiptNo: row.receiptNo,
        fyEndYear: row.fyEndYear,
        // Legacy SENT rows (no snapshot) keep createdAt, what the donor's copy showed. Unsent
        // previews show today's Sydney date, which is the date the receipt would be issued.
        issueDate: isSent ? row.createdAt : sydneyToday(),
        donorName: row.donorName,
        lines: row.lines as DgrLine[],
      },
      church,
      receipt
    )
    pdf = await renderDgrReceiptPdf(snapshot ? { ...model, ...snapshot } : model)
  }

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
