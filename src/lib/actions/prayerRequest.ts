"use server"

// Prayer requests (#305, #615). PO decision #611: private by default — only
// ADMIN + PASTOR (canManagePrayerRequests) create, read, edit and archive them.
// When the requester consents, staff tick "OK to share" (shareConsent); an
// ACTIVE shared request then appears in the bulletin list
// (listShareablePrayerRequests), readable by editors who prepare the bulletin.
// That list returns the request text and date only — never requester contact
// details. Staff-entered in this slice (source STAFF); the model also takes
// PUBLIC_FORM for the later public intake form (#702). The request text and
// requester contact are encrypted at rest; audit rows are written in the same
// transaction and carry ids/flags only.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { DECRYPTION_ERROR_PLACEHOLDER as DECRYPTION_ERROR } from "@/lib/cryptoCore"
import { PrayerRequestSource, PrayerRequestStatus } from "@/lib/generated/prisma/enums"
import type { Prisma } from "@/lib/generated/prisma/client"
import { PASTORAL_PATH } from "@/lib/pastoralAccess"
import { prisma } from "@/lib/prisma"
import { canManagePrayerRequests, canViewSharedPrayerRequests } from "@/lib/roleGuard"
import { isValidEmail, isValidPgId } from "@/lib/validation"
import type { ActionResultWithSuccess } from "./types"

const UNAUTHORIZED = "Unauthorized"
const NOT_FOUND = "Not found"
const REQUEST_MAX = 4000
const NAME_MAX = 120
const PHONE_MAX = 30
/** Hard cap on one list read (DoS bound; the UI pages within it). */
const LIST_MAX = 500
const STATUSES = new Set<string>(Object.values(PrayerRequestStatus))

/** Trimmed optional string, blank becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullish()
    .transform((v) => v || null)

/** Create/edit input. `shareConsent` = staff ticked "OK to share" with the requester's consent. */
const PrayerSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1, "Enter the prayer request")
    .max(REQUEST_MAX, `Request must be ${REQUEST_MAX} characters or fewer`),
  requesterName: optionalText(NAME_MAX, "Name"),
  requesterEmail: optionalText(254, "Email").refine((v) => v === null || isValidEmail(v), "Enter a valid email"),
  requesterPhone: optionalText(PHONE_MAX, "Phone"),
  personId: z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .nullish()
    .transform((v) => v ?? null),
  shareConsent: z.boolean().optional().default(false),
})

export type PrayerRequestInput = z.input<typeof PrayerSchema>
/**
 * Update input. Full replace: every key is required (null clears it), so a
 * caller that forgets a field can't silently wipe requester details.
 */
export type PrayerRequestUpdate = {
  request: string
  requesterName: string | null
  requesterEmail: string | null
  requesterPhone: string | null
  personId: number | null
  shareConsent: boolean
}
const UPDATE_KEYS = ["request", "requesterName", "requesterEmail", "requesterPhone", "personId", "shareConsent"] as const

/** A decrypted prayer request for the pastoral (private) views. */
export type PrayerRequestView = {
  id: number
  source: PrayerRequestSource
  status: PrayerRequestStatus
  request: string
  requesterName: string | null
  requesterEmail: string | null
  requesterPhone: string | null
  personId: number | null
  personName: string | null
  shareConsent: boolean
  shareConsentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** One bulletin-list entry: the request text and date only, no requester contact. */
export type SharedPrayerRequest = { id: number; request: string; createdAt: Date }

const VIEW_SELECT = {
  id: true,
  source: true,
  status: true,
  request: true,
  requesterName: true,
  requesterEmail: true,
  requesterPhone: true,
  personId: true,
  shareConsent: true,
  shareConsentAt: true,
  createdAt: true,
  updatedAt: true,
  person: { select: { firstName: true, lastName: true } },
} satisfies Prisma.PrayerRequestSelect

type ViewRow = Prisma.PrayerRequestGetPayload<{ select: typeof VIEW_SELECT }>

/**
 * Decrypt a nullable ciphertext column.
 * @param v stored value
 */
function dec(v: string | null): string | null {
  return v ? safeDecrypt(v) : null
}

/**
 * Decrypt and shape one prayer request row.
 * @param row selected row
 */
function toView(row: ViewRow): PrayerRequestView {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    request: safeDecrypt(row.request),
    requesterName: dec(row.requesterName),
    requesterEmail: dec(row.requesterEmail),
    requesterPhone: dec(row.requesterPhone),
    personId: row.personId,
    personName: row.person ? `${row.person.firstName} ${row.person.lastName}` : null,
    shareConsent: row.shareConsent,
    shareConsentAt: row.shareConsentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Null when `personId` is null or a live (non-archived) person, else an error.
 * @param personId optional linked member
 */
async function checkPerson(personId: number | null): Promise<string | null> {
  if (personId === null) return null
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { archivedAt: true } })
  return !p || p.archivedAt ? "Person not found" : null
}

