"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { isP2002, isValidPgId } from "@/lib/validation"
import { InvoiceStatus } from "@/lib/generated/prisma/enums"
import { centsToDecimalString, computeInvoiceTotals, formatInvoiceNo, type InvoiceLine } from "@/lib/invoice"
import { getInvoiceSettings, type InvoiceSettings } from "@/lib/invoiceSettings"
import { buildIssuerSnapshot, churchReadyError, loadInvoicePdf, type IssuerSnapshot } from "@/lib/invoicePdfModel"
import { buildInvoiceEmail } from "@/lib/invoiceEmail"
import { sendEmail } from "@/lib/email"
import { featureGuard } from "@/lib/featureFlags"

const PATH = "/accounting/invoices"
const CHANGED = { error: "This invoice has changed. Reload and try again." }
type Result = { success: string } | { error: string }

/** Revalidate the list and one invoice's detail page. */
function revalidate(id: number) {
  revalidatePath(PATH)
  revalidatePath(`${PATH}/${id}`)
}

/**
 * In ONE transaction: allocate the INV number if missing (MAX+1, one P2002 retry), freeze
 * taxInvoice + issuer, recompute the stored totals from the lines with that same GST flag,
 * and flip DRAFT → SENT. Doing the flip in the same write means a concurrent draft edit can
 * never land between freezing and sending (edited lines with stale totals).
 */
async function allocateFreezeAndSend(id: number, uid: number, settings: InvoiceSettings, issuer: IssuerSnapshot): Promise<{ invoiceNo: string } | { error: string }> {
  const taxInvoice = settings.gstRegistered
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const row = await tx.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, lines: true, updatedAt: true } })
        if (!row || row.status !== InvoiceStatus.DRAFT) return CHANGED
        const t = computeInvoiceTotals(row.lines as InvoiceLine[], taxInvoice)
        const frozen = {
          status: InvoiceStatus.SENT,
          sentAt: new Date(),
          sentById: uid,
          taxInvoice,
          issuer,
          subtotal: centsToDecimalString(t.subtotalCents),
          gstTotal: centsToDecimalString(t.gstCents),
          total: centsToDecimalString(t.totalCents),
        }
        if (row.invoiceNo) {
          // updatedAt predicate = optimistic version check: a draft edit committed after the
          // read above bumps updatedAt, so this write matches 0 rows instead of freezing stale totals.
          const res = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.DRAFT, updatedAt: row.updatedAt }, data: frozen })
          return res.count === 0 ? CHANGED : { invoiceNo: row.invoiceNo }
        }
        const agg = await tx.invoice.aggregate({ _max: { seq: true } })
        const seq = (agg._max.seq ?? 0) + 1
        const invoiceNo = formatInvoiceNo(seq)
        const res = await tx.invoice.updateMany({
          where: { id, status: InvoiceStatus.DRAFT, invoiceNo: null, updatedAt: row.updatedAt },
          data: { seq, invoiceNo, ...frozen },
        })
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

/** Email the PDF for an invoice (already SENT). Throws on render or mail failure. */
async function emailInvoice(id: number, settings?: InvoiceSettings): Promise<void> {
  const out = await loadInvoicePdf(id, settings)
  if (!out || !out.invoiceNo || !out.recipientEmail) throw new Error("invoice not renderable")
  const mail = buildInvoiceEmail({
    churchName: out.churchName, recipientName: out.recipientName, invoiceNo: out.invoiceNo,
    total: out.total, dueDate: out.dueDate, paymentDetails: out.paymentDetails,
  })
  await sendEmail(out.recipientEmail, mail.subject, mail.html, mail.text, [
    { filename: out.filename, content: out.pdf, contentType: "application/pdf" },
  ])
}

