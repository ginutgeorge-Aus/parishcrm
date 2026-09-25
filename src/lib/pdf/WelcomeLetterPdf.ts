// PDF renderer for the new-member welcome letter. Mirrors MembershipPdf.ts:
// same letterhead banner + gold rule, pdfkit imperative layout, base64 crest
// so only pdfkit's .afm fonts need on-disk tracing (see next.config.mjs).
import PDFDocument from "pdfkit"
import type { WelcomeLetterModel } from "@/lib/welcomeLetter"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { PRIMARY_HEX, ACCENT_HEX, SLATE_700, SLATE_500 } from "@/lib/theme/palette"

const NAVY = PRIMARY_HEX
const GOLD = ACCENT_HEX
const LETTERHEAD_TOP = 40
// Cap the banner height so a tall uploaded letterhead can't overflow the page ( review).
const LETTERHEAD_MAX_H = 160

type LetterheadAsset = Awaited<ReturnType<typeof getLetterheadAsset>>

function draw(doc: PDFKit.PDFDocument, m: WelcomeLetterModel, letterhead: LetterheadAsset): void {
  const margin = doc.page.margins.left
  const contentW = doc.page.width - margin * 2
  const contentR = doc.page.width - margin
  const bottom = doc.page.height - doc.page.margins.bottom
  const ensure = (need: number) => { if (doc.y + need > bottom) doc.addPage() }

  // Letterhead banner (or a neutral text header when no branding letterhead
  // has been uploaded) + gold rule.
  let ruleY: number
  if (letterhead) {
    const drawnH = Math.min(contentW / letterhead.aspect, LETTERHEAD_MAX_H)
    doc.image(letterhead.bytes, margin, LETTERHEAD_TOP, { fit: [contentW, LETTERHEAD_MAX_H] })
    ruleY = LETTERHEAD_TOP + drawnH + 14
  } else {
    ruleY = drawTextLetterhead(doc, m.church.name ?? "", m.church.address ?? "", margin, LETTERHEAD_TOP, contentW)
  }
  doc.moveTo(margin, ruleY).lineWidth(1.5).strokeColor(GOLD).lineTo(contentR, ruleY).stroke()
  doc.y = ruleY + 18

  // align defaults to "justify" for flowing body paragraphs (matches the
  // branding sample); pass align:"left" for short lines (date, addressee, signer).
  const para = (text: string, opts: { bold?: boolean; gap?: number; size?: number; align?: "left" | "justify" } = {}) => {
    if (!text) return
    const align = opts.align ?? "justify"
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 10.5).fillColor(SLATE_700)
    const h = doc.heightOfString(text, { width: contentW, align })
    ensure(h + (opts.gap ?? 8))
    doc.text(text, margin, doc.y, { width: contentW, align })
    doc.y += opts.gap ?? 8
  }

  // Date.
  para(`Date: ${m.date}`, { bold: true, gap: 10, align: "left" })

  // Title.
  doc.font("Helvetica-Bold").fontSize(14).fillColor(NAVY)
  doc.text("Welcome to Our Church Family", margin, doc.y, { width: contentW })
  doc.y += 14

  // Addressee block.
  para(m.addresseeName, { bold: true, gap: 2, align: "left" })
  for (const line of m.addressLines) para(line, { gap: 2, align: "left" })
  doc.y += 8

  // Greeting.
  para(`Dear ${m.greetingName} and Family,`, { gap: 8 })
  para("Greetings in the name of our Lord and Saviour Jesus Christ.", { bold: true, gap: 10 })

  // Body intro (welcome + enrol/transfer + prayer, blank-line separated).
  for (const block of m.bodyIntro.split("\n\n")) para(block, { gap: 8 })

  // Member list heading + bullets.
  para("We warmly welcome:", { gap: 6 })
  for (const name of m.members) {
    doc.font("Helvetica").fontSize(10.5).fillColor(SLATE_700)
    const h = doc.heightOfString(name, { width: contentW - 18 })
    ensure(h + 4)
    // Both on one baseline — text() advances doc.y, so capture it first.
    const y = doc.y
    doc.text("•", margin + 4, y)
    doc.text(name, margin + 18, y, { width: contentW - 18 })
    doc.y += 4
  }
  doc.y += 8

  // Church Contributions section.
  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY)
  ensure(24)
  doc.text("Church Contributions", margin, doc.y, { width: contentW })
  doc.y += 10
  para(m.contributionsIntro, { gap: 10 })

  const accountBlock = (label: string, a: WelcomeLetterModel["bankAccounts"][number]) => {
    ensure(90)
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY)
    doc.text(label, margin, doc.y, { width: contentW })
    doc.y += 4
    const kv = (k: string, v: string) => {
      if (!v) return
      doc.font("Helvetica").fontSize(10).fillColor(SLATE_700)
      doc.text(`${k}: ${v}`, margin, doc.y, { width: contentW })
      doc.y += 2
    }
    kv("Bank", a.bank)
    kv("BSB", a.bsb)
    kv("Account Number", a.account)
    kv("Account Name", a.accountName)
    doc.y += 8
  }
  for (const a of m.bankAccounts) {
    accountBlock(a.taxDeductible ? `${a.fundLabel} (Tax Deductible)` : a.fundLabel, a)
  }

  para(
    "When making a bank transfer, please include your name in the payment description and, where possible, email the payment details and purpose to " + m.church.email + ".",
    { gap: 10 }
  )

  // Closing + signature.
  para(m.bodyClosing, { gap: 12 })
  para("Yours in Christ,", { gap: 24 })
  if (m.signerName) para(m.signerName, { bold: true, gap: 2 })
  if (m.signerTitle) para(m.signerTitle, { gap: 2 })
  para(m.church.name, { bold: true, gap: 2 })

  // Faint slate footer contact in the bottom-margin band of the last page, so it
  // can never overlap the signature. Zero the bottom margin for the write
  // so pdfkit doesn't treat it as overflow and spill onto a fresh page.
  const contact = [m.church.name, m.church.address, m.church.email].filter(Boolean).join("  ·  ")
  if (contact) {
    const savedBottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.fillColor(SLATE_500).font("Helvetica").fontSize(8)
    // Bounded to the band — long configured contact fields truncate rather
    // than spill onto a trailing blank page.
    doc.text(contact, margin, bottom + 16, { width: contentW, align: "center", height: 24, ellipsis: true })
    doc.page.margins.bottom = savedBottom
  }
}

export async function renderWelcomeLetterPdf(model: WelcomeLetterModel): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    draw(doc, model, letterhead)
    doc.end()
  })
}
