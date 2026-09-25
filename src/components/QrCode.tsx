import { qrPath } from "@/lib/qr"

// Renders a QR code as an inline <svg> built from real JSX (not raw HTML
// injection) — no XSS surface, and inline SVG needs no CSP img-src allowance.
// Used for the event check-in code.
export function QrCode({ value, size = 180, title }: { value: string; size?: number; title?: string }) {
  const { size: viewBox, path } = qrPath(value)
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      role="img"
      aria-label={title ?? "QR code"}
      shapeRendering="crispEdges"
    >
      <rect width={viewBox} height={viewBox} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
