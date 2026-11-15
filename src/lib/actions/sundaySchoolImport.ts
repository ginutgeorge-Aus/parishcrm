"use server"

// Sunday School enrolment CSV import (OSS-18). Both actions are
// canManageSundaySchool-gated (same as enrolChildren). Preview writes nothing;
// commit re-validates the same file inside one transaction, refuses if any row
// has an error, and audits with logAuditTx so the import rolls back with it.

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { featureGuard } from "@/lib/featureFlags"
import { prisma } from "@/lib/prisma"
import { canManageSundaySchool } from "@/lib/roleGuard"
import { isP2002, isP2034, MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { MAX_ENROL_BYTES } from "@/lib/sundaySchoolCsv"
import { applyEnrolmentPlan, planEnrolmentImport, type EnrolPlan, type EnrolPlanRow } from "@/lib/sundaySchoolImport"
import { holdYear, isYearLockedTx, lockLiveClass, lockStateError, YEAR_LOCKED } from "@/lib/sundaySchoolYearLock"

const PERSON_GONE = "A student was archived while importing — try again"
const HAS_ERRORS = "Fix the rows with errors first, then upload the file again"
const RETRY = "Someone else just changed these enrolments — try again"

/** Preview payload: plain data safe to send to the client. */
export type EnrolImportPreview = {
  rows: Array<Omit<EnrolPlanRow, "personId" | "classId">>
  parseErrors: EnrolPlan["parseErrors"]
  errorCount: number
}
export type EnrolPreviewResult = { error: string } | { preview: EnrolImportPreview }
export type EnrolCommitResult = { error: string } | { success: string }

type Guard = { error: string } | { session: Session | null; content: string }

/**
 * Demo block, feature check, manager role, year and file checks. Returns the
 * session and file text, or an error. Module-private ("use server").
 */
async function importGuard(year: number, formData: FormData): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageSundaySchool(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("sundaySchool")
  if (off) return off
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return { error: "Invalid school year" }
  const file = formData.get("file")
  if (!(file instanceof File)) return { error: "No file provided" }
  if (file.size > MAX_ENROL_BYTES) return { error: "File too large (max 1 MB)" }
  return { session, content: await file.text() }
}

/**
 * Validate an enrolment CSV against `year`'s classes and People and return a
 * per-row preview. Writes nothing. canManageSundaySchool-gated.
 * @param year school year (bound by the page)
 * @param formData holds the `file`
 */
export async function previewEnrolmentImport(year: number, formData: FormData): Promise<EnrolPreviewResult> {
  const g = await importGuard(year, formData)
  if ("error" in g) return { error: g.error }
  if (await prisma.sundaySchoolYearLock.findUnique({ where: { year }, select: { year: true } })) return { error: YEAR_LOCKED }
  const plan = await planEnrolmentImport(prisma, year, g.content)
  return {
    preview: {
      rows: plan.rows.map(({ personId: _p, classId: _c, ...r }) => r),
      parseErrors: plan.parseErrors,
      errorCount: plan.errorCount,
    },
  }
}

/**
 * Import the CSV in one transaction: year lock, class and person locks, then
 * all-or-nothing writes plus the audit row. Idempotent: rows already enrolled
 * in their class change nothing. canManageSundaySchool-gated.
 * @param year school year (bound by the page)
 * @param formData holds the `file` (the one previewed)
 */
export async function commitEnrolmentImport(year: number, formData: FormData): Promise<EnrolCommitResult> {
  const g = await importGuard(year, formData)
  if ("error" in g) return { error: g.error }
  try {
    const out = await prisma.$transaction(async (tx) => {
      await holdYear(tx, year, "shared")
      if (await isYearLockedTx(tx, year)) return { error: YEAR_LOCKED }
      const plan = await planEnrolmentImport(tx, year, g.content)
      if (plan.errorCount > 0) return { error: HAS_ERRORS }
      const classIds = [...new Set(plan.rows.flatMap((r) => (r.classId === undefined ? [] : [r.classId])))].sort((a, b) => a - b)
      // Archive-proof the classes (FOR SHARE) in ascending order, as enrolChildren does.
      for (const id of classIds) {
        const state = await lockLiveClass(tx, id)
        if (state !== "ok") return { error: lockStateError(state) }
      }
      const personIds = [...new Set(plan.rows.flatMap((r) => (r.personId === undefined ? [] : [r.personId])))]
      // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
      const live = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "Person" WHERE id = ANY(${personIds}) AND "archivedAt" IS NULL FOR SHARE`
      if (live.length !== personIds.length) return { error: PERSON_GONE }
      const done = await applyEnrolmentPlan(tx, year, plan)
      await logAuditTx(tx, actorId(g.session), "SS_ENROL_IMPORTED", "SundaySchoolClass", undefined, { year, rows: plan.rows.length, ...done, classIds })
      return { done, classIds }
      // Up to MAX_ENROL_ROWS rows, a few statements per class.
    }, { timeout: 60_000 })
    if (!out.done) return { error: out.error ?? RETRY }
    revalidatePath("/sunday-school")
    for (const id of out.classIds) revalidatePath(`/sunday-school/${id}`)
    const { enrolled, moved, unchanged } = out.done
    return { success: `Enrolled ${enrolled}, moved ${moved}, unchanged ${unchanged}` }
  } catch (e) {
    if (isP2002(e) || isP2034(e)) return { error: RETRY }
    throw e
  }
}
