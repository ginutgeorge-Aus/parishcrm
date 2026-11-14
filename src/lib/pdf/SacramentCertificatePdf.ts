// PDF renderer for a sacramental certificate (#609). Same pdfkit approach and
// letterhead handling as WelcomeLetterPdf.ts (no new dependency); landscape A4
// with a single gold frame. The wording comes from certificateText() so the
// layout stays free of rite-specific logic.
import PDFDocument from "pdfkit"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { certificateText, type CertificateSource } from "@/lib/sacraments"
import { PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500 } from "@/lib/theme/palette"

const LETTERHEAD_TOP = 40
// Cap the banner height so a tall uploaded letterhead can't overflow the page.
const LETTERHEAD_MAX_H = 110
const FRAME_INSET = 20

type LetterheadAsset = Awaited<ReturnType<typeof getLetterheadAsset>>

/** Church name and address printed in the header when no letterhead image is uploaded. */
export type CertificateChurch = { name: string; address: string }

/**
 * Draw the certificate onto an open document.
 * @param doc pdfkit document (landscape A4)
 * @param r register entry to print
 * @param church church name/address for the text header and footer
 * @param letterhead uploaded letterhead image, or null for the text header
 */
function draw(doc: PDFKit.PDFDocument, r: CertificateSource, church: CertificateChurch, letterhead: LetterheadAsset): void {
  const t = certificateText(r)
  const margin = doc.page.margins.left
  const contentW = doc.page.width - margin * 2
  const centre = { width: contentW, align: "center" as const }

  doc
    .rect(FRAME_INSET, FRAME_INSET, doc.page.width - FRAME_INSET * 2, doc.page.height - FRAME_INSET * 2)
    .lineWidth(1.5)
    .strokeColor(ACCENT_HEX)
    .stroke()

  let y: number
  if (letterhead) {
    const drawnH = Math.min(contentW / letterhead.aspect, LETTERHEAD_MAX_H)
    doc.image(letterhead.bytes, margin, LETTERHEAD_TOP, { fit: [contentW, LETTERHEAD_MAX_H] })
    y = LETTERHEAD_TOP + drawnH + 24
  } else {
    y = drawTextLetterhead(doc, church.name, church.address, margin, LETTERHEAD_TOP, contentW) + 16
  }

  doc.font("Helvetica-Bold").fontSize(26).fillColor(PRIMARY_HEX)
  doc.text(t.title, margin, y, centre)
  y = doc.y + 22

  doc.font("Helvetica").fontSize(12).fillColor(SLATE_700)
  doc.text(t.lead, margin, y, centre)
  y = doc.y + 10

  doc.font("Helvetica-Bold").fontSize(22).fillColor(PRIMARY_HEX)
  doc.text(t.names, margin, y, centre)
  y = doc.y + 10

  doc.font("Helvetica").fontSize(13).fillColor(SLATE_700)
  doc.text(t.statement, margin, y, centre)
  y = doc.y + 14

  doc.fontSize(11)
  for (const d of t.details) {
    doc.text(`${d.label}: ${d.value}`, margin, y, centre)
    y = doc.y + 4
  }

  // Register number and church contact sit in the bottom band of the frame. The
  // bottom margin is zeroed for the write so pdfkit does not spill onto a new page.
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.font("Helvetica").fontSize(9).fillColor(SLATE_500)
  const footY = doc.page.height - margin - 6
  doc.text(`Register no. ${t.registerNo}`, margin, footY - 14, { ...centre, height: 14, ellipsis: true })
  const contact = [church.name, church.address].filter(Boolean).join("  ·  ")
  if (contact) doc.text(contact, margin, footY, { ...centre, height: 14, ellipsis: true })
  doc.page.margins.bottom = savedBottom
}

/**
 * Render a sacramental certificate as a PDF.
 * @param record the register entry (decrypted; notes are never printed)
 * @param church church name and address
 * @returns PDF bytes
 */
export async function renderSacramentCertificatePdf(
  record: CertificateSource,
  church: CertificateChurch,
): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 48 })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    draw(doc, record, church, letterhead)
    doc.end()
  })
}
