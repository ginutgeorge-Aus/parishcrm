// PDF renderer for Sunday School class reports: church-name header, title, then a
// plain table (pdfkit imperative layout, same fonts/palette as the other PDFs).
import PDFDocument from "pdfkit"
import type { ReportTable } from "@/lib/sundaySchoolReports"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500, BORDER } from "@/lib/theme/palette"

const MARGIN = 40

/**
 * Draw the header and table onto a pdfkit document, paging as needed.
 * @param doc the document
 * @param t the table
 * @param church church name for the header
 * @param subtitle line under the title (date range)
 */
function draw(doc: PDFKit.PDFDocument, t: ReportTable, church: string, subtitle: string): void {
  const contentW = doc.page.width - MARGIN * 2
  const bottom = () => doc.page.height - doc.page.margins.bottom
  const ruleY = drawTextLetterhead(doc, church, "", MARGIN, MARGIN, contentW)
  doc.moveTo(MARGIN, ruleY).lineWidth(1.5).strokeColor(ACCENT_HEX).lineTo(MARGIN + contentW, ruleY).stroke()
  doc.font("Helvetica-Bold").fontSize(13).fillColor(PRIMARY_HEX).text(t.title, MARGIN, ruleY + 14, { width: contentW })
  doc.font("Helvetica").fontSize(9).fillColor(SLATE_500).text(subtitle, MARGIN, doc.y + 2, { width: contentW })
  doc.y += 10

  // First column wider (names / dates); the rest share the remainder.
  const n = t.headers.length
  const first = n > 1 ? contentW * 0.3 : contentW
  const rest = n > 1 ? (contentW - first) / (n - 1) : 0
  const widths = t.headers.map((_, i) => (i === 0 ? first : rest))
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0))

  const row = (cells: string[], bold: boolean) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 6 }))) + 6
    if (doc.y + h > bottom()) {
      doc.addPage()
      doc.y = MARGIN
    }
    const y = doc.y
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(bold ? PRIMARY_HEX : SLATE_700)
    cells.forEach((c, i) => doc.text(c, xs[i] + 3, y + 3, { width: widths[i] - 6 }))
    doc.moveTo(MARGIN, y + h).lineWidth(0.5).strokeColor(BORDER).lineTo(MARGIN + contentW, y + h).stroke()
    doc.y = y + h
  }
  row(t.headers, true)
  if (t.rows.length === 0) row(["No data for this range."], false)
  for (const r of t.rows) row(r, false)
}

/**
 * Render a report table as a PDF (A4, landscape when the table has many columns).
 * @param t the table
 * @param church church name for the header
 * @param subtitle line under the title (date range)
 * @returns the PDF bytes
 */
export function renderSundaySchoolReportPdf(t: ReportTable, church: string, subtitle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: t.headers.length > 6 ? "landscape" : "portrait", margin: MARGIN })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    draw(doc, t, church, subtitle)
    doc.end()
  })
}
