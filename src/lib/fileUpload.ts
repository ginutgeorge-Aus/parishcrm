// Shared upload primitives for DB-stored, encrypted documents (transaction
// receipts, person clearances). Pure — no server-only imports — so it is
// unit-testable and client-safe.

// 4 MB, not 5: leaves multipart-overhead headroom under next.config's 5mb
// serverActions.bodySizeLimit so Next doesn't reject the body before the
// action's own size check runs.
/** Maximum accepted upload size in bytes (4 MB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/** Declared MIME types accepted for upload (must also pass the magic-byte sniff). */
export const ALLOWED_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
])

const MAX_FILENAME_LEN = 255

/** The content types `sniffContentType` can return. */
export type SniffedContentType = "image/jpeg" | "image/png" | "application/pdf"

/**
 * Sniff the real content type from the leading magic bytes — never trust the
 * attacker-controlled `file.type`, which is persisted and used to serve the
 * file. Returns null when the bytes match no allowed type.
 */
export function sniffContentType(bytes: Uint8Array): SniffedContentType | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf" // %PDF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  return null
}

/**
 * Strip any path segments a browser might include and bound the length.
 * Falls back to "attachment" when nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "attachment"
  const trimmed = base.trim().slice(0, MAX_FILENAME_LEN)
  return trimmed || "attachment"
}
