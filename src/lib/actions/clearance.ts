"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { canManageClearances } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { DECRYPTION_ERROR_PLACEHOLDER as DECRYPTION_ERROR } from "@/lib/cryptoCore"
import { CUID_ID_RE, isP2002, isRealCalendarDate, isValidPgId, parseOptimisticUpdatedAt } from "@/lib/validation"
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sanitizeFilename, sniffContentType } from "@/lib/fileUpload"
import { assertNotDemo } from "@/lib/demoMode"
import { ClearanceType } from "@/lib/generated/prisma/enums"
import { BULK_VERIFY_MAX } from "@/lib/clearanceComplianceView"
import type { ActionResult, ActionResultWithSuccess } from "./types"

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

/** `YYYY-MM-DD` -> Date at UTC midnight (the app's date-only storage convention). */
function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

/** Date -> `YYYY-MM-DD` (UTC), or null. */
function dateToYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

const STALE_ERROR = "This clearance changed. Refresh and try again."

// Every write re-checks the archived-person boundary in its own predicate, so an
// archiveFamily that commits after an action's pre-read can't be overtaken.
const LIVE_PERSON = { person: { archivedAt: null } } as const

/**
 * Parse the `updatedAt` ISO string the client last saw. Null when missing or
 * malformed (callers treat that as stale — these actions never write unguarded).
 * @param seen ISO timestamp from the client
 */
function parseSeenUpdatedAt(seen: unknown): Date | null {
  if (typeof seen !== "string" || !seen || Number.isNaN(Date.parse(seen))) return null
  return new Date(seen)
}

/**
 * Load the minimal row the verify/unverify/delete actions need. Null when the id
 * is malformed, the row does not exist, or its person is archived — archived
 * people are treated as not found, matching upsertClearance (callers answer "Not found").
 */
async function loadClearance(clearanceId: string) {
  if (!CUID_ID_RE.test(clearanceId)) return null
  const row = await prisma.personClearance.findUnique({
    where: { id: clearanceId },
    select: { id: true, personId: true, type: true, updatedAt: true, person: { select: { archivedAt: true } } },
  })
  if (!row || row.person.archivedAt) return null
  return row
}

/**
 * Create or replace a person's clearance of `type`. Form fields: `number`
 * (optional), `expiresAt` (`yyyy-mm-dd`, optional), `document` (File, optional;
 * omitted on an edit keeps the stored document). Any change to number, expiry or
 * document clears verification. An unchanged resubmit is a no-op. An edit may
 * carry the hidden `updatedAt` the form loaded with; a mismatch is rejected.
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
    select: { id: true, number: true, expiresAt: true, verifiedAt: true, updatedAt: true, documentType: true },
  })
  // A clearance must keep some evidence: an edit that clears the last number /
  // expiry of a document-less row would leave an empty row that reads as
  // Unverified (and could be Verified) instead of Missing.
  const keepsDocument = existing?.documentType != null
  if (!number && !expiresAt && !upload && !keepsDocument) {
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
  // Optimistic concurrency (event.ts pattern): the edit form round-trips the
  // row's updatedAt and the Add form sends none. A seen value with no row means
  // it was removed since the page loaded; a row with no seen value means it was
  // added since. Both are stale — never recreate or overwrite from old data.
  const seenAt = parseOptimisticUpdatedAt(formData)
  if (existing ? !seenAt : seenAt) return { error: STALE_ERROR }
  if (existing && seenAt && seenAt.getTime() !== existing.updatedAt.getTime()) return { error: STALE_ERROR }

  if (!existing) {
    try {
      // FOR SHARE on the person row blocks a concurrent archive (its UPDATE needs
      // the row lock) until the create commits, and fails if it already has.
      const created = await prisma.$transaction(async (tx) => {
        const live = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM "Person" WHERE id = ${personId} AND "archivedAt" IS NULL FOR SHARE`
        if (live.length === 0) return false
        await tx.personClearance.create({
          data: {
            personId,
            type,
            number: number ? encrypt(number) : null,
            expiresAt,
            ...docData,
            createdById: actor,
          },
        })
        return true
      })
      if (!created) return { error: "Not found" }
    } catch (e) {
      if (isP2002(e)) return { error: "This clearance was just added by someone else. Refresh and try again." }
      throw e
    }
    await logAudit(actor, "CLEARANCE_ADDED", "Person", personId, { type, documentReplaced: upload !== null })
    revalidatePath(`/people/${personId}`)
    return
  }

  const previousNumber = existing.number ? safeDecrypt(existing.number) : null
  // An undecryptable number (rotated-away key, corrupt ciphertext) is rendered
  // as the safeDecrypt placeholder and round-trips through the form; saving it
  // would overwrite recoverable ciphertext. Only an explicitly entered number
  // (or clearing it) may replace it.
  if (previousNumber === DECRYPTION_ERROR && number?.toLowerCase() === DECRYPTION_ERROR) {
    return { error: "The stored number can't be read. Re-enter it, or ask an administrator to check the encryption keys." }
  }
  const changed =
    upload !== null || previousNumber !== number || dateToYmd(existing.expiresAt) !== dateToYmd(expiresAt)
  if (!changed) return

  // The seen timestamp is part of the write predicate, so an edit or verify
  // committed between the read above and this write still makes it stale.
  const result = await prisma.personClearance.updateMany({
    where: { id: existing.id, updatedAt: seenAt as Date, ...LIVE_PERSON },
    data: {
      number: number ? encrypt(number) : null,
      expiresAt,
      ...docData,
      verifiedAt: null,
      verifiedById: null,
      verificationNote: null,
    },
  })
  if (result.count === 0) return { error: STALE_ERROR }
  await logAudit(actor, "CLEARANCE_UPDATED", "Person", personId, {
    type,
    documentReplaced: upload !== null,
    verificationCleared: existing.verifiedAt !== null,
  })
  revalidatePath(`/people/${personId}`)
}

/**
 * Mark a clearance Verified by the acting user, with an optional note (e.g.
 * "Checked on OCG portal"). The write is guarded on `seenUpdatedAt` — the
 * `updatedAt` the user saw when the page loaded — so verifying a row that was
 * edited since fails instead of vouching for new content.
 * @param clearanceId PersonClearance.id
 * @param seenUpdatedAt ISO `updatedAt` of the row as rendered (required)
 * @param note optional free text, max 500 chars, stored encrypted
 */
