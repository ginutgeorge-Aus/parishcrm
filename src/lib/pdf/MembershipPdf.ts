// PDF renderer for a submitted public membership application. Mirrors the
// on-screen review print page (/memberships/[id]/print): official letterhead,
// sections A–F, member tables, applicant signature, and the office-use block.
// Attached to the secretary notification email so the application can be read
// (and filed) without logging into the CRM.
//
// Uses pdfkit for the same reasons as DgrReceiptPdf.ts (imperative, plain CJS,
// works under Jest). The letterhead image is fetched from the DB
// (getLetterheadAsset) with a neutral text-header fallback when unset — only
// pdfkit's own .afm font data needs on-disk tracing — see next.config.mjs.
import PDFDocument from "pdfkit"
import { officeSignatureLabel, overseasFieldLabels, type MembershipPayload, type OverseasLabels } from "@/lib/membership"
import { getLetterheadAsset } from "@/lib/branding"
import { drawTextLetterhead } from "@/lib/pdf/textLetterhead"
import { PRIMARY_HEX, PRIMARY_DARK_HEX, ACCENT_HEX, SLATE_700, SLATE_500, BORDER_STRONG } from "@/lib/theme/palette"

const NAVY = PRIMARY_HEX
const BORDER = BORDER_STRONG
const BAND_BG = PRIMARY_DARK_HEX
const GOLD = ACCENT_HEX

const LETTERHEAD_TOP = 40
// Cap the banner height so a tall/portrait uploaded letterhead can't push the
// document title and content off the page ( review).
const LETTERHEAD_MAX_H = 160
const LABEL_W = 200
const LINE_H = 16

export type MembershipPdfModel = {
  payload: MembershipPayload
  signature: string // data:image/...;base64,... URL
  churchName: string
  churchAddress: string
  // Parish rows (previous church, transfer letter, spouse's church) render when
  // the install enables them OR the stored application already has a value.
  parishFields: boolean
  signerTitle: string
} & OverseasLabels

function yesNo(v: boolean | null): string {
  return v == null ? "" : v ? "Yes" : "No"
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",")
  if (!dataUrl.startsWith("data:image/") || comma < 0) return null
  try {
    return Buffer.from(dataUrl.slice(comma + 1), "base64")
  } catch {
    return null
  }
}

type LetterheadAsset = Awaited<ReturnType<typeof getLetterheadAsset>>