/**
 * Record a staff-entered prayer request. ADMIN | PASTOR only. Private unless
 * `shareConsent` is true.
 * @param input request text, optional requester name/email/phone, linked personId, shareConsent
 * @returns the new id, or `{ error }`
 */
export async function createPrayerRequest(input: PrayerRequestInput): Promise<{ error: string } | { id: number }> {
  const session = await auth()
  if (!canManagePrayerRequests(session?.user?.role)) return { error: UNAUTHORIZED }
  const parsed = PrayerSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data
  const personError = await checkPerson(d.personId)
  if (personError) return { error: personError }

  const actor = actorId(session)
  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.prayerRequest.create({
      data: {
        source: PrayerRequestSource.STAFF,
        request: encrypt(d.request),
        requesterName: d.requesterName ? encrypt(d.requesterName) : null,
        requesterEmail: d.requesterEmail ? encrypt(d.requesterEmail) : null,
        requesterPhone: d.requesterPhone ? encrypt(d.requesterPhone) : null,
        personId: d.personId,
        shareConsent: d.shareConsent,
        shareConsentAt: d.shareConsent ? new Date() : null,
        shareConsentById: d.shareConsent ? actor : null,
        createdById: actor,
      },
      select: { id: true },
    })
    await logAuditTx(tx, actor, "PRAYER_REQUEST_CREATED", "PrayerRequest", created.id, {
      personId: d.personId,
      shareConsent: d.shareConsent,
    })
    return created.id
  })
  revalidatePath(PASTORAL_PATH)
  return { id }
}

/**
 * Edit a prayer request's text, requester details, linked person and "OK to
 * share" flag. ADMIN | PASTOR only. Ticking share stamps who/when; unticking
 * clears it. A stored value that can't be decrypted is never overwritten by
 * its own placeholder text.
 * @param id PrayerRequest.id
 * @param input same fields as create
 */
export async function updatePrayerRequest(id: number, input: PrayerRequestUpdate): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canManagePrayerRequests(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  if (typeof input !== "object" || input === null || !UPDATE_KEYS.every((k) => k in input)) {
    return { error: "Missing prayer request fields" }
  }
  const parsed = PrayerSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const existing = await prisma.prayerRequest.findUnique({
    where: { id },
    select: {
      request: true,
      requesterName: true,
      requesterEmail: true,
      requesterPhone: true,
      personId: true,
      shareConsent: true,
      updatedAt: true,
    },
  })
  if (!existing) return { error: NOT_FOUND }

  const data: Prisma.PrayerRequestUncheckedUpdateManyInput = {}
  const textFields = [
    ["request", existing.request, d.request],
    ["requesterName", existing.requesterName, d.requesterName],
    ["requesterEmail", existing.requesterEmail, d.requesterEmail],
    ["requesterPhone", existing.requesterPhone, d.requesterPhone],
  ] as const
  for (const [field, stored, next] of textFields) {
    const old = dec(stored)
    if (old === DECRYPTION_ERROR && next === DECRYPTION_ERROR) {
      return { error: "This request's stored text can't be read. Re-enter it, or ask an administrator to check the encryption keys." }
    }
    if (old === next) continue
    if (field === "request") data.request = encrypt(d.request)
    else data[field] = next ? encrypt(next) : null
  }
  if (existing.personId !== d.personId) {
    const personError = await checkPerson(d.personId)
    if (personError) return { error: personError }
    data.personId = d.personId
  }
  const actor = actorId(session)
  // Consent covers the wording the requester agreed to. A text edit on a shared
  // request withdraws it; staff re-tick "OK to share" in a later save once the
  // requester agrees to the new wording.
  const consentVoided = existing.shareConsent && data.request !== undefined
  const nextShare = consentVoided ? false : d.shareConsent
  const shareChanged = existing.shareConsent !== nextShare
  if (shareChanged) {
    data.shareConsent = nextShare
    data.shareConsentAt = nextShare ? new Date() : null
    data.shareConsentById = nextShare ? actor : null
  }
  if (Object.keys(data).length === 0) return { success: "No changes" }

  // updatedAt in the predicate: a concurrent edit between the read and this
  // write makes it stale instead of silently overwriting the other change.
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.prayerRequest.updateMany({ where: { id, updatedAt: existing.updatedAt }, data })
    if (r.count === 0) return false
    await logAuditTx(tx, actor, "PRAYER_REQUEST_UPDATED", "PrayerRequest", id, {
      fields: Object.keys(data).filter((k) => !k.startsWith("shareConsent")),
      ...(shareChanged ? { shareConsent: nextShare } : {}),
      ...(consentVoided ? { shareConsentVoided: true } : {}),
    })
    return true
  })
  if (!updated) return { error: "This request changed. Refresh and try again." }
  revalidatePath(PASTORAL_PATH)
  if (consentVoided) {
    return { success: "Saved. The wording changed, so it is private again: tick OK to share once the requester agrees." }
  }
  return { success: "Prayer request saved" }
}

