"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canEditSacraments, canViewSacraments } from "@/lib/roleGuard"
import { AuditWriteError, auditWriteFailedResult, logAuditGuardedTx } from "@/lib/auditGuard"
import { decryptOrNull, encryptOrNull } from "@/lib/nullableCrypto"
import { sydneyTodayYMD, utcYmd } from "@/lib/dates"
import { isP2002, isP2003, isP2034, isValidPgId, parseOptimisticUpdatedAt } from "@/lib/validation"
import { logger } from "@/lib/logger"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { SacramentType } from "@/lib/generated/prisma/enums"
import {
  SacramentCreateSchema,
  SacramentFieldsSchema,
  checkSacramentRules,
  formatRegisterNo,
  ymdToUtcDate,
  type SacramentFields,
} from "@/lib/sacraments"
import type { ActionResultWithSuccess } from "./types"

// Sacramental register entries (#606/#607, decisions in #605). ADMIN | PASTOR
// create/edit/delete (canEditSacraments); OFFICE_ADMIN may only read
// (canViewSacraments). The rite and the person are fixed once an entry is
// numbered; a wrong rite or person is fixed by deleting and re-entering.
// spouseName, godparents and notes are encrypted at rest; audit metadata never
// carries them. Every mutation writes its audit row in the same transaction.

const LIST_PATH = "/sacraments"
const MAX_ATTEMPTS = 3
const BUSY_ERROR = "Another change was saved at the same time. Please try again."
const STALE_ERROR = "This record changed since you opened it. Refresh and try again."
const NOT_FOUND = "Record not found."

/** Result of createSacramentRecord: the new entry's id and register number, or an error. */
export type SacramentCreateResult = { error: string } | { id: number; registerNo: string }

/** Decrypted register entry for the view/print pages. */
export type SacramentRecordView = {
  id: number
  type: SacramentType
  registerNo: string
  date: string
  place: string
  ministerName: string | null
  person: { id: number; firstName: string; lastName: string }
  spouse: { id: number; firstName: string; lastName: string } | null
  spouseName: string | null
  godparents: string | null
  notes: string | null
  updatedAt: string
}

/**
 * String-valued form fields as a plain object (File entries dropped), for Zod.
 * @param formData submitted form
 */
function formFields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v
  return out
}

/**
 * Encrypted column values for the free-text PII fields.
 * @param f parsed editable fields
 */
function encryptedFields(f: SacramentFields) {
  return {
    spouseName: encryptOrNull(f.spouseName ?? ""),
    godparents: encryptOrNull(f.godparents ?? ""),
    notes: encryptOrNull(f.notes ?? ""),
  }
}

/**
 * Check, inside the write transaction, that a CRM person exists. Archived people
 * are allowed: the register is permanent and old paper entries are transcribed
 * for people who have since moved away or died.
 * @param tx transaction client
 * @param id Person.id
 */
async function personExists(tx: Prisma.TransactionClient, id: number): Promise<boolean> {
  return (await tx.person.findUnique({ where: { id }, select: { id: true } })) !== null
}

/**
 * Revalidate the register list and the people pages that show an entry.
 * @param personIds people linked to the entry (person and CRM spouse)
 */
function revalidateSacramentPaths(personIds: (number | null)[]): void {
  revalidatePath(LIST_PATH)
  for (const id of personIds) if (id !== null) revalidatePath(`/people/${id}`)
}

/**
 * Create a register entry and assign its number (ADMIN | PASTOR). The number is
 * per rite per calendar year of the rite date (`BAP-2026-014`), taken from
 * SacramentCounter by an atomic upsert-increment in the insert's transaction:
 * concurrent creates queue on the counter row lock, so each gets the next
 * number, and a rolled-back create releases its number with it. A lost race on
 * the counter's first insert of the year (P2002) or a write conflict retries.
 * Form fields: type, personId, date (YYYY-MM-DD), place, ministerName,
 * spouseId / spouseName (marriage only), godparents, notes.
 * @param _prev previous action state (useActionState)
 * @param formData submitted form
 */