function draw(doc: PDFKit.PDFDocument, m: MembershipPdfModel, letterhead: LetterheadAsset): void {
  const margin = doc.page.margins.left
  const contentW = doc.page.width - margin * 2
  const contentR = doc.page.width - margin
  const bottom = doc.page.height - doc.page.margins.bottom
  const p = m.payload
  const pe = p.personal

  const ensure = (need: number) => {
    if (doc.y + need > bottom) doc.addPage()
  }

  // Letterhead banner (or a neutral text header when no branding letterhead
  // has been uploaded) + gold rule + title.
  let ruleY: number
  if (letterhead) {
    const drawnH = Math.min(contentW / letterhead.aspect, LETTERHEAD_MAX_H)
    doc.image(letterhead.bytes, margin, LETTERHEAD_TOP, { fit: [contentW, LETTERHEAD_MAX_H] })
    ruleY = LETTERHEAD_TOP + drawnH + 14
  } else {
    ruleY = drawTextLetterhead(doc, m.churchName ?? "", m.churchAddress ?? "", margin, LETTERHEAD_TOP, contentW)
  }
  doc.moveTo(margin, ruleY).lineWidth(1.5).strokeColor(GOLD).lineTo(contentR, ruleY).stroke()
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("MEMBERSHIP REGISTRATION FORM", margin, ruleY + 14, { width: contentW, align: "center", characterSpacing: 0.5 })
  doc.y = ruleY + 44

  const band = (text: string) => {
    ensure(LINE_H + 24)
    const y = doc.y
    doc.rect(margin, y, contentW, 18).fill(BAND_BG)
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10.5).text(text, margin + 8, y + 4, { width: contentW - 16 })
    doc.y = y + 24
  }

  const line = (label: string, value?: string | null) => {
    if (!value) return
    // Reserve the value's actual wrapped height, not a single line — a multi-line
    // value near the page bottom would otherwise overflow off the page.
    // Measure at the same font/size the value renders in, so the height is exact.
    doc.font("Helvetica").fontSize(9.5)
    const valH = doc.heightOfString(value, { width: contentW - LABEL_W - 8 })
    // Labels can wrap too (admin-configured overseas-field labels, up to 80 chars).
    doc.font("Helvetica-Bold").fontSize(9.5)
    const labH = doc.heightOfString(label, { width: LABEL_W })
    const rowH = Math.max(LINE_H, valH, labH)
    ensure(rowH + 5)
    const y = doc.y
    doc.fillColor(SLATE_500).font("Helvetica-Bold").fontSize(9.5).text(label, margin, y, { width: LABEL_W })
    doc.fillColor(SLATE_700).font("Helvetica").fontSize(9.5).text(value, margin + LABEL_W + 8, y, { width: contentW - LABEL_W - 8 })
    doc.moveTo(margin, y + rowH + 2).lineWidth(0.4).dash(1, { space: 2 }).strokeColor(BORDER).stroke().undash()
    doc.y = y + rowH + 5
  }

  const table = (cols: string[], widths: number[], rows: (string | null)[][]) => {
    if (rows.length === 0) return
    ensure(LINE_H * 2)
    const startX = margin
    const drawRow = (cells: (string | null)[], header: boolean) => {
      const cellW = (i: number) => contentW * widths[i]
      const h = Math.max(
        LINE_H,
        ...cells.map((c, i) => doc.heightOfString(c ?? "", { width: cellW(i) - 8 }))
      )
      ensure(h + 4)
      const y = doc.y
      let x = startX
      cells.forEach((c, i) => {
        doc.rect(x, y, cellW(i), h + 4).lineWidth(0.5).strokeColor("#94a3b8").stroke()
        if (header) doc.rect(x, y, cellW(i), h + 4).fill("#e2e8f0").fillColor(NAVY)
        doc
          .fillColor(header ? NAVY : SLATE_700)
          .font(header ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .text(c ?? "", x + 4, y + 3, { width: cellW(i) - 8 })
        x += cellW(i)
      })
      doc.y = y + h + 4
    }
    drawRow(cols, true)
    for (const r of rows) drawRow(r, false)
    doc.y += 6
  }

  // A. Personal
  band("A. Personal Particulars")
  line("Name", pe.name)
  line("Sex", pe.gender)
  line("Date of Birth", pe.dateOfBirth)
  line("E-mail ID", pe.email)
  line("Mobile", pe.mobile)
  line("Residential Address", [pe.address, pe.suburb, pe.state, pe.postcode].filter(Boolean).join(", ") || null)
  line("Qualification & Profession", pe.qualificationProfession)
  if (m.parishFields || pe.motherParish) line("Previous church", pe.motherParish)
  const ol = overseasFieldLabels(p, m)
  line(ol.homeAddress, pe.addressInIndia)
  line(ol.arrivalDate, pe.dateOfArrivalNsw)
  line("Marital Status", pe.maritalStatus)
  if (m.parishFields || pe.transferCertFurnished != null) line("Transfer letter provided", yesNo(pe.transferCertFurnished) || null)

  // B. Spouse
  if (p.spouse) {
    band("B. Details of Family (Spouse)")
    line("Name of Spouse", p.spouse.name)
    line("Date of Birth", p.spouse.dateOfBirth)
    line("Date of Marriage", p.spouse.dateOfMarriage)
    if (m.parishFields || p.spouse.parish) line("Spouse's church", p.spouse.parish)
    line("Spouse working", yesNo(p.spouse.working) || null)
    line("Spouse E-mail ID", p.spouse.email)
  }

  // C. Children
  if (p.children.length > 0) {
    band("C. Name of Children")
    table(
      ["#", "Name", "Sex", "Date of Birth", "Occupation", "Phone / Email"],
      [0.06, 0.26, 0.1, 0.18, 0.2, 0.2],
      p.children.map((c, i) => [String(i + 1), c.name, c.sex, c.dateOfBirth, c.occupation, c.phoneEmail])
    )
  }

  // D. Dependents
  if (p.dependents.length > 0) {
    band("D. Other Dependents")
    table(
      ["#", "Name", "Sex", "Date of Birth", "Relationship", "Phone / Email"],
      [0.06, 0.26, 0.1, 0.18, 0.2, 0.2],
      p.dependents.map((d, i) => [String(i + 1), d.name, d.sex, d.dateOfBirth, d.relationship, d.phoneEmail])
    )
  }

  // E. Relatives
  if (p.relativesInAustralia.length > 0) {
    band("E. Any Other Relatives in Australia")
    table(
      ["#", "Name", "Place", "Relationship", "Phone / Email"],
      [0.06, 0.3, 0.24, 0.2, 0.2],
      p.relativesInAustralia.map((r, i) => [String(i + 1), r.name, r.place, r.relationship, r.phoneEmail])
    )
  }

  // F. Subscription & Declaration
  band("F. Subscription & Declaration")
  line("Monthly Subscription", `$${p.subscription.monthlyAmount}`)
  ensure(LINE_H * 2)
  doc.fillColor(SLATE_700).font("Helvetica-Oblique").fontSize(9.5).text(
    "I declare that the above information is true and correct to the best of my knowledge.",
    margin,
    doc.y,
    { width: contentW }
  )
  doc.y += 6
  line("Place", p.declaration.place)
  line("Date", p.declaration.date)

  // Signature.
  const sig = dataUrlToBuffer(m.signature)
  if (sig) {
    ensure(90)
    doc.fillColor(SLATE_500).font("Helvetica-Bold").fontSize(9.5).text("Signature", margin, doc.y)
    doc.y += 4
    try {
      doc.image(sig, margin, doc.y, { fit: [220, 70] })
      doc.y += 74
    } catch {
      // Corrupt/unsupported image — skip rather than fail the whole PDF.
    }
  }

  // Office-use block.
  ensure(90)
  const boxY = doc.y
  doc.rect(margin, boxY, contentW, 4).fill("#ffffff") // spacer
  doc.y = boxY + 6
  band("FOR OFFICE USE ONLY")
  if (m.parishFields) line("Transfer letter / NOC / Affidavit received", " ")
  line("Membership Registration No.", " ")
  line("Book No.", " ")
  line("Date", " ")
  line(officeSignatureLabel(m.signerTitle), " ")
}

export async function renderMembershipPdf(model: MembershipPdfModel): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 })
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    draw(doc, model, letterhead)
    doc.end()
  })
}
