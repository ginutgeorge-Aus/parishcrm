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

/** Smallest body scale tried when shrinking text to fit one page. */
const MIN_SCALE = 0.4

/** One centred line or paragraph of the certificate body. */
type Block = { text: string; font: string; size: number; color: string; gap: number }

/**
 * Largest scale (1 down to MIN_SCALE, in 0.05 steps) at which all blocks fit in
 * `available` points of height; MIN_SCALE when none does.
 * @param doc pdfkit document (used to measure wrapped text)
 * @param blocks body blocks in drawing order
 * @param width text width
 * @param available height between the header and the footer band
 */
function fitScale(doc: PDFKit.PDFDocument, blocks: Block[], width: number, available: number): number {
  for (let scale = 1; scale > MIN_SCALE; scale = Math.round((scale - 0.05) * 100) / 100) {
    let total = 0
    for (const b of blocks) {
      doc.font(b.font).fontSize(b.size * scale)
      total += doc.heightOfString(b.text, { width, align: "center" }) + b.gap * scale
    }
    if (total <= available) return scale
  }
  return MIN_SCALE
}

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

  // Free text (names, place, godparents) is admin/staff entered and can be long,
  // so the body is laid out at the largest scale that fits above the footer band,
  // shrinking to MIN_SCALE; anything still too tall is cut with an ellipsis rather
  // than spilling onto a second page.
  const bodyBottom = doc.page.height - margin - 6 - 14 - 12
  const blocks: Block[] = [
    { text: t.title, font: "Helvetica-Bold", size: 26, color: PRIMARY_HEX, gap: 22 },
    { text: t.lead, font: "Helvetica", size: 12, color: SLATE_700, gap: 10 },
    { text: t.names, font: "Helvetica-Bold", size: 22, color: PRIMARY_HEX, gap: 10 },
    { text: t.statement, font: "Helvetica", size: 13, color: SLATE_700, gap: 14 },
    ...t.details.map((d): Block => ({ text: `${d.label}: ${d.value}`, font: "Helvetica", size: 11, color: SLATE_700, gap: 4 })),
  ]
  const scale = fitScale(doc, blocks, contentW, bodyBottom - y)
  for (const b of blocks) {
    doc.font(b.font).fontSize(b.size * scale).fillColor(b.color)
    doc.text(b.text, margin, y, { ...centre, height: Math.max(0, bodyBottom - y), ellipsis: true })
    y = doc.y + b.gap * scale
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
