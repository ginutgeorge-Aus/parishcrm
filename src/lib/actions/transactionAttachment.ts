"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { AuditWriteError, AUDIT_FAILED_ERROR, auditWriteFailedResult, logAuditGuardedTx } from "@/lib/auditGuard"
import { encrypt, encryptBytes } from "@/lib/crypto"
import { isP2034, isValidPgId } from "@/lib/validation"
import { assertUnlocked } from "@/lib/accountingLock"
import type { ActionResult } from "./types"
import { assertNotDemo } from "@/lib/demoMode"
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sanitizeFilename, sniffContentType } from "@/lib/fileUpload"
import { featureGuard } from "@/lib/featureFlags"

// Receipt/invoice attachments for a transaction, mirroring Xero's
// "attach files". Storage reuses the EventImage pattern — the bytes live in a
// DB BYTEA column and are served through an auth-gated route — so there is no
// new object-storage dependency or secret to provision. The download route is gated
// by canViewAccounting and scoped to the parent transaction. On top of that,
// the blob and filename are AES-256-GCM field-encrypted at rest (encryption.md):
// receipts routinely carry names, addresses and bank details, so the plaintext
// must never rest in the DB where a mis-gated read path could expose it. The
// blob is base64-encoded then encrypted and stored as UTF-8 bytes in the BYTEA
// column; the download route reverses this. `decrypt` is plaintext-safe.
// Bound attachments per transaction — an editor could otherwise pin unlimited
// 5 MB blobs to a single row (storage DoS). 20 covers any real receipt set.
const MAX_ATTACHMENTS_PER_TX = 20

/** Shown when the attachment write hit a write conflict/deadlock (P2034) and was rolled back. */
const ATTACHMENT_BUSY_ERROR = "Couldn't save the change. Try again."

/**
 * Maps a failure of an attachment write transaction to a safe result: an audit-insert
 * failure (`AuditWriteError`, write rolled back) to `AUDIT_FAILED_ERROR`, and a P2034
 * (plain, non-retrying tx — `logAuditGuardedTx` passes it through) to a "try again".
 * @param e - the error thrown by the write transaction
 * @param action - action name for the server log
 * @returns the error result, or null when `e` is not one of these (caller rethrows)
 */
function attachmentWriteError(e: unknown, action: string): { error: string } | null {
  if (e instanceof AuditWriteError) return auditWriteFailedResult(e, action)
  if (isP2034(e)) return { error: ATTACHMENT_BUSY_ERROR }
  return null
}

/** Attach a receipt file to a transaction. ADMIN/PASTOR (canAccessAccounting); blocked in demo mode and while Accounting is off. */
export async function attachTransactionReceipt(
  transactionId: number,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("accounting")
  if (off) return off

  if (!isValidPgId(transactionId)) return { error: "Not found" }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a file to attach." }
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) return { error: "Attachment must be a JPEG, PNG or PDF." }
  // Size is checked BEFORE arrayBuffer() to avoid buffering an oversized upload
  // into memory (OOM DoS — security.md).
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Attachment must be 4 MB or smaller." }

  // Parent must exist before we write the child row (FK / IDOR guard).
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, date: true },
  })
  if (!tx) return { error: "Not found" }

  // Attaching/removing a supporting record for a transaction in a locked (ATO
  // retained) period is tampering with the evidence — gate it on the parent's
  // date like every other dated financial mutation.
  const lockError = await assertUnlocked(tx.date)
  if (lockError) return { error: lockError }

  const existingCount = await prisma.transactionAttachment.count({ where: { transactionId } })
  if (existingCount >= MAX_ATTACHMENTS_PER_TX)
    return { error: `A transaction can have at most ${MAX_ATTACHMENTS_PER_TX} attachments.` }

  const ab = await file.arrayBuffer()
  const bytes = Buffer.from(ab)

  // Every allowed type must be verified by its magic bytes, not the declared
  // MIME (security.md) — JPEG (FF D8 FF), PNG (89 50 4E 47) and PDF (%PDF). The
  // sniffed type must also match what the client declared, and it — not the
  // client value — is what we persist and later serve as `contentType`.
  const sniffed = sniffContentType(bytes)
  if (!sniffed || sniffed !== file.type) {
    return { error: "That file's contents don't match a JPEG, PNG or PDF." }
  }

  // Encrypt before opening the transaction: base64 + AES-GCM of up to 4 MB is
  // CPU-bound and must not eat into the interactive transaction's timeout.
  const userId = actorId(session)
  const data = {
    transactionId,
    // Encrypt at rest (encryption.md) — filename can carry PII; the blob is
    // base64-encoded first so arbitrary bytes survive the string-based cipher.
    filename: encrypt(sanitizeFilename(file.name)),
    contentType: sniffed,
    size: bytes.length,
    data: encryptBytes(bytes),
    uploadedById: userId,
  }
  try {
    await prisma.$transaction(async (db) => {
      await db.transactionAttachment.create({ data })
      await logAuditGuardedTx(db, userId, "TRANSACTION_ATTACHMENT_ADDED", "Transaction", transactionId, {
        contentType: sniffed,
        size: bytes.length,
      })
    }, { maxWait: 10_000, timeout: 15_000 }) // up to 4 MB insert + audit row: the 5s default is too tight
  } catch (e) {
    const mapped = attachmentWriteError(e, "attachTransactionReceipt")
    if (mapped) return mapped
    throw e
  }
  revalidatePath(`/accounting/transactions/${transactionId}`)
}

/** Remove a receipt attachment. ADMIN/PASTOR (canAccessAccounting); blocked in demo mode and while Accounting is off. */
export async function removeTransactionReceipt(attachmentId: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("accounting")
  if (off) return off

  if (!isValidPgId(attachmentId)) return { error: "Not found" }

  const existing = await prisma.transactionAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, transactionId: true, transaction: { select: { date: true } } },
  })
  if (!existing) return { error: "Not found" }

  // Removing a receipt from a locked-period transaction is tampering.
  const lockError = await assertUnlocked(existing.transaction.date)
  if (lockError) return { error: lockError }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transactionAttachment.delete({ where: { id: attachmentId } })
      await logAuditGuardedTx(tx, actorId(session), "TRANSACTION_ATTACHMENT_REMOVED", "Transaction", existing.transactionId, {
        attachmentId,
      })
    })
  } catch (e) {
    const mapped = attachmentWriteError(e, "removeTransactionReceipt")
    if (mapped) return mapped
    throw e
  }
  revalidatePath(`/accounting/transactions/${existing.transactionId}`)
}
