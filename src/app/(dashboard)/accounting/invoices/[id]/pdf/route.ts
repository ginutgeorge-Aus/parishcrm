import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canViewAccounting } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"
import { UserRole } from "@/lib/generated/prisma/enums"

/** Download an invoice PDF. Accounting viewers except AUDITOR (the PDF carries recipient contact details). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = session.user.role
  if (!canViewAccounting(role) || role === UserRole.AUDITOR) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const id = parseRouteId(params.id)
  if (id === null) return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
  const out = await loadInvoicePdf(id)
  if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await logAudit(actorId(session), "INVOICE_PDF_DOWNLOADED", "Invoice", id, { invoiceNo: out.invoiceNo })
  return new NextResponse(out.pdf as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
  })
}
