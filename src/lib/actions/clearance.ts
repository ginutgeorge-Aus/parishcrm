"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { canManageClearances } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { isP2002, isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sanitizeFilename, sniffContentType } from "@/lib/fileUpload"
import { assertNotDemo } from "@/lib/demoMode"
import { ClearanceType } from "@/lib/generated/prisma/enums"
import type { ActionResult } from "./types"

// WWCC / Safe Ministry clearances on a person. Storage mirrors
// TransactionAttachment (transactionAttachment.ts): the file is base64-encoded,
// AES-256-GCM encrypted and stored as UTF-8 bytes in a BYTEA column; number,
// filename and verification note are encrypted strings (encryption.md). One
// current row per person+type; a new upload replaces it and the audit log
// (CLEARANCE_*) is the history. Changing number, expiry or document clears the
// verification so it must be re-verified.

const MAX_NUMBER_LEN = 40
const MAX_NOTE_LEN = 500
const CLEARANCE_TYPES = new Set<string>(Object.values(ClearanceType))
// cuid ids: bound the alphabet/length before they reach the DB.
const CLEARANCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** `YYYY-MM-DD` -> Date at UTC midnight (the app's date-only storage convention). */
function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

/** Date -> `YYYY-MM-DD` (UTC), or null. */
function dateToYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/**
 * Load the minimal row the verify/unverify/delete actions need. Null when the id
 * is malformed or the row does not exist (callers answer "Not found").
 */
async function loadClearance(clearanceId: string) {
  if (!CLEARANCE_ID_RE.test(clearanceId)) return null
  return prisma.personClearance.findUnique({
    where: { id: clearanceId },
    select: { id: true, personId: true, type: true, updatedAt: true },
  })
}

/**
 * Create or replace a person's clearance of `type`. Form fields: `number`
 * (optional), `expiresAt` (`yyyy-mm-dd`, optional), `document` (File, optional;
 * omitted on an edit keeps the stored document). Any change to number, expiry or
 * document clears verification. An unchanged resubmit is a no-op.
 * @param personId Person.id
 * @param type WWCC or SAFE_MINISTRY
 * @param formData submitted form
 */
export async function upsertClearance(
  personId: number,
  type: ClearanceType,
  formData: FormData,
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(personId) || !CLEARANCE_TYPES.has(type)) return { error: "Not found" }

  const numberRaw = String(formData.get("number") ?? "").trim()
  if (numberRaw.length > MAX_NUMBER_LEN) return { error: `Number must be ${MAX_NUMBER_LEN} characters or fewer.` }
  const number = numberRaw ? (type === ClearanceType.WWCC ? numberRaw.toUpperCase() : numberRaw) : null

  const expiryRaw = String(formData.get("expiresAt") ?? "").trim()
  if (expiryRaw && !isRealCalendarDate(expiryRaw)) return { error: "Enter a valid expiry date." }
  const expiresAt = expiryRaw ? ymdToDate(expiryRaw) : null

  // Validate the file BEFORE any DB read; size is checked before arrayBuffer()
  // so an oversized upload is never buffered (OOM DoS — security.md).
  const rawFile = formData.get("document")
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  let upload: { bytes: Buffer; contentType: string; name: string } | null = null
  if (file) {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) return { error: "Document must be a JPEG, PNG or PDF." }
    if (file.size > MAX_UPLOAD_BYTES) return { error: "Document must be 4 MB or smaller." }
    const bytes = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffContentType(bytes)
    // The sniffed type must match the declared one; it — not the client value —
    // is what we persist and later serve.
    if (!sniffed || sniffed !== file.type) return { error: "That file's contents don't match a JPEG, PNG or PDF." }
    upload = { bytes, contentType: sniffed, name: sanitizeFilename(file.name) }
  }

  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, archivedAt: true } })
  if (!person || person.archivedAt) return { error: "Not found" }

  const existing = await prisma.personClearance.findUnique({
    where: { personId_type: { personId, type } },
    select: { id: true, number: true, expiresAt: true, verifiedAt: true },
  })
  if (!existing && !number && !expiresAt && !upload) {
    return { error: "Enter an expiry date, number or document." }
  }

  const docData = upload
    ? {
        document: Buffer.from(encrypt(upload.bytes.toString("base64")), "utf8"),
        documentName: encrypt(upload.name),
        documentType: upload.contentType,
        documentSize: upload.bytes.length,
      }
    : {}
  const actor = actorId(session)

  if (!existing) {
    try {
      await prisma.personClearance.create({
        data: {
          personId,
          type,
          number: number ? encrypt(number) : null,
          expiresAt,
          ...docData,
          createdById: actor,
        },
      })
    } catch (e) {
      if (isP2002(e)) return { error: "This clearance was just added by someone else. Refresh and try again." }
      throw e
    }
    await logAudit(actor, "CLEARANCE_ADDED", "Person", personId, { type, documentReplaced: upload !== null })
    revalidatePath(`/people/${personId}`)
    return
  }

  const previousNumber = existing.number ? safeDecrypt(existing.number) : null
  const changed =
    upload !== null || previousNumber !== number || dateToYmd(existing.expiresAt) !== dateToYmd(expiresAt)
  if (!changed) return

  await prisma.personClearance.update({
    where: { id: existing.id },
    data: {
      number: number ? encrypt(number) : null,
      expiresAt,
      ...docData,
      verifiedAt: null,
      verifiedById: null,
      verificationNote: null,
    },
  })
  await logAudit(actor, "CLEARANCE_UPDATED", "Person", personId, {
    type,
    documentReplaced: upload !== null,
    verificationCleared: existing.verifiedAt !== null,
  })
  revalidatePath(`/people/${personId}`)
}

/**
 * Mark a clearance Verified by the acting user, with an optional note (e.g.
 * "Checked on OCG portal"). Uses an optimistic `updatedAt` guard so verifying a
 * row that was edited after the page loaded fails instead of vouching for new
 * content.
 * @param clearanceId PersonClearance.id
 * @param note optional free text, max 500 chars, stored encrypted
 */
export async function verifyClearance(clearanceId: string, note?: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const trimmed = (note ?? "").trim()
  if (trimmed.length > MAX_NOTE_LEN) return { error: `Note must be ${MAX_NOTE_LEN} characters or fewer.` }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  const actor = actorId(session)
  const result = await prisma.personClearance.updateMany({
    where: { id: row.id, updatedAt: row.updatedAt },
    data: {
      verifiedAt: new Date(),
      verifiedById: actor,
      verificationNote: trimmed ? encrypt(trimmed) : null,
    },
  })
  if (result.count === 0) return { error: "This clearance changed. Refresh and try again." }

  await logAudit(actor, "CLEARANCE_VERIFIED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
    hasNote: trimmed.length > 0,
  })
  revalidatePath(`/people/${row.personId}`)
}

/**
 * Remove a clearance's verification (back to Unverified).
 * @param clearanceId PersonClearance.id
 */
export async function unverifyClearance(clearanceId: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  await prisma.personClearance.update({
    where: { id: row.id },
    data: { verifiedAt: null, verifiedById: null, verificationNote: null },
  })
  await logAudit(actorId(session), "CLEARANCE_UNVERIFIED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
  })
  revalidatePath(`/people/${row.personId}`)
}

/**
 * Permanently delete a clearance row (document included). The audit trail keeps
 * the fact that it existed.
 * @param clearanceId PersonClearance.id
 */
export async function deleteClearance(clearanceId: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  await prisma.personClearance.delete({ where: { id: row.id } })
  await logAudit(actorId(session), "CLEARANCE_REMOVED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
  })
  revalidatePath(`/people/${row.personId}`)
}
