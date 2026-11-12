// PDF renderer for the annual giving statement (a non-tax summary of every gift
// in a financial year). Uses pdfkit like DgrReceiptPdf; shares its letterhead.
import PDFDocument from "pdfkit"
import type { GivingStatementModel } from "@/lib/givingStatement"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500, SLATE_400, GREEN, BORDER, LIGHT_BG } from "@/lib/theme/palette"

const LETTERHEAD_TOP = 40
const LETTERHEAD_MAX_H = 160
const FOOTER_H = 60
const ROW_H = 18

type LetterheadAsset = Awaited<ReturnType<typeof getLetterheadAsset>>

/**
 * Draw the letterhead banner (or text header) and the document title.
 * @returns Y coordinate where content starts
 */
function drawHeader(doc: PDFKit.PDFDocument, m: GivingStatementModel, letterhead: LetterheadAsset, margin: number, contentW: number): number {
  let ruleY: number
  if (letterhead) {
    const imgH = Math.min(contentW / letterhead.aspect, LETTERHEAD_MAX_H)
    doc.image(letterhead.bytes, margin, LETTERHEAD_TOP, { fit: [contentW, LETTERHEAD_MAX_H] })
    ruleY = LETTERHEAD_TOP + imgH + 14
  } else {
    ruleY = drawTextLetterhead(doc, m.churchName, m.churchAddress, margin, LETTERHEAD_TOP, contentW)
  }
  doc.moveTo(margin, ruleY).lineWidth(1.5).strokeColor(ACCENT_HEX).lineTo(doc.page.width - margin, ruleY).stroke()
  const titleY = ruleY + 14
  doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(13).text("ANNUAL GIVING STATEMENT", margin, titleY, { width: contentW, characterSpacing: 0.5 })
  return titleY + 30
}

/** Draw the pinned church details band at the bottom of the current page. */
function drawFooter(doc: PDFKit.PDFDocument, m: GivingStatementModel, margin: number, contentW: number): void {
  const footerY = doc.page.height - FOOTER_H
  doc.rect(0, footerY, doc.page.width, FOOTER_H).fill(LIGHT_BG)
  const parts = [m.churchAbn ? `${m.churchName}  ·  ABN ${m.churchAbn}` : m.churchName, m.churchAddress, m.churchEmail].filter(Boolean)
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.fillColor(SLATE_400).font("Helvetica").fontSize(8.5).text(parts.join("\n"), margin, footerY + 14, { width: contentW, lineGap: 2 })
  doc.page.margins.bottom = savedBottom
}

/** Lay out the whole statement, paginating the itemised table. */
function drawStatement(doc: PDFKit.PDFDocument, m: GivingStatementModel, letterhead: LetterheadAsset): void {
  const margin = doc.page.margins.left
  const contentW = doc.page.width - margin * 2
  const right = doc.page.width - margin
  const maxY = doc.page.height - FOOTER_H - 14
  const newPage = (): number => {
    drawFooter(doc, m, margin, contentW)
    doc.addPage()
    return drawHeader(doc, m, letterhead, margin, contentW)
  }

  let y = drawHeader(doc, m, letterhead, margin, contentW)
  doc.rect(margin, y, contentW, 28).fill(LIGHT_BG)
  doc.fillColor(SLATE_500).font("Helvetica").fontSize(10).text(`Financial Year ${m.fyLabel}      ${m.periodLabel}      Issued ${m.issueDate}`, margin + 12, y + 9, { width: contentW - 24 })
  y += 28 + 22

  doc.fillColor(SLATE_500).font("Helvetica").fontSize(9).text("PREPARED FOR", margin, y, { characterSpacing: 0.5 })
  doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(15)
  const nameH = doc.heightOfString(m.familyName, { width: contentW })
  doc.text(m.familyName, margin, y + 12, { width: contentW })
  y += 12 + Math.max(34, nameH + 16)

  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(30).text(m.totalLabel, margin, y)
  doc.fillColor(SLATE_500).font("Helvetica").fontSize(9).text("TOTAL GIVEN IN THE FINANCIAL YEAR", margin, y + 38, { characterSpacing: 0.5 })
  y += 64

  const amtW = 100
  const amtX = right - amtW
  const heading = (top: number, cols: [string, number][]): number => {
    doc.fillColor(SLATE_500).font("Helvetica-Bold").fontSize(9)
    for (const [label, x] of cols) {
      if (x === amtX) doc.text(label, x, top, { width: amtW, align: "right" })
      else doc.text(label, x, top)
    }
    doc.moveTo(margin, top + 15).lineWidth(0.5).strokeColor(BORDER).lineTo(right, top + 15).stroke()
    doc.font("Helvetica").fontSize(10)
    return top + 23
  }

  // Totals by fund.
  y = heading(y, [["FUND", margin], ["TOTAL", amtX]])
  for (const f of m.byFund) {
    if (y + ROW_H > maxY) y = heading(newPage(), [["FUND", margin], ["TOTAL", amtX]])
    doc.fillColor(SLATE_700).text(f.fund, margin, y, { width: amtX - margin - 12, height: ROW_H - 4, ellipsis: true })
    doc.text(f.amountLabel, amtX, y, { width: amtW, align: "right" })
    y += ROW_H
  }
  y += 18

  // Itemised gifts.
  const fundX = margin + 110
  const itemCols: [string, number][] = [["DATE", margin], ["FUND", fundX], ["AMOUNT", amtX]]
  if (y + 60 > maxY) y = newPage()
  y = heading(y, itemCols)
  for (const l of m.lines) {
    if (y + ROW_H > maxY) y = heading(newPage(), itemCols)
    doc.fillColor(SLATE_700)
    // Single-line cells: width-bound + ellipsis so a long fund name never wraps into the next row.
    doc.text(l.dateLabel, margin, y)
    doc.text(l.fund, fundX, y, { width: amtX - fundX - 8, height: ROW_H - 4, ellipsis: true })
    doc.text(l.amountLabel, amtX, y, { width: amtW, align: "right" })
    y += ROW_H
  }

  if (y + 40 > maxY) y = newPage()
  doc.moveTo(margin, y).lineWidth(0.5).strokeColor(BORDER).lineTo(right, y).stroke()
  y += 9
  doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(11).text("Total", margin, y)
  doc.fillColor(GREEN).text(m.totalLabel, amtX, y, { width: amtW, align: "right" })
  y += 28
  // The not-a-tax-receipt disclaimer must always appear: move to a new page rather than drop it.
  if (y + 30 > maxY) y = newPage()
  doc.fillColor(SLATE_500).font("Helvetica").fontSize(8.5).text(
    "This statement summarises gifts recorded in our books for the period above. It is not a tax receipt.",
    margin, y, { width: contentW }
  )
  drawFooter(doc, m, margin, contentW)
}

/**
 * Render a giving statement to a PDF buffer.
 * @param model print-ready statement model from buildStatementModel
 */
export async function renderGivingStatementPdf(model: GivingStatementModel): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 })
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    drawStatement(doc, model, letterhead)
    doc.end()
  })
}