export async function createSacramentRecord(
  _prev: SacramentCreateResult | undefined,
  formData: FormData,
): Promise<SacramentCreateResult> {
  const session = await auth()
  if (!canEditSacraments(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = SacramentCreateSchema.safeParse(formFields(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { type, personId, ...f } = parsed.data
  const ruleError = checkSacramentRules(type, personId, f, sydneyTodayYMD())
  if (ruleError) return { error: ruleError }

  const uid = actorId(session)
  const date = ymdToUtcDate(f.date)
  const year = date.getUTCFullYear()
  const enc = encryptedFields(f)

  for (let attempt = 1; ; attempt++) {
    try {
      const out = await prisma.$transaction(async (tx): Promise<SacramentCreateResult> => {
        if (!(await personExists(tx, personId))) return { error: "Person not found." }
        if (f.spouseId !== null && !(await personExists(tx, f.spouseId))) return { error: "Spouse not found." }
        const counter = await tx.sacramentCounter.upsert({
          where: { type_year: { type, year } },
          create: { type, year, lastSeq: 1 },
          update: { lastSeq: { increment: 1 } },
          select: { lastSeq: true },
        })
        const seq = counter.lastSeq
        const registerNo = formatRegisterNo(type, year, seq)
        const row = await tx.sacramentRecord.create({
          data: {
            type,
            year,
            seq,
            registerNo,
            personId,
            date,
            place: f.place,
            ministerName: f.ministerName,
            spouseId: f.spouseId,
            ...enc,
            createdById: uid,
          },
          select: { id: true },
        })
        await logAuditGuardedTx(tx, uid, "SACRAMENT_RECORD_CREATED", "SacramentRecord", row.id, {
          registerNo,
          type,
          personId,
          spouseId: f.spouseId,
        })
        return { id: row.id, registerNo }
      })
      if ("id" in out) revalidateSacramentPaths([personId, f.spouseId])
      return out
    } catch (e) {
      if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "createSacramentRecord")
      // Person or spouse deleted between the check and the insert.
      if (isP2003(e)) return { error: "Person not found." }
      if ((isP2002(e) || isP2034(e)) && attempt < MAX_ATTEMPTS) continue
      if (isP2002(e) || isP2034(e)) return { error: BUSY_ERROR }
      logger.error("createSacramentRecord failed", { name: e instanceof Error ? e.name : typeof e })
      throw e
    }
  }
}

/**
 * Edit a register entry's details (ADMIN | PASTOR). The rite, person and register
 * number are fixed; the date may change only within the numbered year. An
 * `updatedAt` hidden field, when sent, guards against overwriting a newer save.
 * @param id SacramentRecord.id
 * @param _prev previous action state (useActionState)
 * @param formData submitted form (same fields as create, minus type/personId)
 */
export async function updateSacramentRecord(
  id: number,
  _prev: ActionResultWithSuccess,
  formData: FormData,
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEditSacraments(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  const parsed = SacramentFieldsSchema.safeParse(formFields(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const f = parsed.data
  const seenAt = parseOptimisticUpdatedAt(formData)

  const existing = await prisma.sacramentRecord.findUnique({
    where: { id },
    select: { type: true, year: true, personId: true, spouseId: true, registerNo: true },
  })
  if (!existing) return { error: NOT_FOUND }
  const ruleError = checkSacramentRules(existing.type, existing.personId, f, sydneyTodayYMD())
  if (ruleError) return { error: ruleError }
  const date = ymdToUtcDate(f.date)
  if (date.getUTCFullYear() !== existing.year) {
    return { error: `${existing.registerNo} is numbered in ${existing.year}; the date must stay in that year.` }
  }

  const uid = actorId(session)
  const enc = encryptedFields(f)
  let result: ActionResultWithSuccess
  try {
    result = await prisma.$transaction(async (tx): Promise<ActionResultWithSuccess> => {
      if (f.spouseId !== null && f.spouseId !== existing.spouseId && !(await personExists(tx, f.spouseId))) {
        return { error: "Spouse not found." }
      }
      // type + personId in the predicate: the rules above were checked against them.
      const res = await tx.sacramentRecord.updateMany({
        where: { id, type: existing.type, personId: existing.personId, ...(seenAt ? { updatedAt: seenAt } : {}) },
        data: { date, place: f.place, ministerName: f.ministerName, spouseId: f.spouseId, ...enc },
      })
      if (res.count === 0) return { error: seenAt ? STALE_ERROR : NOT_FOUND }
      await logAuditGuardedTx(tx, uid, "SACRAMENT_RECORD_UPDATED", "SacramentRecord", id, {
        registerNo: existing.registerNo,
        type: existing.type,
        personId: existing.personId,
        spouseId: f.spouseId,
      })
      return { success: `${existing.registerNo} saved.` }
    })
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "updateSacramentRecord")
    if (isP2003(e)) return { error: "Spouse not found." }
    if (isP2034(e)) return { error: BUSY_ERROR }
    throw e
  }
  if (result && "success" in result) revalidateSacramentPaths([existing.personId, existing.spouseId, f.spouseId])
  return result
}

/**
 * Delete a register entry (ADMIN | PASTOR). Its number is not reused: the counter
 * only moves forward. The audit row keeps the register number and rite.
 * @param id SacramentRecord.id
 */
export async function deleteSacramentRecord(id: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEditSacraments(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  const existing = await prisma.sacramentRecord.findUnique({
    where: { id },
    select: { type: true, registerNo: true, personId: true, spouseId: true },
  })
  if (!existing) return { error: NOT_FOUND }

  const uid = actorId(session)
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const res = await tx.sacramentRecord.deleteMany({ where: { id } })
      if (res.count === 0) return false
      await logAuditGuardedTx(tx, uid, "SACRAMENT_RECORD_DELETED", "SacramentRecord", id, {
        registerNo: existing.registerNo,
        type: existing.type,
        personId: existing.personId,
      })
      return true
    })
    if (!deleted) return { error: NOT_FOUND }
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "deleteSacramentRecord")
    if (isP2034(e)) return { error: BUSY_ERROR }
    throw e
  }
  revalidateSacramentPaths([existing.personId, existing.spouseId])
  return { success: `${existing.registerNo} deleted.` }
}

/**
 * Load one register entry, decrypted, for viewing or printing (ADMIN | PASTOR |
 * OFFICE_ADMIN). Returns `{ error }` for other roles and null when not found.
 * @param id SacramentRecord.id
 */
export async function getSacramentRecord(id: number): Promise<SacramentRecordView | null | { error: string }> {
  const session = await auth()
  if (!canViewSacraments(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return null
  const row = await prisma.sacramentRecord.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      registerNo: true,
      date: true,
      place: true,
      ministerName: true,
      spouseName: true,
      godparents: true,
      notes: true,
      updatedAt: true,
      person: { select: { id: true, firstName: true, lastName: true } },
      spouse: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    registerNo: row.registerNo,
    date: utcYmd(row.date),
    place: row.place,
    ministerName: row.ministerName,
    person: row.person,
    spouse: row.spouse,
    spouseName: decryptOrNull(row.spouseName),
    godparents: decryptOrNull(row.godparents),
    notes: decryptOrNull(row.notes),
    updatedAt: row.updatedAt.toISOString(),
  }
}
