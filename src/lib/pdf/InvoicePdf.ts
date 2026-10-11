// Invoice PDF via PDFKit (same engine as DgrReceiptPdf — @react-pdf breaks under Jest).
import PDFDocument from "pdfkit"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500, BORDER, LIGHT_BG } from "@/lib/theme/palette"
import type { InvoicePdfModel } from "@/lib/invoicePdfModel"

const MARGIN = 48
const LETTERHEAD_TOP = 40
const LETTERHEAD_MAX_H = 160
const FOOTER_H = 50
const ROW_H = 20

type Letterhead = Awaited<ReturnType<typeof getLetterheadAsset>>

/** Letterhead image (or text fallback) + title block; returns the Y where content starts. */
function drawHeader(doc: PDFKit.PDFDocument, m: InvoicePdfModel, lh: Letterhead, contentW: number): number {
  let y: number
  if (lh) {
    const h = Math.min(LETTERHEAD_MAX_H, contentW / lh.aspect)
    doc.image(lh.bytes, MARGIN, LETTERHEAD_TOP, { fit: [contentW, h], align: "center" })
    y = LETTERHEAD_TOP + h + 8
  } else {
    y = drawTextLetterhead(doc, m.church.name, m.church.address, MARGIN, LETTERHEAD_TOP, contentW) + 8
  }
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(ACCENT_HEX).lineWidth(1.5).stroke()
  y += 14
  doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(20).text(m.title.toUpperCase(), MARGIN, y)
  if (m.showGst && m.church.abn) doc.font("Helvetica").fontSize(10).fillColor(SLATE_700).text(`ABN ${m.church.abn}`, MARGIN, y + 4, { width: contentW, align: "right" })
  return y + 34
}

/** Recipient (left) and invoice meta (right). */
function drawParties(doc: PDFKit.PDFDocument, m: InvoicePdfModel, y: number, contentW: number): number {
  const half = contentW / 2
  doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE_500).text("BILL TO", MARGIN, y)
  doc.font("Helvetica").fontSize(11).fillColor(SLATE_700)
    .text([m.recipient.name, m.recipient.address, m.recipient.email].filter(Boolean).join("\n"), MARGIN, y + 13, { width: half - 10 })
  const leftBottom = doc.y
  const meta: [string, string][] = [
    ["Invoice number", m.invoiceNo ?? "DRAFT"], ["Issue date", m.issueDate], ["Due date", m.dueDate],
  ]
  let my = y
  for (const [k, v] of meta) {
    doc.font("Helvetica").fontSize(9).fillColor(SLATE_500).text(k, MARGIN + half, my, { width: half / 2 })
    doc.font("Helvetica-Bold").fontSize(10).fillColor(SLATE_700).text(v, MARGIN + half + half / 2, my, { width: half / 2, align: "right" })
    my += 16
  }
  return Math.max(leftBottom, my) + 16
}

/** Line table with page breaks; returns the Y after the last row. */
function drawLines(doc: PDFKit.PDFDocument, m: InvoicePdfModel, y: number, contentW: number): number {
  const cols = m.showGst
    ? [{ k: "description", w: 0.46, a: "left" }, { k: "qty", w: 0.08, a: "right" }, { k: "unitPrice", w: 0.16, a: "right" }, { k: "gst", w: 0.12, a: "right" }, { k: "amount", w: 0.18, a: "right" }]
    : [{ k: "description", w: 0.56, a: "left" }, { k: "qty", w: 0.1, a: "right" }, { k: "unitPrice", w: 0.16, a: "right" }, { k: "amount", w: 0.18, a: "right" }]
  const head: Record<string, string> = { description: "Description", qty: "Qty", unitPrice: m.showGst ? "Unit (ex GST)" : "Unit price", gst: "GST", amount: m.showGst ? "Amount (ex GST)" : "Amount" }
  const bottom = () => doc.page.height - MARGIN - FOOTER_H
  const row = (cells: Record<string, string>, bold: boolean, bg?: string) => {
    if (y + ROW_H > bottom()) { doc.addPage(); y = MARGIN }
    if (bg) doc.rect(MARGIN, y, contentW, ROW_H).fill(bg)
    let x = MARGIN
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(SLATE_700)
    for (const c of cols) {
      const w = contentW * c.w
      doc.text(cells[c.k] ?? "", x + 4, y + 6, { width: w - 8, align: c.a as "left" | "right", lineBreak: false, ellipsis: true })
      x += w
    }
    y += ROW_H
  }
  row(head, true, LIGHT_BG)
  for (const l of m.lines) {
    row({ description: l.description, qty: String(l.qty), unitPrice: l.unitPrice, gst: l.gst, amount: l.amount }, false)
    doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(BORDER).lineWidth(0.5).stroke()
  }
  return y + 10
}

/** Totals block, notes and payment details. */
function drawTotals(doc: PDFKit.PDFDocument, m: InvoicePdfModel, y: number, contentW: number): void {
  const need = 80 + (m.notes ? 40 : 0) + (m.paymentDetails ? 50 : 0)
  if (y + need > doc.page.height - MARGIN - FOOTER_H) { doc.addPage(); y = MARGIN }
  const x = MARGIN + contentW * 0.55
  const w = contentW * 0.45
  const rows: [string, string, boolean][] = m.showGst
    ? [["Subtotal (ex GST)", m.subtotal, false], ["GST", m.gstTotal, false], ["Total (inc GST)", m.total, true]]
    : [["Total", m.total, true]]
  for (const [k, v, bold] of rows) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(bold ? PRIMARY_HEX : SLATE_700)
    doc.text(k, x, y, { width: w / 2 }); doc.text(v, x + w / 2, y, { width: w / 2, align: "right" })
    y += bold ? 20 : 16
  }
  y += 10
  if (m.notes) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE_500).text("NOTES", MARGIN, y)
    doc.font("Helvetica").fontSize(10).fillColor(SLATE_700).text(m.notes, MARGIN, y + 12, { width: contentW })
    y = doc.y + 12
  }
  if (m.paymentDetails) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE_500).text("HOW TO PAY", MARGIN, y)
    doc.font("Helvetica").fontSize(10).fillColor(SLATE_700).text(m.paymentDetails, MARGIN, y + 12, { width: contentW })
  }
}

/** Footer on every page: church name · ABN · email. */
function drawFooters(doc: PDFKit.PDFDocument, m: InvoicePdfModel, contentW: number): void {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const saved = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const text = [m.church.name, m.church.abn ? `ABN ${m.church.abn}` : "", m.church.email].filter(Boolean).join("  ·  ")
    doc.font("Helvetica").fontSize(8).fillColor(SLATE_500).text(text, MARGIN, doc.page.height - MARGIN - 12, { width: contentW, align: "center" })
    doc.page.margins.bottom = saved
  }
}

/** Diagonal DRAFT watermark on every page. */
function drawWatermark(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
      .font("Helvetica-Bold").fontSize(110).fillColor("#cbd5e1").opacity(0.35)
      .text("DRAFT", 0, doc.page.height / 2 - 60, { width: doc.page.width, align: "center", lineBreak: false })
      .restore()
    doc.opacity(1)
  }
}

/** Render an invoice to a PDF buffer (A4). */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    const contentW = doc.page.width - MARGIN * 2
    let y = drawHeader(doc, model, letterhead, contentW)
    y = drawParties(doc, model, y, contentW)
    y = drawLines(doc, model, y, contentW)
    drawTotals(doc, model, y, contentW)
    drawFooters(doc, model, contentW)
    if (model.draft) drawWatermark(doc)
    doc.end()
  })
}
