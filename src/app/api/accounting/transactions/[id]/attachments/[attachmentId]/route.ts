import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { canViewAccounting } from "@/lib/roleGuard"
import { decrypt } from "@/lib/crypto"
import { rateLimit } from "@/lib/rateLimit"

const MAX_INT4 = 2147483647
const notFound = () => new NextResponse("Not found", { status: 404 })

// Only inert types render inline. A user-supplied Content-Type like text/html or
// image/svg+xml would execute as Stored XSS if shown inline in the browser
//; anything off this list is forced to download as octet-stream.
const INLINE_SAFE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

const parseId = (v: string) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= MAX_INT4 ? n : null
}

// Serve a transaction receipt attachment. Gated by canViewAccounting
// (ADMIN/PASTOR/AUDITOR/OFFICE_ADMIN) and scoped to the parent transaction so a
// crafted attachment id can't dereference a blob outside the addressed row.
// Same 200-vs-404 opacity as the event-image route — a non-accounting role
// gets the identical 404 as a missing row, so it cannot probe existence.
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return notFound()

  // Each hit decrypts a blob + filename server-side — every sibling
  // export route caps per-user volume the same way; this one had no throttle.
  if (!rateLimit(`attachment:${actorId(session)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id, attachmentId } = await props.params
  const txId = parseId(id)
  const attId = parseId(attachmentId)
  if (txId === null || attId === null) return notFound()

  const att = await prisma.transactionAttachment.findUnique({
    where: { id: attId },
    select: { data: true, contentType: true, filename: true, transactionId: true },
  })
  // Scope to the addressed transaction — a real attachment on a different
  // transaction 404s exactly like a missing one.
  if (!att || att.transactionId !== txId) return notFound()

  // Stored blob is base64 ciphertext (UTF-8 bytes); reverse to the raw file.
  // Filename is encrypted too. `decrypt` is plaintext-safe (encryption.md).
  const stored = (Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data as Uint8Array)).toString("utf8")
  const body = Buffer.from(decrypt(stored), "base64")
  const filename = decrypt(att.filename)
  // Filenames are user-supplied; RFC 5987-encode the UTF-8 param so
  // quotes/newlines/non-ASCII can't break out of the header. The legacy
  // `filename=` param must be plain ASCII, so strip non-ASCII and quoting
  // chars for that fallback rather than reusing the percent-encoded form.
  const encoded = encodeURIComponent(filename)
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  // Serve inline only for the safe allowlist; anything else downloads as an
  // opaque octet-stream so a spoofed/active content type can't render.
  const inline = INLINE_SAFE.has(att.contentType)
  const contentType = inline ? att.contentType : "application/octet-stream"
  const disposition = inline ? "inline" : "attachment"

  // Egress of a decrypted financial document (bank statement/invoice/receipt
  // scan) needs a forensic trail — "who accessed donor X's receipt".
  // Every sibling export route audits on success; this one had no VIEWED action.
  await logAudit(actorId(session), "TRANSACTION_ATTACHMENT_VIEWED", "Transaction", txId, { attachmentId: attId }, getClientIp(req))

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Receipts are financial records — never cache them in shared caches.
      "Cache-Control": "private, no-store",
      // Show inline (thumbnail/preview) but suggest the original name on save.
      "Content-Disposition": `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
