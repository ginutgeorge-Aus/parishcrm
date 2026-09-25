import { SLATE_700, SLATE_500 } from "@/lib/theme/palette"

// Neutral text header drawn when no branding letterhead has been uploaded.
// Church name (≤200 chars) and address (≤500) are admin-configurable, so their
// wrapped height is measured rather than assumed. Short values keep the
// original fixed layout: address at top+22, rule at top+48. Returns the rule Y.
export function drawTextLetterhead(
  doc: PDFKit.PDFDocument,
  name: string,
  address: string,
  x: number,
  top: number,
  width: number
): number {
  doc.font("Helvetica-Bold").fontSize(16).fillColor(SLATE_700)
  let bottom = top + (name ? doc.heightOfString(name, { width }) : 0)
  doc.text(name, x, top, { width })
  if (address) {
    const addressY = Math.max(top + 22, bottom + 4)
    doc.font("Helvetica").fontSize(9).fillColor(SLATE_500)
    bottom = addressY + doc.heightOfString(address, { width })
    doc.text(address, x, addressY, { width })
  }
  return Math.max(top + 48, bottom + 12)
}