export async function verifyClearance(
  clearanceId: string,
  seenUpdatedAt: string,
  note?: string,
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const trimmed = (note ?? "").trim()
  if (trimmed.length > MAX_NOTE_LEN) return { error: `Note must be ${MAX_NOTE_LEN} characters or fewer.` }

  const seenAt = parseSeenUpdatedAt(seenUpdatedAt)
  if (!seenAt) return { error: STALE_ERROR }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  const actor = actorId(session)
  const result = await prisma.personClearance.updateMany({
    where: { id: row.id, updatedAt: seenAt, ...LIVE_PERSON },
    data: {
      verifiedAt: new Date(),
      verifiedById: actor,
      verificationNote: trimmed ? encrypt(trimmed) : null,
    },
  })
  if (result.count === 0) return { error: STALE_ERROR }

  await logAudit(actor, "CLEARANCE_VERIFIED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
    hasNote: trimmed.length > 0,
  })
  revalidatePath(`/people/${row.personId}`)
}

/**
 * Remove a clearance's verification (back to Unverified). Guarded on
 * `seenUpdatedAt` like verifyClearance so a stale page can't clobber a newer state.
 * @param clearanceId PersonClearance.id
 * @param seenUpdatedAt ISO `updatedAt` of the row as rendered (required)
 */
export async function unverifyClearance(clearanceId: string, seenUpdatedAt: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const seenAt = parseSeenUpdatedAt(seenUpdatedAt)
  if (!seenAt) return { error: STALE_ERROR }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  const result = await prisma.personClearance.updateMany({
    where: { id: row.id, updatedAt: seenAt, ...LIVE_PERSON },
    data: { verifiedAt: null, verifiedById: null, verificationNote: null },
  })
  if (result.count === 0) return { error: STALE_ERROR }
  await logAudit(actorId(session), "CLEARANCE_UNVERIFIED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
  })
  revalidatePath(`/people/${row.personId}`)
}

/**
 * Permanently delete a clearance row (document included). Guarded on
 * `seenUpdatedAt` like unverifyClearance, so a stale page's Remove can't delete
 * a row that was edited or verified since. The audit trail keeps the fact that
 * it existed.
 * @param clearanceId PersonClearance.id
 * @param seenUpdatedAt ISO `updatedAt` of the row as rendered (required)
 */
