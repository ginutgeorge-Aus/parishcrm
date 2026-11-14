// Printable A4 badge sheet for one Sunday School class (OSS-11): a 2x4 grid of
// cut-out cards, each with the child's name, class, church and a signed QR
// (see sundaySchoolBadge.ts). pdfkit, same approach as the other src/lib/pdf
// generators.
import PDFDocument from "pdfkit"
import QRCode from "qrcode"
import { PRIMARY_HEX, SLATE_700, SLATE_500, BORDER_STRONG } from "@/lib/theme/palette"

export type BadgeStudent = { name: string; qr: string }
export type BadgeSheetModel = { className: string; year: number; churchName: string; students: BadgeStudent[] }

const COLS = 2
const ROWS = 4
const MARGIN = 36

/**
 * Render the badge sheet. QR payloads arrive pre-signed in `students[].qr`.
 * @param model class label, church name and the students to print
 */
export async function renderSundaySchoolBadgesPdf(model: BadgeSheetModel): Promise<Buffer> {
  const qrs = await Promise.all(
    model.students.map((s) => QRCode.toBuffer(s.qr, { errorCorrectionLevel: "M", margin: 1, width: 300, type: "png" })),
  )
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    draw(doc, model, qrs)
    doc.end()
  })
}

/**
 * Lay the cards out on the document, adding a page every COLS*ROWS cards.
 * @param doc the pdfkit document
 * @param m the sheet model
 * @param qrs PNG bytes, parallel to `m.students`
 */
function draw(doc: PDFKit.PDFDocument, m: BadgeSheetModel, qrs: Buffer[]): void {
  const cardW = (doc.page.width - MARGIN * 2) / COLS
  const cardH = (doc.page.height - MARGIN * 2) / ROWS
  const perPage = COLS * ROWS
  const qrSize = Math.min(cardH - 24, cardW * 0.42)
  if (m.students.length === 0) {
    doc.fontSize(12).fillColor(SLATE_700).text("No students enrolled in this class.", MARGIN, MARGIN)
    return
  }
  m.students.forEach((s, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage()
    const slot = i % perPage
    const x = MARGIN + (slot % COLS) * cardW
    const y = MARGIN + Math.floor(slot / COLS) * cardH
    doc.lineWidth(0.5).strokeColor(BORDER_STRONG).dash(3, { space: 3 }).rect(x, y, cardW, cardH).stroke().undash()
    const pad = 12
    const textW = cardW - qrSize - pad * 3
    doc.image(qrs[i], x + cardW - qrSize - pad, y + (cardH - qrSize) / 2, { width: qrSize })
    doc.fillColor(SLATE_500).fontSize(8).text(m.churchName, x + pad, y + pad, { width: textW, height: 22, ellipsis: true })
    doc.fillColor(PRIMARY_HEX).font("Helvetica-Bold").fontSize(15)
      .text(s.name, x + pad, y + 44, { width: textW, height: 56, ellipsis: true })
    doc.fillColor(SLATE_700).font("Helvetica").fontSize(10)
      .text(`${m.className} · ${m.year}`, x + pad, y + cardH - pad - 26, { width: textW, height: 26, ellipsis: true })
  })
}
