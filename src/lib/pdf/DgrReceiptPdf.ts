// PDF renderer for the annual DGR donation receipt.
//
// Dependency note: the brief's spike step called for @react-pdf/renderer
// first. It installs and typechecks cleanly, but it ships as pure ESM with
// no CJS fallback ("type": "module", no "exports" map). Under this repo's
// Jest (jsdom, CJS module registry), that produces a hard failure inside
// Jest's own ESM interop shim (jest-runtime's bundled cjs-module-lexer
// throws "Unexpected export statement in CJS module" on
// @react-pdf/renderer's entry file) — reproducible on both Node 22 and a
// locally-fetched Node 24.18.0, with and without transformIgnorePatterns
// tweaks, and unrelated to the "requires Node v24.9+" gate that appears at
// an earlier stage on Node <24. A plain `node -e "require('@react-pdf/renderer')"`
// works fine outside Jest, confirming this is a Jest+package incompatibility,
// not a build or Node-version problem — so per the brief's fallback
// instruction, this renderer uses `pdfkit` (imperative, MIT-licensed, plain
// CJS) instead, keeping the exact same public signature
// `renderDgrReceiptPdf(model: DgrPdfModel): Promise<Buffer>` so no
// downstream caller (email attachment, download route) needs to change.
//
// Layout mirrors the branded DgrReceiptEmail: dark slate header band, a light
// meta strip, a green hero total, an itemised donation table, the DGR legal
// block, and a pinned footer band with ABN/address/email.
import PDFDocument from "pdfkit"
import type { DgrPdfModel } from "@/lib/dgr"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import {
  PRIMARY_HEX,
  ACCENT_HEX,
  SLATE_700,
  SLATE_500,
  SLATE_400,
  GREEN,
  BORDER,
  LIGHT_BG,
} from "@/lib/theme/palette"

// Palette shared with DgrReceiptEmail.tsx (slate + green). NAVY matches the
// church crest text in the letterhead.
const NAVY = PRIMARY_HEX
const SLATE_800 = PRIMARY_HEX
const GOLD = ACCENT_HEX

const LETTERHEAD_TOP = 40
// Cap the banner height so a tall uploaded letterhead can't overflow the page ( review).
const LETTERHEAD_MAX_H = 160
const FOOTER_H = 60
const ROW_H = 20
const TOTAL_SECTION_H = 9 + 34

type LetterheadAsset = Awaited<ReturnType<typeof getLetterheadAsset>>

// Draws the official church letterhead banner (or a neutral text header when
// no branding letterhead has been uploaded) across the top and the document
// title beneath it. Returns the Y coordinate where receipt content should begin.
function drawHeader(
  doc: PDFKit.PDFDocument,
  m: DgrPdfModel,
  letterhead: LetterheadAsset,
  margin: number,
  contentW: number
): number {
  let ruleY: number
  if (letterhead) {
    const imgH = Math.min(contentW / letterhead.aspect, LETTERHEAD_MAX_H)
    doc.image(letterhead.bytes, margin, LETTERHEAD_TOP, { fit: [contentW, LETTERHEAD_MAX_H] })
    ruleY = LETTERHEAD_TOP + imgH + 14
  } else {
    ruleY = drawTextLetterhead(doc, m.churchName ?? "", m.churchAddress ?? "", margin, LETTERHEAD_TOP, contentW)
  }
  // Gold rule under the letterhead (mirrors the crest's gold accents).
  doc.moveTo(margin, ruleY).lineWidth(1.5).strokeColor(GOLD).lineTo(doc.page.width - margin, ruleY).stroke()

  // Document title — admin-configurable, so measure its wrapped height.
  const titleY = ruleY + 14
  const titleOpts = { width: contentW, characterSpacing: 0.5 }
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13)
  const titleH = doc.heightOfString(m.documentTitle, titleOpts)
  doc.text(m.documentTitle, margin, titleY, titleOpts)

  return titleY + Math.max(30, titleH + 14)
}

