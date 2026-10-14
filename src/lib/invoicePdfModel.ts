import { prisma, Prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { decryptBytes, encryptBytes, safeDecrypt } from "@/lib/crypto"
import { getChurchSettingsFresh, getChurchSettingsStrict } from "@/lib/churchSettings"
import { getInvoiceSettings, type InvoiceSettings } from "@/lib/invoiceSettings"
import { renderInvoicePdf } from "@/lib/pdf/InvoicePdf"
import { computeInvoiceTotals, lineGstCents, type InvoiceLine } from "@/lib/invoice"
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

/** Church identity + payment details frozen onto an invoice when it is sent. */
export type IssuerSnapshot = Church & { paymentDetails: string }

/** Read a stored issuer snapshot; null when absent or malformed (then live settings are used). */
function parseIssuer(v: unknown): IssuerSnapshot | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const keys = ["name", "address", "abn", "email", "paymentDetails"] as const
  if (!keys.every((k) => typeof o[k] === "string")) return null
  return { name: o.name as string, address: o.address as string, abn: o.abn as string, email: o.email as string, paymentDetails: o.paymentDetails as string }
}

/**
 * Build the snapshot to freeze at send: strict church details for a tax invoice; otherwise
 * fresh ones without the ABN requirement. Both throw on a DB error, so a send aborts instead
 * of freezing placeholder details.
 */
export async function buildIssuerSnapshot(taxInvoice: boolean, settings: InvoiceSettings): Promise<IssuerSnapshot> {
  const c = taxInvoice ? await getChurchSettingsStrict() : await getChurchSettingsFresh()
  return { name: c.name, address: c.address, abn: c.abn, email: c.email, paymentDetails: settings.paymentDetails }
}

/**
 * Display totals: a draft's are recomputed from its lines with the current GST setting (the
 * stored ones date from the last save); sent invoices use the totals frozen at send.
 */
function totalsFor(inv: { status: InvoiceStatus; lines: InvoiceLine[]; subtotal: string; gstTotal: string; total: string }, showGst: boolean) {
  if (inv.status === "DRAFT") {
    const t = computeInvoiceTotals(inv.lines, showGst)
    return { subtotal: money(t.subtotalCents), gstTotal: money(t.gstCents), total: money(t.totalCents) }
  }
  return { subtotal: money(toCents(inv.subtotal)), gstTotal: money(toCents(inv.gstTotal)), total: money(toCents(inv.total)) }
}

/**
 * Null when the church details needed for this kind of invoice are set; otherwise the
 * operator-facing reason. Tax invoices need name, address and ABN (strict loader).
 */
export async function churchReadyError(taxInvoice: boolean): Promise<string | null> {
  if (!taxInvoice) return null
  try {
    await getChurchSettingsStrict()
    return null
  } catch (e) {
    return churchConfigMessage(e) ?? "Could not load church details. Please try again."
  }
}

/** Invoice-worded message for a strict-settings "not configured" error; null for any other error. */
export function churchConfigMessage(e: unknown): string | null {
  return e instanceof Error && e.message.includes("not configured")
    ? e.message.replace("issuing receipts", "issuing tax invoices")
    : null
}

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
    ...totalsFor(inv, showGst),
    notes: inv.notes, paymentDetails: settings.paymentDetails,
  }
}

/**
 * Best-effort freeze: store the encrypted PDF on a non-draft invoice that has none yet, plus
 * the issuer snapshot used for that render when the row has none (legacy rows), so later reads
 * can trust the stored blob. Both writes are conditional (never overwrite a blob, an existing
 * issuer or a draft) and run in one transaction; 0 rows matched is fine and a DB error is
 * logged, never thrown (the caller still has the PDF to serve).
 */
async function storeFrozenPdf(id: number, pdf: Uint8Array, issuerIfMissing: IssuerSnapshot | null): Promise<void> {
  const notDraft = { id, frozenPdf: null, status: { not: "DRAFT" as const } }
  try {
    await prisma.$transaction([
      ...(issuerIfMissing
        ? [prisma.invoice.updateMany({ where: { ...notDraft, issuer: { equals: Prisma.AnyNull } }, data: { issuer: issuerIfMissing } })]
        : []),
      prisma.invoice.updateMany({ where: notDraft, data: { frozenPdf: encryptBytes(pdf) } }),
    ])
  } catch (e) {
    logger.error("invoice frozenPdf store failed", { invoiceId: id, message: e instanceof Error ? e.message : "unknown" })
  }
}