/**
 * Set a prayer request's status: ARCHIVED to archive, ACTIVE to restore,
 * ANSWERED to mark it answered. ADMIN | PASTOR only. Only ACTIVE requests
 * appear in the bulletin list.
 * @param id PrayerRequest.id
 * @param status target status
 */
export async function setPrayerRequestStatus(id: number, status: PrayerRequestStatus): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canManagePrayerRequests(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(id) || !STATUSES.has(status)) return { error: NOT_FOUND }
  const existing = await prisma.prayerRequest.findUnique({ where: { id }, select: { status: true } })
  if (!existing) return { error: NOT_FOUND }
  if (existing.status === status) return { success: "No changes" }
  const actor = actorId(session)
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.prayerRequest.updateMany({ where: { id, status: existing.status }, data: { status } })
    if (r.count === 0) return false
    await logAuditTx(tx, actor, "PRAYER_REQUEST_STATUS_CHANGED", "PrayerRequest", id, { from: existing.status, to: status })
    return true
  })
  if (!updated) return { error: "This request changed. Refresh and try again." }
  revalidatePath(PASTORAL_PATH)
  return { success: "Status updated" }
}

/**
 * Archive a prayer request (shorthand for setPrayerRequestStatus ARCHIVED).
 * @param id PrayerRequest.id
 */
export async function archivePrayerRequest(id: number): Promise<ActionResultWithSuccess> {
  return setPrayerRequestStatus(id, PrayerRequestStatus.ARCHIVED)
}

/**
 * All prayer requests with full detail, newest first, capped at 500. ADMIN |
 * PASTOR only.
 * @param statuses only these statuses (default: ACTIVE; empty = none)
 */
export async function listPrayerRequests(
  statuses: PrayerRequestStatus[] = [PrayerRequestStatus.ACTIVE],
): Promise<{ error: string } | { requests: PrayerRequestView[] }> {
  const session = await auth()
  if (!canManagePrayerRequests(session?.user?.role)) return { error: UNAUTHORIZED }
  const wanted = statuses.filter((s) => STATUSES.has(s))
  // An empty or all-invalid filter matches nothing, never every status.
  if (wanted.length === 0) return { requests: [] }
  const rows = await prisma.prayerRequest.findMany({
    where: { status: { in: wanted } },
    select: VIEW_SELECT,
    orderBy: { createdAt: "desc" },
    take: LIST_MAX,
  })
  return { requests: rows.map(toView) }
}

/**
 * One prayer request with full detail. ADMIN | PASTOR only.
 * @param id PrayerRequest.id
 */
export async function getPrayerRequest(id: number): Promise<{ error: string } | { request: PrayerRequestView }> {
  const session = await auth()
  if (!canManagePrayerRequests(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  const row = await prisma.prayerRequest.findUnique({ where: { id }, select: VIEW_SELECT })
  if (!row) return { error: NOT_FOUND }
  return { request: toView(row) }
}

/**
 * Bulletin list: ACTIVE requests marked "OK to share", newest first, capped at
 * 500. Editors (ADMIN | PASTOR | OFFICE_ADMIN). Returns the request text and
 * date only — the requester's name and contact never leave the private views.
 */
export async function listShareablePrayerRequests(): Promise<{ error: string } | { requests: SharedPrayerRequest[] }> {
  const session = await auth()
  if (!canViewSharedPrayerRequests(session?.user?.role)) return { error: UNAUTHORIZED }
  const rows = await prisma.prayerRequest.findMany({
    where: { status: PrayerRequestStatus.ACTIVE, shareConsent: true },
    select: { id: true, request: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: LIST_MAX,
  })
  return {
    requests: rows
      .map((r) => ({ id: r.id, request: safeDecrypt(r.request), createdAt: r.createdAt }))
      // An unreadable row must never print its placeholder in a bulletin.
      .filter((r) => r.request !== DECRYPTION_ERROR),
  }
}
