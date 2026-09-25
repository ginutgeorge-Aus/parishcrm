// Response-side allowlist for stored image bytes (gemini-nightly,
// defense in depth). Upload already restricts EventImage.mimeType to this
// same set (src/lib/actions/event.ts ALLOWED_IMAGE_MIME), but the serving
// route trusts the DB value verbatim as a `Content-Type` header — a value
// written by any other path (direct DB edit, a future writer that forgets
// the upload guard) could set something like `image/svg+xml` or
// `text/html`, which a browser will happily execute inline (stored XSS).
// Falling back to `application/octet-stream` for anything outside this
// raster allowlist means an unsafe stored mimeType downloads instead of
// rendering/executing.
const SAFE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

export function safeImageContentType(mimeType: string): string {
  return SAFE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : "application/octet-stream"
}
