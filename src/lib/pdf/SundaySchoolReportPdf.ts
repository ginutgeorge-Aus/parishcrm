// PDF renderer for the Sunday School report (OSS-13): an A4 landscape table
// with the header row repeated on each page. Uses pdfkit like the other PDFs.
import PDFDocument from "pdfkit"
import { formatCell, type ReportTable } from "@/lib/sundaySchoolReport"
import { PRIMARY_HEX, SLATE_700, SLATE_500, SLATE_400, BORDER, LIGHT_BG } from "@/lib/theme/palette"

const MARGIN = 36
const ROW_H = 16
const HEAD_H = 26
const FOOTER_H = 24
/** Narrowest readable score column; below this on A4 the page switches to A3. */
const MIN_NARROW_W = 28
const A4_LANDSCAPE_W = 841.89

/** Column widths: the name (and class) columns get more room, the rest share what is left. */
function columnWidths(headers: string[], contentW: number): number[] {
  const wide = headers.map((h) => h === "Child" || h === "Class" || h === "Family")
  const wideCount = wide.filter(Boolean).length
  const narrowCount = headers.length - wideCount
  // Narrow columns get 60pt when there's room, but wide ones never drop below 90pt.
  // Floor at MIN_NARROW_W/2 so an extreme column count can never yield a zero/negative width.
  const narrowW = narrowCount === 0 ? 0 : Math.max(MIN_NARROW_W / 2, Math.min(60, (contentW - wideCount * 90) / narrowCount))
  const wideW = wideCount === 0 ? 0 : (contentW - narrowW * narrowCount) / wideCount
  return wide.map((w) => (w ? wideW : narrowW))
}

/** Draw the title block and the column header row; returns the Y where body rows start. */
function drawPageHeader(doc: PDFKit.PDFDocument, t: ReportTable, church: string, widths: number[], fontSize: number): number {
  const contentW = doc.page.width - MARGIN * 2
  let y = MARGIN
  if (church) {
    doc.fillColor(SLATE_500).font("Helvetica").fontSize(9).text(church, MARGIN, y, { width: contentW })
    y += 14
  }
  doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(14).text(t.title, MARGIN, y, { width: contentW })
  y += 20
  doc.fillColor(SLATE_500).font("Helvetica").fontSize(9).text(t.subtitle, MARGIN, y, { width: contentW })
  y += 20
  doc.rect(MARGIN, y, contentW, HEAD_H).fill(LIGHT_BG)
  doc.fillColor(SLATE_700).font("Helvetica-Bold").fontSize(fontSize)
  let x = MARGIN
  t.headers.forEach((h, i) => {
    doc.text(h, x + 3, y + 4, { width: widths[i] - 6, height: HEAD_H - 6, align: i === 0 ? "left" : "center", ellipsis: true })
    x += widths[i]
  })
  doc.font("Helvetica").fontSize(fontSize)
  return y + HEAD_H + 4
}

/** Page number at the foot of the current page. */
function drawFooter(doc: PDFKit.PDFDocument, page: number): void {
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.fillColor(SLATE_400).font("Helvetica").fontSize(8)
    .text(`Page ${page}`, MARGIN, doc.page.height - FOOTER_H, { width: doc.page.width - MARGIN * 2, align: "right" })
  doc.page.margins.bottom = savedBottom
}

/** Lay out the whole table, paginating rows. */
function drawReport(doc: PDFKit.PDFDocument, t: ReportTable, church: string): void {
  const contentW = doc.page.width - MARGIN * 2
  const widths = columnWidths(t.headers, contentW)
  // Many exam columns: shrink the type so headers still fit.
  const fontSize = t.headers.length > 16 ? 6.5 : t.headers.length > 10 ? 7.5 : 9
  const maxY = doc.page.height - MARGIN - FOOTER_H
  let page = 1
  let y = drawPageHeader(doc, t, church, widths, fontSize)

  if (t.rows.length === 0) {
    doc.fillColor(SLATE_500).text("No enrolled children.", MARGIN, y + 4)
  }
  t.rows.forEach((row, r) => {
    if (y + ROW_H > maxY) {
      drawFooter(doc, page)
      doc.addPage()
      page++
      y = drawPageHeader(doc, t, church, widths, fontSize)
    }
    if (r % 2 === 1) doc.rect(MARGIN, y - 3, contentW, ROW_H).fill(LIGHT_BG)
    doc.fillColor(SLATE_700)
    let x = MARGIN
    row.forEach((cell, i) => {
      doc.text(formatCell(t.headers[i], cell), x + 3, y, { width: widths[i] - 6, height: ROW_H - 4, align: i === 0 ? "left" : "center", ellipsis: true })
      x += widths[i]
    })
    y += ROW_H
  })
  doc.moveTo(MARGIN, y).lineWidth(0.5).strokeColor(BORDER).lineTo(MARGIN + contentW, y).stroke()
  drawFooter(doc, page)
}

/**
 * Render a Sunday School report table to a PDF buffer (A4 landscape).
 * @param table report from buildReport
 * @param church church name shown above the title ("" to omit)
 */
export async function renderSundaySchoolReportPdf(table: ReportTable, church: string): Promise<Buffer> {
  // Too many exam columns for readable A4 widths: print on A3 landscape instead.
  const a4Narrow = Math.min(...columnWidths(table.headers, A4_LANDSCAPE_W - MARGIN * 2))
  const size = table.headers.length > 1 && a4Narrow < MIN_NARROW_W ? "A3" : "A4"
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size, layout: "landscape", margin: MARGIN })
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    drawReport(doc, table, church)
    doc.end()
  })
}