/** Shared DRAFT → SENT flow; `email` decides whether the PDF is emailed. The PDF is rendered after the commit and freezing it is attempted (best effort, it can fail without failing the send). With `email` false a render failure is logged and never fails the send; with `email` true it surfaces as an email failure (the invoice stays SENT). */
async function send(id: number, email: boolean): Promise<Result> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return CHANGED
  const uid = actorId(session)
  const row = await prisma.invoice.findUnique({ where: { id }, select: { status: true, recipientEmail: true } })
  if (!row || row.status !== InvoiceStatus.DRAFT) return CHANGED
  if (email && !row.recipientEmail) return { error: "Add a recipient email first, or use Mark as sent" }

  const settings = await getInvoiceSettings()
  // Check before numbering: a tax invoice that can't render (no ABN etc.) must not get frozen.
  const notReady = await churchReadyError(settings.gstRegistered)
  if (notReady) return { error: notReady }

  let issuer: IssuerSnapshot
  try {
    issuer = await buildIssuerSnapshot(settings.gstRegistered, settings)
  } catch {
    return { error: "Could not load church details. Please try again." }
  }
  const alloc = await allocateFreezeAndSend(id, uid, settings, issuer)
  if ("error" in alloc) return alloc
  const { invoiceNo } = alloc

  if (!email) {
    // Freeze the PDF (letterhead) now, best effort: a failure leaves it to the lazy freeze on first download.
    try {
      await loadInvoicePdf(id, settings)
    } catch (e) {
      logger.error("markInvoiceSent freeze failed", { invoiceId: id, message: e instanceof Error ? e.message : "unknown" })
    }
    await logAudit(uid, "INVOICE_MARKED_SENT", "Invoice", id, { invoiceNo })
    revalidate(id)
    return { success: `Invoice ${invoiceNo} marked as sent` }
  }
  try {
    await emailInvoice(id, settings)
  } catch (e) {
    // Stay SENT: the mail may have been delivered before the error, so reopening the
    // draft could let a second, different document go out under the same number.
    logger.error("sendInvoice email failed", { message: e instanceof Error ? e.message : "unknown" })
    await logAudit(uid, "INVOICE_SEND_FAILED", "Invoice", id, { invoiceNo })
    revalidate(id)
    return { error: `${invoiceNo} is marked as sent, but the email failed. Use Re-send to try again, or deliver it yourself.` }
  }
  await logAudit(uid, "INVOICE_SENT", "Invoice", id, { invoiceNo })
  revalidate(id)
  return { success: `Invoice ${invoiceNo} emailed` }
}

/** Number, freeze and email a DRAFT invoice. */
export async function sendInvoice(id: number): Promise<Result> {
  const off = await featureGuard("invoices")
  if (off) return off
  return send(id, true)
}

/** Number and freeze a DRAFT invoice without emailing (printed / delivered by hand). */
export async function markInvoiceSent(id: number): Promise<Result> {
  const off = await featureGuard("invoices")
  if (off) return off
  return send(id, false)
}

/** Re-email an already SENT invoice (same number, same frozen content). */
export async function resendInvoice(id: number): Promise<Result> {
  const off = await featureGuard("invoices")
  if (off) return off
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Only sent invoices can be re-sent" }
  const row = await prisma.invoice.findUnique({ where: { id }, select: { status: true, invoiceNo: true, recipientEmail: true } })
  if (!row || row.status !== InvoiceStatus.SENT) return { error: "Only sent invoices can be re-sent" }
  if (!row.recipientEmail) return { error: "This invoice has no recipient email" }
  try {
    // Sent invoices render from their frozen issuer snapshot — no live settings needed.
    await emailInvoice(id)
  } catch (e) {
    logger.error("resendInvoice failed", { message: e instanceof Error ? e.message : "unknown" })
    return { error: "Email failed. Please try again." }
  }
  await logAudit(actorId(session), "INVOICE_RESENT", "Invoice", id, { invoiceNo: row.invoiceNo })
  return { success: `Invoice ${row.invoiceNo} re-sent` }
}
