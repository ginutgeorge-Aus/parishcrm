"use server"

// Service headcount attendance (OSS-308) writes. Enter/edit/delete =
// canEditAttendance (ADMIN | PASTOR | OFFICE_ADMIN). One row per service date +
// service type: saving the same pair edits it (upsert, with a P2002 retry for a
// concurrent create). The audit row is written inside the same transaction.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { sydneyTodayYMD } from "@/lib/dates"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import { canEditAttendance } from "@/lib/roleGuard"
import { getHeadcountByKey, type RecentHeadcount } from "@/lib/attendanceQueries"
import { isP2002, isValidPgId } from "@/lib/validation"
import { isValidYMD, utcDateToYmd, ymdToUtcDate } from "@/lib/venueUsage"
import { MAX_COUNT } from "@/lib/attendance"
import type { ActionResult } from "./types"

const UNAUTHORIZED = "Unauthorized"
/** Earliest accepted service date; guards against typo years like 0026. */
const MIN_DATE = "2000-01-01"

const count = z.number().int().min(0).max(MAX_COUNT)

/** Input shape for {@link saveHeadcount}. Validated server-side; the date must be within 2000-01-01..today. */
const SaveSchema = z.object({
  date: z.string().refine(isValidYMD, "Enter a valid date"),
  serviceTypeId: z.number().int().positive(),
  adults: count,
  children: count,
  notes: z.string().trim().max(500, "Notes are too long").optional(),
})

/**
 * True for Prisma's "record to update/delete not found" error.
 * @param e the caught error
 */
function isP2025(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2025"
}

/**
 * Look up the recorded headcount for a service date + type (entry-form pre-fill).
 * Attendance editors only. Returns `{ row: null }` when none is recorded.
 * @param date service date, YYYY-MM-DD
 * @param serviceTypeId service type id
 */
export async function getHeadcount(
  date: string,
  serviceTypeId: number,
): Promise<{ row: RecentHeadcount | null } | { error: string }> {
  const session = await auth()
  if (!canEditAttendance(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidYMD(date) || !isValidPgId(serviceTypeId)) return { row: null }
  return { row: await getHeadcountByKey(date, serviceTypeId) }
}

/**
 * Record (or edit) the headcount for a service date + service type. Allowed for
 * attendance editors; blocked in demo mode. Rejects future dates (Sydney today), dates before 2000,
 * unknown/inactive service types and non-integer or out-of-range counts.
 * @param input date (YYYY-MM-DD), service type id, adults, children, optional notes
 */
export async function saveHeadcount(input: {
  date: string
  serviceTypeId: number
  adults: number
  children: number
  notes?: string
}): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEditAttendance(session?.user?.role)) return { error: UNAUTHORIZED }

  const parsed = SaveSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { date, serviceTypeId, adults, children } = parsed.data
  const notes = parsed.data.notes || null
  if (date < MIN_DATE) return { error: "Date cannot be before 2000" }
  if (date > sydneyTodayYMD()) return { error: "Date cannot be in the future" }

  const type = await prisma.serviceType.findUnique({ where: { id: serviceTypeId } })
  if (!type) return { error: "Service type not found" }
  if (!type.isActive) return { error: "Service type is inactive" }

  const userId = actorId(session)
  const serviceDate = ymdToUtcDate(date)
  const key = { serviceDate_serviceTypeId: { serviceDate, serviceTypeId } }
  // Notes are free text (may hold personal details) and the audit log is append-only,
  // so only log THAT notes changed, never their content.
  const meta = { date, serviceTypeId, adults, children }
  const fields = { adults, children, notes }

  const write = (mode: "upsert" | "update") =>
    prisma.$transaction(async (tx) => {
      // Keep the values this save replaces, so an overwrite is recoverable from the audit log.
      const prior = await tx.serviceHeadcount.findUnique({
        where: key,
        select: { adults: true, children: true, notes: true },
      })
      const row =
        mode === "upsert"
          ? await tx.serviceHeadcount.upsert({
              where: key,
              create: { serviceDate, serviceTypeId, ...fields, createdById: userId },
              update: fields,
              select: { id: true },
            })
          : await tx.serviceHeadcount.update({ where: key, data: fields, select: { id: true } })
      await logAuditTx(
        tx,
        userId,
        "ATTENDANCE_SAVED",
        "ServiceHeadcount",
        row.id,
        prior
          ? {
              ...meta,
              before: { adults: prior.adults, children: prior.children },
              notesChanged: (prior.notes ?? null) !== notes,
            }
          : { ...meta, notesChanged: notes !== null },
      )
    })

  try {
    await write("upsert")
  } catch (e) {
    // A concurrent create of the same date + type lost the race: the row now
    // exists, so apply this save as an edit instead of surfacing the violation.
    if (!isP2002(e)) throw e
    try {
      await write("update")
    } catch (e2) {
      // The row was deleted between the failed create and this edit: ask for a re-save.
      if (isP2025(e2)) return { error: "That headcount was deleted while saving. Please save again." }
      throw e2
    }
  }
  revalidatePath("/attendance")
  revalidatePath("/")
}

/**
 * Delete one headcount (that week becomes a gap in the charts). Allowed for
 * attendance editors; blocked in demo mode.
 * @param id the ServiceHeadcount id
 */
export async function deleteHeadcount(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEditAttendance(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(id)) return { error: "Invalid ID" }

  const userId = actorId(session)
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.serviceHeadcount.delete({ where: { id } })
      await logAuditTx(tx, userId, "ATTENDANCE_DELETED", "ServiceHeadcount", id, {
        date: utcDateToYmd(row.serviceDate),
        serviceTypeId: row.serviceTypeId,
        adults: row.adults,
        children: row.children,
      })
    })
  } catch (e) {
    if (isP2025(e)) {
      return { error: "Headcount not found" }
    }
    throw e
  }
  revalidatePath("/attendance")
  revalidatePath("/")
}
