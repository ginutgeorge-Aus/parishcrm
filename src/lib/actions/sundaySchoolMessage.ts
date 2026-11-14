"use server"

// Sunday School parent email (OSS-14). Manual send only. Sending = canMarkRoll
// (managers + HEADMASTER on any class, an assigned TEACHER/EVENT_ORGANISER on
// their classes). The message, its PENDING recipient rows and the audit row
// commit in ONE transaction that also holds the class's year lock (withLiveClass),
// so a locked (rolled-over) or archived class is refused. Delivery runs after the
// response; the scheduler sweep retries anything left queued or failed.

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { featureGuard } from "@/lib/featureFlags"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { canManageSundaySchool, canMarkSomeSundaySchool } from "@/lib/roleGuard"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { selectParentRecipients } from "@/lib/sundaySchoolParents"
import { deliverSsMessage } from "@/lib/sundaySchoolMessageDeliver"
import { SS_MESSAGE_WINDOW_MS, SsMessageSchema } from "@/lib/sundaySchoolMessageSchema"
import { withLiveClass } from "@/lib/sundaySchoolYearLock"
import { isValidPgId } from "@/lib/validation"
import type { ActionResult } from "./types"

const UNAUTHORIZED = "Unauthorized"

/**
 * Email the parents (HEAD/SPOUSE, consenting, usable address, deduped) of the
 * selected children of a class. Guards: demo block, coarse role, feature on,
 * valid id, canMarkRoll, validated subject/body/children, at least one
 * reachable parent, one send per class per 5 minutes (checked last), then a
 * live, unlocked class inside the write transaction. On success redirects to
 * the compose page (dashboard or organiser portal) with `?sent=1`.
 * @param classId the class
 * @param _prev previous action state (useActionState)
 * @param formData `subject`, `body` and repeated `studentId`
 */
export async function sendSsParentMessage(classId: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  const role = session?.user?.role
  if (!session?.user || !canMarkSomeSundaySchool(role)) return { error: UNAUTHORIZED }
  const off = await featureGuard("sundaySchool")
  if (off) return off
  if (!isValidPgId(classId)) return { error: "Invalid class" }
  const userId = actorId(session)
  if (!(await canMarkRoll(userId, classId, role))) return { error: UNAUTHORIZED }

  const parsed = SsMessageSchema.safeParse({
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
    studentIds: formData.getAll("studentId").filter((v): v is string => typeof v === "string"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const { students, recipients, skipped } = await selectParentRecipients(classId, parsed.data.studentIds)
  if (students === 0) return { error: "Select at least one child in this class" }
  if (recipients.length === 0) return { error: "None of the selected children has a parent who can receive email" }

  const rateKey = `ss-message:${classId}`
  if (!(await dbRateLimit(rateKey, 1, SS_MESSAGE_WINDOW_MS))) {
    return { error: "A message was already sent for this class in the last 5 minutes. Please wait and try again." }
  }

  let result
  try {
    result = await withLiveClass(classId, async (tx) => {
      const msg = await tx.sundaySchoolMessage.create({
        data: { classId, sentById: userId, subject: parsed.data.subject, body: parsed.data.body },
        select: { id: true },
      })
      await tx.sundaySchoolMessageRecipient.createMany({ data: recipients.map((r) => ({ messageId: msg.id, personId: r.personId })) })
      await logAuditTx(tx, userId, "SS_PARENT_MESSAGE_SENT", "SundaySchoolClass", classId, {
        messageId: msg.id, students, recipients: recipients.length, skipped: skipped.length,
      })
      return msg.id
    })
  } catch (err) {
    // Nothing was queued: give the class its send slot back.
    await prisma.rateLimit.deleteMany({ where: { key: rateKey } }).catch(() => {})
    throw err
  }
  if (!result.live) {
    await prisma.rateLimit.deleteMany({ where: { key: rateKey } }).catch(() => {})
    return { error: result.error }
  }
  const messageId = result.value

  // Best-effort immediate drain, after the response; the sweep retries what is left.
  after(async () => {
    try {
      await deliverSsMessage(messageId)
    } catch (err) {
      logger.error(`[ssMessage] immediate drain failed for message ${messageId}: ${err instanceof Error ? err.name : "error"}`)
    }
  })

  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath(`/sunday-school/${classId}/message`)
  revalidatePath(`/my-classes/${classId}/message`)
  redirect(canManageSundaySchool(role) ? `/sunday-school/${classId}/message?sent=1` : `/my-classes/${classId}/message?sent=1`)
}
