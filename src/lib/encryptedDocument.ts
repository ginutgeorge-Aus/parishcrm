import "server-only"
import { NextResponse } from "next/server"
import { decrypt } from "@/lib/crypto"

// Only inert types render inline. A user-supplied Content-Type like text/html or
// image/svg+xml would execute as stored XSS if shown inline in the browser;
// anything off this list is forced to download as octet-stream.
const INLINE_SAFE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"])

/**
 * Build the download response for a stored encrypted document (transaction
 * receipts, person clearances). The blob is base64 ciphertext stored as UTF-8
 * bytes in a BYTEA column; this reverses that to the raw file. The filename
 * is encrypted too (`decrypt` is plaintext-safe, encryption.md). Serves inline
 * only for the safe allowlist, otherwise as an octet-stream attachment, with
 * `private, no-store` caching and `nosniff`.
 * @param args.blob the BYTEA value (Buffer or Uint8Array)
 * @param args.encryptedName encrypted original filename, or null to use the fallback
 * @param args.contentType stored content type
 * @param args.fallbackName filename when none is stored
 */
export function encryptedDocumentResponse(args: {
  blob: Uint8Array
  encryptedName: string | null
  contentType: string
  fallbackName: string
}): NextResponse {
  const { blob, encryptedName, contentType, fallbackName } = args
  const stored = (Buffer.isBuffer(blob) ? blob : Buffer.from(blob)).toString("utf8")
  const body = Buffer.from(decrypt(stored), "base64")
  const filename = encryptedName ? decrypt(encryptedName) : fallbackName
  // Filenames are user-supplied; RFC 5987-encode the UTF-8 param so
  // quotes/newlines/non-ASCII can't break out of the header. The legacy
  // `filename=` param must be plain ASCII, so strip non-ASCII and quoting
  // chars for that fallback rather than reusing the percent-encoded form.
  const encoded = encodeURIComponent(filename)
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  const inline = INLINE_SAFE.has(contentType)
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": inline ? contentType : "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