export async function deleteClearance(clearanceId: string, seenUpdatedAt: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const seenAt = parseSeenUpdatedAt(seenUpdatedAt)
  if (!seenAt) return { error: STALE_ERROR }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  const result = await prisma.personClearance.deleteMany({ where: { id: row.id, updatedAt: seenAt, ...LIVE_PERSON } })
  if (result.count === 0) return { error: STALE_ERROR }
  await logAudit(actorId(session), "CLEARANCE_REMOVED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
  })
  revalidatePath(`/people/${row.personId}`)
}

// Not exported: a "use server" module may only export async functions.

/** Thrown inside the bulk-verify transaction to roll it back when any row went stale. */
class StaleBatchError extends Error {}

/**
 * Marks many clearances verified in one step (the "Mark verified" button on the
 * WWCC batch helper). One optional note (for example the portal's status text)
 * is stored on every row. All-or-nothing: if any id is missing, archived, a WWCC
 * without a number, or was verified/archived since the page loaded, nothing is
 * written. Each item carries the `updatedAt` the admin saw; the update is
 * conditioned on it and on `verifiedAt: null` inside a transaction, so it can
 * never vouch for a number/expiry edited since, nor overwrite another verification.
 * Verification time and actor are recorded; one CLEARANCE_VERIFIED audit entry
 * is written per clearance actually updated.
 * @param items PersonClearance.id + ISO `updatedAt` as rendered (max 200)
 * @param note optional free text, max 500 chars, stored encrypted
 */
export async function verifyClearancesBulk(
  items: { id: string; seenUpdatedAt: string }[],
  note?: string,
): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  if (!Array.isArray(items) || items.length === 0) return { error: "Select at least one clearance" }
  if (items.length > BULK_VERIFY_MAX) return { error: `Select at most ${BULK_VERIFY_MAX} clearances at a time` }
  const seenById = new Map<string, Date>()
  for (const item of items) {
    const id = item?.id
    if (typeof id !== "string" || !CUID_ID_RE.test(id)) return { error: "Invalid selection" }
    const seenAt = parseSeenUpdatedAt(item.seenUpdatedAt)
    if (!seenAt) return { error: STALE_ERROR }
    seenById.set(id, seenAt)
  }
  const cleanNote = typeof note === "string" ? note.trim() : ""
  if (cleanNote.length > MAX_NOTE_LEN) return { error: `Note is too long (max ${MAX_NOTE_LEN} characters)` }

  const unique = [...seenById.keys()]
  const found = await prisma.personClearance.findMany({
    where: { id: { in: unique }, person: { archivedAt: null } },
    select: { id: true, personId: true, type: true, number: true },
  })
  if (found.length !== unique.length) return { error: "Some selected clearances no longer exist" }
  const noNumber = found.filter((c) => c.type === "WWCC" && !c.number)
  if (noNumber.length > 0) {
    return { error: `${noNumber.length} selected WWCC record(s) have no WWC number — add it before verifying` }
  }

  const actor = actorId(session)
  let count: number
  try {
    count = await prisma.$transaction(async (tx) => {
      const res = await tx.personClearance.updateMany({
        where: {
          OR: unique.map((id) => ({ id, updatedAt: seenById.get(id) as Date })),
          verifiedAt: null,
          ...LIVE_PERSON,
        },
        data: { verifiedAt: new Date(), verifiedById: actor, verificationNote: cleanNote ? encrypt(cleanNote) : null },
      })
      if (res.count !== unique.length) throw new StaleBatchError()
      return res.count
    })
  } catch (e) {
    if (e instanceof StaleBatchError) return { error: STALE_ERROR }
    throw e
  }
  // logAudit never throws (it logs and swallows), so concurrent writes cannot reject.
  await Promise.all(
    found.map((c) =>
      logAudit(actor, "CLEARANCE_VERIFIED", "Person", c.personId, { clearanceId: c.id, type: c.type, bulk: true, hasNote: cleanNote !== "" }),
    ),
  )
  revalidatePath("/people/clearances")
  for (const personId of new Set(found.map((c) => c.personId))) revalidatePath(`/people/${personId}`)
  return { success: `Marked ${count} clearance(s) verified` }
}