type FrozenRow = { id: number; invoiceNo: string | null; recipientName: string; recipientEmail: string | null; total: { toString(): string }; dueDate: Date; frozenPdf: Uint8Array | null }

/**
 * Serve a non-draft invoice from its stored PDF with metadata only (no model building).
 * Null when there is nothing usable (no blob or snapshot); "unreadable" when the blob fails to
 * decrypt (logged with the id, never the content) so the caller renders live without overwriting.
 */
function readFrozenPdf(r: FrozenRow, frozen: IssuerSnapshot | null) {
  if (!r.frozenPdf || !frozen) return null
  try {
    return {
      pdf: decryptBytes(r.frozenPdf), filename: r.invoiceNo ? `${r.invoiceNo}.pdf` : `DRAFT-${r.id}.pdf`,
      recipientEmail: r.recipientEmail ? safeDecrypt(r.recipientEmail) : "",
      invoiceNo: r.invoiceNo, recipientName: r.recipientName, total: money(toCents(r.total.toString())),
      dueDate: formatLongDate(r.dueDate), churchName: frozen.name, paymentDetails: frozen.paymentDetails,
    }
  } catch (e) {
    logger.error("invoice frozenPdf unreadable, rendering live", { invoiceId: r.id, message: e instanceof Error ? e.message : "unknown" })
    return "unreadable" as const
  }
}

/**
 * Load an invoice and return its PDF plus the email metadata. A non-draft invoice with a
 * stored `frozenPdf` (and issuer snapshot) serves those exact bytes with no re-render. A
 * non-draft invoice without one (sent before this existed, or its post-send freeze failed)
 * renders live and is frozen on the spot, snapshot included. A blob that fails to decrypt is
 * rendered live without being overwritten. Drafts always render live. Callers must have
 * checked authorisation.
 */
export async function loadInvoicePdf(id: number, settingsIn?: InvoiceSettings) {
  const r = await prisma.invoice.findUnique({ where: { id } })
  if (!r) return null
  const sent = r.status !== "DRAFT"
  const frozen = sent ? parseIssuer(r.issuer) : null
  const stored = sent ? readFrozenPdf(r, frozen) : null
  if (stored && stored !== "unreadable") return stored
  const recipientEmail = r.recipientEmail ? safeDecrypt(r.recipientEmail) : ""
  // Sent invoices render from the issuer snapshot frozen at send, so a re-send or download
  // is always the same document — and needs no live settings read. Drafts (and legacy rows
  // without a snapshot) use live settings: a tax invoice needs the ABN (strict loader throws when unset).
  const live = settingsIn ?? (frozen
    ? { gstRegistered: r.taxInvoice, paymentDetails: frozen.paymentDetails }
    : await getInvoiceSettings())
  const taxInvoice = r.status === "DRAFT" ? live.gstRegistered : r.taxInvoice
  const issuer = frozen ?? (await buildIssuerSnapshot(taxInvoice, live))
  const church = { name: issuer.name, address: issuer.address, abn: issuer.abn, email: issuer.email }
  const settings: InvoiceSettings = { gstRegistered: live.gstRegistered, paymentDetails: issuer.paymentDetails }
  const model = buildInvoicePdfModel({
    invoiceNo: r.invoiceNo, status: r.status, taxInvoice: r.taxInvoice, issueDate: r.issueDate, dueDate: r.dueDate,
    recipientName: r.recipientName, recipientEmail, recipientAddress: r.recipientAddress ? safeDecrypt(r.recipientAddress) : "",
    lines: r.lines as InvoiceLine[], subtotal: r.subtotal.toString(), gstTotal: r.gstTotal.toString(), total: r.total.toString(),
    notes: r.notes ? safeDecrypt(r.notes) : "",
  }, church, settings)
  const pdf = await renderInvoicePdf(model)
  if (sent && !r.frozenPdf && stored !== "unreadable") await storeFrozenPdf(id, pdf, frozen ? null : issuer)
  return {
    pdf, filename: r.invoiceNo ? `${r.invoiceNo}.pdf` : `DRAFT-${r.id}.pdf`, recipientEmail,
    invoiceNo: r.invoiceNo, recipientName: r.recipientName, total: model.total, dueDate: model.dueDate,
    churchName: church.name, paymentDetails: issuer.paymentDetails,
  }
}
