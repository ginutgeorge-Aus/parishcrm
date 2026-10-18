import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { canViewAccounting } from "@/lib/roleGuard"
import { encryptedDocumentResponse } from "@/lib/encryptedDocument"
import { rateLimit } from "@/lib/rateLimit"
import { logger } from "@/lib/logger"
import { featureNotFound } from "@/lib/featureFlags"

const MAX_INT4 = 2147483647
const notFound = () => new NextResponse("Not found", { status: 404 })

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
  const off = await featureNotFound("accounting")
  if (off) return off
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
  if (att?.transactionId !== txId) return notFound()

  // Decrypt before auditing so a failed decrypt never records a view.
  let response: NextResponse
  try {
    response = encryptedDocumentResponse({
      blob: att.data,
      encryptedName: att.filename,
      contentType: att.contentType,
      fallbackName: "attachment",
    })
  } catch (e) {
    // Blob not decryptable (legacy plaintext, wrong key, corruption): clean error, no audit row, no content in the log.
    logger.error("encrypted document unreadable", { attachmentId: attId, message: e instanceof Error ? e.message : "unknown" })
    return NextResponse.json({ error: "Document could not be read" }, { status: 500 })
  }

  // Egress of a decrypted financial document (bank statement/invoice/receipt
  // scan) needs a forensic trail — "who accessed donor X's receipt".
  // Every sibling export route audits on success; this one had no VIEWED action.
  await logAudit(actorId(session), "TRANSACTION_ATTACHMENT_VIEWED", "Transaction", txId, { attachmentId: attId }, getClientIp(req))

  return response
}
