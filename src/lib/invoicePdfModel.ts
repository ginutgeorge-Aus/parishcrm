import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getChurchSettings, getChurchSettingsStrict } from "@/lib/churchSettings"
import { getInvoiceSettings, type InvoiceSettings } from "@/lib/invoiceSettings"
import { renderInvoicePdf } from "@/lib/pdf/InvoicePdf"
import { lineGstCents, type InvoiceLine } from "@/lib/invoice"
import { fmtAUD, centsToNumber, toCents, formatLongDate } from "@/lib/formatting"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

type Church = { name: string; address: string; abn: string; email: string }
export type InvoicePdfModel = {
  title: "Tax Invoice" | "Invoice"; draft: boolean; invoiceNo: string | null; issueDate: string; dueDate: string
  church: Church; recipient: { name: string; email: string; address: string }; showGst: boolean
  lines: { description: string; qty: number; unitPrice: string; gst: string; amount: string }[]
  subtotal: string; gstTotal: string; total: string; notes: string; paymentDetails: string
}

const money = (cents: number) => fmtAUD(centsToNumber(cents))

/** Shape an invoice row into display strings for the PDF renderer (pure apart from formatting). */
export function buildInvoicePdfModel(inv: {
  invoiceNo: string | null; status: InvoiceStatus; taxInvoice: boolean; issueDate: Date; dueDate: Date
  recipientName: string; recipientEmail: string; recipientAddress: string; lines: InvoiceLine[]
  subtotal: string; gstTotal: string; total: string; notes: string
}, church: Church, settings: InvoiceSettings): InvoicePdfModel {
  const draft = inv.status === "DRAFT"
  const showGst = draft ? settings.gstRegistered : inv.taxInvoice
  return {
    title: showGst ? "Tax Invoice" : "Invoice",
    draft, invoiceNo: inv.invoiceNo,
    issueDate: formatLongDate(inv.issueDate), dueDate: formatLongDate(inv.dueDate),
    church,
    recipient: { name: inv.recipientName, email: inv.recipientEmail, address: inv.recipientAddress },
    showGst,
    lines: inv.lines.map((l) => ({
      description: l.description, qty: l.qty, unitPrice: money(l.unitPriceCents),
      gst: money(lineGstCents(l, showGst)), amount: money(l.qty * l.unitPriceCents),
    })),
    subtotal: money(toCents(inv.subtotal)), gstTotal: money(toCents(inv.gstTotal)), total: money(toCents(inv.total)),
    notes: inv.notes, paymentDetails: settings.paymentDetails,
  }
}

/** Load, decrypt and render an invoice PDF. Callers must have checked authorisation. */
export async function loadInvoicePdf(id: number) {
  const r = await prisma.invoice.findUnique({ where: { id } })
  if (!r) return null
  const recipientEmail = r.recipientEmail ? safeDecrypt(r.recipientEmail) : ""
  const settings = await getInvoiceSettings()
  // A tax invoice must carry the church's ABN (ATO), so it uses the strict
  // loader (throws when name/address/ABN are unset); a plain invoice doesn't.
  const taxInvoice = r.status === "DRAFT" ? settings.gstRegistered : r.taxInvoice
  const church = taxInvoice ? await getChurchSettingsStrict() : await getChurchSettings()
  const model = buildInvoicePdfModel({
    invoiceNo: r.invoiceNo, status: r.status, taxInvoice: r.taxInvoice, issueDate: r.issueDate, dueDate: r.dueDate,
    recipientName: r.recipientName, recipientEmail, recipientAddress: r.recipientAddress ? safeDecrypt(r.recipientAddress) : "",
    lines: r.lines as InvoiceLine[], subtotal: r.subtotal.toString(), gstTotal: r.gstTotal.toString(), total: r.total.toString(),
    notes: r.notes ? safeDecrypt(r.notes) : "",
  }, church, settings)
  const pdf = await renderInvoicePdf(model)
  return {
    pdf, filename: r.invoiceNo ? `${r.invoiceNo}.pdf` : `DRAFT-${r.id}.pdf`, recipientEmail,
    invoiceNo: r.invoiceNo, recipientName: r.recipientName, total: model.total, dueDate: model.dueDate,
  }
}
