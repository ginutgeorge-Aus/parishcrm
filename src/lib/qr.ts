import QRCode from "qrcode"

export type QrPath = { size: number; path: string }

// Build an SVG path describing a QR code's dark modules. Output is rendered as a
// real <svg><path> JSX element (see components/QrCode.tsx) — never via raw HTML
// injection — so there is no XSS surface. The path string is composed only of
// numeric module coordinates.
//
// `size` includes a 1-module quiet zone on every side (required for reliable
// scanning); dark modules are offset by 1 to sit inside that border.
export function qrPath(text: string): QrPath {
  if (!text) throw new Error("qrPath: text is required")
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" })
  const n = qr.modules.size
  const data = qr.modules.data
  let path = ""
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (data[y * n + x]) {
        // 1px module square, offset by the 1-module quiet zone.
        path += `M${x + 1} ${y + 1}h1v1h-1z`
      }
    }
  }
  return { size: n + 2, path }
}