function drawFooter(doc: PDFKit.PDFDocument, m: DgrPdfModel, margin: number, contentW: number): void {
  const footerY = doc.page.height - FOOTER_H
  doc.rect(0, footerY, doc.page.width, FOOTER_H).fill(LIGHT_BG)
  doc.moveTo(0, footerY).lineWidth(0.5).strokeColor(BORDER).lineTo(doc.page.width, footerY).stroke()
  const parts = [`${m.churchName}  ·  ABN ${m.churchAbn}`, m.churchAddress, m.churchEmail].filter(Boolean)
  // The footer text sits inside the page's bottom margin; zero the bottom
  // margin for this write so pdfkit doesn't treat it as overflow and spill
  // onto a fresh page.
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.fillColor(SLATE_400).font("Helvetica").fontSize(8.5).text(parts.join("\n"), margin, footerY + 14, {
    width: contentW,
    lineGap: 2,
  })
  doc.page.margins.bottom = savedBottom
}

function drawDgrReceipt(doc: PDFKit.PDFDocument, m: DgrPdfModel, letterhead: LetterheadAsset): void {
  const margin = doc.page.margins.left
  const contentW = doc.page.width - margin * 2
  const contentRight = doc.page.width - margin
  const maxY = doc.page.height - FOOTER_H - 14 // content must stay above the footer band

  // Footer belongs on EVERY page, not just the last — draw it on the page we're
  // leaving before spilling to a fresh one. Redraw the letterhead header
  // on each fresh page too, and return the content-start Y so callers don't reset
  // to the bare top margin (which left continuation pages unbranded).
  const newPage = (): number => {
    drawFooter(doc, m, margin, contentW)
    doc.addPage()
    return drawHeader(doc, m, letterhead, margin, contentW)
  }

  // Meta strip: receipt no · FY · issue date.
  let y = drawHeader(doc, m, letterhead, margin, contentW)
  const contentTop = y // every page's header is identical, so content starts here on each
  doc.rect(margin, y, contentW, 28).fill(LIGHT_BG)
  doc.rect(margin, y, contentW, 28).lineWidth(0.5).strokeColor(BORDER).stroke()
  doc
    .fillColor(SLATE_500)
    .font("Helvetica")
    .fontSize(10)
    .text(`Receipt ${m.receiptNo}      Financial Year ${m.fyLabel}      Issued ${m.issueDate}`, margin + 12, y + 9, {
      width: contentW - 24,
    })
  y += 28 + 26

  // Issued to.
  doc.fillColor(SLATE_500).font("Helvetica").fontSize(9).text("ISSUED TO", margin, y, { characterSpacing: 0.5 })
  // A long donor name wraps — measure it so the hero total can't overlap.
  doc.fillColor(SLATE_800).font("Helvetica-Bold").fontSize(15)
  const donorH = doc.heightOfString(m.donorName, { width: contentW })
  doc.text(m.donorName, margin, y + 12, { width: contentW })
  y += 12 + Math.max(34, donorH + 16)

  // Hero total.
  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(34).text(m.totalLabel, margin, y)
  doc
    .fillColor(SLATE_500)
    .font("Helvetica")
    .fontSize(9)
    .text(m.totalDonationsLabel, margin, y + 42, { characterSpacing: 0.5 })
  y += 70

  // Donation table.
  const dateX = margin
  const methodX = margin + 110
  const amtW = 100
  const amtX = contentRight - amtW
  const methodW = amtX - methodX - 12

  // Headings + separator; redrawn on every continuation page.
  const tableHeader = (top: number): number => {
    doc.fillColor(SLATE_500).font("Helvetica-Bold").fontSize(9)
    doc.text("DATE", dateX, top)
    doc.text("METHOD", methodX, top)
    doc.text("AMOUNT", amtX, top, { width: amtW, align: "right" })
    doc.moveTo(margin, top + 15).lineWidth(0.5).strokeColor(BORDER).lineTo(contentRight, top + 15).stroke()
    doc.font("Helvetica").fontSize(10)
    return top + 15 + 8
  }
  y = tableHeader(y)

  for (const line of m.lines) {
    // A long method description wraps across lines — grow the row so the next
    // row doesn't overlap it.
    const methodH = doc.heightOfString(line.method, { width: methodW })
    const rowH = Math.max(ROW_H, methodH + 4)
    if (y + rowH > maxY) y = tableHeader(newPage())
    doc.fillColor(SLATE_700).text(line.dateLabel, dateX, y)
    doc.fillColor(SLATE_700).text(line.method, methodX, y, { width: methodW })
    doc.fillColor(SLATE_700).text(line.amountLabel, amtX, y, { width: amtW, align: "right" })
    y += rowH
  }

  // Total row.
  // Total row page-break guard uses the first legal line's height.
  doc.font("Helvetica").fontSize(8.5)
  const firstLegalLineH = m.legalLines.length
    ? doc.heightOfString(m.legalLines[0], { width: contentW, lineGap: 1 })
    : 0
  if (y + TOTAL_SECTION_H + firstLegalLineH > maxY) {
    y = newPage()
  }
  doc.moveTo(margin, y).lineWidth(0.5).strokeColor(BORDER).lineTo(contentRight, y).stroke()
  y += 9
  doc.fillColor(SLATE_800).font("Helvetica-Bold").fontSize(11).text("Total", dateX, y)
  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(11).text(m.totalLabel, amtX, y, { width: amtW, align: "right" })
  y += TOTAL_SECTION_H - 9

  // Legal block. Legal text and the covered-period sentence are admin-configurable
  // (up to ~4000 chars), so a paragraph can be taller than a page. Keep a
  // paragraph whole when it fits a fresh page; otherwise split it at word
  // boundaries across pages so it never runs into the footer band.
  // newPage() redraws the header/footer, which leaves the title/footer font set.
  const legalStyle = (): void => {
    doc.font("Helvetica").fontSize(8.5).fillColor(SLATE_500)
  }
  const flow = (text: string, opts: PDFKit.Mixins.TextOptions): void => {
    let rest = text
    let freshPage = false
    const breakPage = (): void => {
      y = newPage()
      legalStyle()
      freshPage = true
    }
    while (rest) {
      const h = doc.heightOfString(rest, opts)
      if (y + h <= maxY) {
        doc.text(rest, margin, y, opts)
        y = doc.y
        return
      }
      if (!freshPage && contentTop + h <= maxY) {
        breakPage()
        continue
      }
      // Largest word prefix that fits in the space left on this page.
      const words = rest.split(" ")
      let lo = 0
      let hi = words.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (y + doc.heightOfString(words.slice(0, mid).join(" "), opts) <= maxY) lo = mid
        else hi = mid - 1
      }
      if (lo === 0 && !freshPage) {
        breakPage()
        continue
      }
      if (lo === 0) {
        // One token taller than a fresh page (e.g. adjacent {churchName} expansions):
        // split it by characters so PDFKit never auto-overflows past newPage().
        const word = words[0]
        let c = 1
        let hiC = word.length - 1
        while (c < hiC) {
          const mid = Math.ceil((c + hiC) / 2)
          if (y + doc.heightOfString(word.slice(0, mid), opts) <= maxY) c = mid
          else hiC = mid - 1
        }
        doc.text(word.slice(0, c), margin, y, opts)
        rest = [word.slice(c), ...words.slice(1)].join(" ")
      } else {
        doc.text(words.slice(0, lo).join(" "), margin, y, opts)
        rest = words.slice(lo).join(" ")
      }
      breakPage()
    }
  }

  legalStyle()
  for (const text of m.legalLines) {
    flow(text, { width: contentW, lineGap: 1 })
    y += 6
  }
  flow(m.coveredPeriod, { width: contentW })

  drawFooter(doc, m, margin, contentW)
}

export async function renderDgrReceiptPdf(model: DgrPdfModel): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 })
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    drawDgrReceipt(doc, model, letterhead)
    doc.end()
  })
}
