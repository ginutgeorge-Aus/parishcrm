"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { isP2002 } from "@/lib/validation"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { formatInvoiceNo } from "@/lib/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { getChurchSettings } from "@/lib/churchSettings"
import { loadInvoicePdf } from "@/lib/invoicePdfModel"
import { buildInvoiceEmail } from "@/lib/invoiceEmail"
import { sendEmail } from "@/lib/email"

const PATH = "/accounting/invoices"
const CHANGED = { error: "This invoice has changed. Reload and try again." }
type Result = { success: string } | { error: string }

/** Revalidate the list and one invoice's detail page. */
function revalidate(id: number) {
  revalidatePath(PATH)
  revalidatePath(`${PATH}/${id}`)
}

/** Allocate INV number if missing (MAX+1, one P2002 retry) and freeze taxInvoice. Returns the number or an error. */
async function allocateAndFreeze(id: number): Promise<{ invoiceNo: string } | { error: string }> {
  const { gstRegistered } = await getInvoiceSettings()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const row = await tx.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true } })
        if (!row || row.status !== InvoiceStatus.DRAFT) return CHANGED
        if (row.invoiceNo) {
          await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT }, data: { taxInvoice: gstRegistered } })
          return { invoiceNo: row.invoiceNo }
        }
        const agg = await tx.invoice.aggregate({ _max: { seq: true } })
        const seq = (agg._max.seq ?? 0) + 1
        const invoiceNo = formatInvoiceNo(seq)
        const res = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT, invoiceNo: null }, data: { seq, invoiceNo, taxInvoice: gstRegistered } })
        if (res.count === 0) return CHANGED
        return { invoiceNo }
      })
    } catch (e) {
      if (isP2002(e) && attempt === 0) continue
      logger.error("allocateInvoiceNo failed", { message: e instanceof Error ? e.message : "unknown" })
      return { error: "Could not number the invoice. Please try again." }
    }
  }
  return { error: "Could not number the invoice. Please try again." }
}

/** Email the PDF for an invoice (already SENT). Throws on mail failure. */
async function emailInvoice(id: number): Promise<string> {
  const out = await loadInvoicePdf(id)
  if (!out || !out.invoiceNo || !out.recipientEmail) throw new Error("invoice not renderable")
  const [church, settings] = await Promise.all([getChurchSettings(), getInvoiceSettings()])
  const mail = buildInvoiceEmail({
    churchName: church.name, recipientName: out.recipientName, invoiceNo: out.invoiceNo,
    total: out.total, dueDate: out.dueDate, paymentDetails: settings.paymentDetails,
  })
  await sendEmail(out.recipientEmail, mail.subject, mail.html, mail.text, [
    { filename: out.filename, content: out.pdf, contentType: "application/pdf" },
  ])
  return out.invoiceNo
}

/** Shared DRAFT → SENT flow; `email` decides whether the PDF is emailed. */
async function send(id: number, email: boolean): Promise<Result> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const uid = actorId(session)
  const row = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, recipientEmail: true } })
  if (!row || row.status !== InvoiceStatus.DRAFT) return CHANGED
  if (email && !row.recipientEmail) return { error: "Add a recipient email first, or use Mark as sent" }

  const alloc = await allocateAndFreeze(id)
  if ("error" in alloc) return alloc
  const { invoiceNo } = alloc

  const sentAt = new Date()
  const flip = await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT }, data: { status: InvoiceStatus.SENT, sentAt, sentById: uid } })
  if (flip.count === 0) return CHANGED

  if (!email) {
    await logAudit(uid, "INVOICE_MARKED_SENT", "Invoice", id, { invoiceNo })
    revalidate(id)
    return { success: `Invoice ${invoiceNo} marked as sent` }
  }
  try {
    await emailInvoice(id)
  } catch (e) {
    logger.error("sendInvoice email failed", { message: e instanceof Error ? e.message : "unknown" })
    await prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.SENT, sentAt }, data: { status: InvoiceStatus.DRAFT, sentAt: null, sentById: null } })
    await logAudit(uid, "INVOICE_SEND_FAILED", "Invoice", id, { invoiceNo })
    revalidate(id)
    return { error: "Email failed — the invoice is still a draft (number kept). Try again or mark it as sent." }
  }
  await logAudit(uid, "INVOICE_SENT", "Invoice", id, { invoiceNo })
  revalidate(id)
  return { success: `Invoice ${invoiceNo} emailed` }
}

/** Number, freeze and email a DRAFT invoice. */
export async function sendInvoice(id: number): Promise<Result> {
  return send(id, true)
}

/** Number and freeze a DRAFT invoice without emailing (printed / delivered by hand). */
export async function markInvoiceSent(id: number): Promise<Result> {
  return send(id, false)
}

/** Re-email an already SENT invoice (same number, same frozen content). */
export async function resendInvoice(id: number): Promise<Result> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const row = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, recipientEmail: true } })
  if (!row || row.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be re-sent" }
  if (!row.recipientEmail) return { error: "This invoice has no recipient email" }
  try {
    await emailInvoice(id)
  } catch (e) {
    logger.error("resendInvoice failed", { message: e instanceof Error ? e.message : "unknown" })
    return { error: "Email failed. Please try again." }
  }
  await logAudit(actorId(session), "INVOICE_RESENT", "Invoice", id, { invoiceNo: row.invoiceNo })
  return { success: `Invoice ${row.invoiceNo} re-sent` }
}
