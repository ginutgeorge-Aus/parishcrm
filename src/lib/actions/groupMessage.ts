"use server"

// Group email (#303). Sending = canManageGroupMembers: group managers on any
// group, a linked EVENT_ORGANISER only on their own groups (role re-checked in
// canManageGroupMembers). The message, its PENDING recipient rows and the audit
// row commit in ONE transaction; delivery happens afterwards and its failure
// never rolls the queued message back (the scheduler sweep retries).

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { canEditOrOrganise, canManageGroups } from "@/lib/roleGuard"
import { canManageGroupMembers } from "@/lib/groupAccess"
import { selectRecipients } from "@/lib/groupRecipients"
import { deliverGroupMessage } from "@/lib/groupMessageDeliver"
import { GROUP_MESSAGE_WINDOW_MS, GroupMessageSchema } from "@/lib/groups"
import { isValidPgId } from "@/lib/validation"
import type { ActionResult } from "./types"

const UNAUTHORIZED = "Unauthorized"

/**
 * Send a plain-text email to a group's consenting members with an address.
 * Guards: demo block, coarse role, valid id, per-group access (see header),
 * live group, validated subject/body, at least one recipient, then one send per
 * group per 5 minutes (checked last so a refused send does not burn the slot).
 * On success redirects to the group's message history (organiser portal for an
 * organiser, dashboard otherwise).
 * @param groupId the group to email
 * @param _prev previous action state (useActionState)
 * @param formData `subject` and `body`
 */
export async function sendGroupMessage(groupId: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  const role = session?.user?.role
  if (!canEditOrOrganise(role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(groupId)) return { error: "Invalid group" }
  const userId = actorId(session)
  if (!(await canManageGroupMembers(userId, groupId, role))) return { error: UNAUTHORIZED }

  const parsed = GroupMessageSchema.safeParse({ subject: formData.get("subject") ?? "", body: formData.get("body") ?? "" })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const group = await prisma.group.findFirst({ where: { id: groupId, archivedAt: null }, select: { id: true } })
  if (!group) return { error: "Group not found" }

  const { recipients, skipped } = await selectRecipients(groupId)
  if (recipients.length === 0) return { error: "No members can receive email: every member is opted out or has no address" }

  if (!(await dbRateLimit(`group-message:${groupId}`, 1, GROUP_MESSAGE_WINDOW_MS))) {
    return { error: "A message was already sent to this group in the last 5 minutes. Please wait and try again." }
  }

  let messageId: number
  try {
    messageId = await prisma.$transaction(async (tx) => {
      const msg = await tx.groupMessage.create({
        data: { groupId, sentById: userId, subject: parsed.data.subject, body: parsed.data.body },
        select: { id: true },
      })
      await tx.groupMessageRecipient.createMany({ data: recipients.map((r) => ({ messageId: msg.id, personId: r.personId })) })
      await logAuditTx(tx, userId, "GROUP_MESSAGE_SENT", "Group", groupId, {
        messageId: msg.id, recipients: recipients.length, skipped: skipped.length,
      })
      return msg.id
    })
  } catch (err) {
    // Nothing was queued: give the group its send slot back so a transient DB error does not block it for 5 minutes.
    await prisma.rateLimit.deleteMany({ where: { key: `group-message:${groupId}` } }).catch(() => {})
    throw err
  }

  // Best-effort immediate drain, after the response. A failure leaves the rows
  // PENDING/FAILED for the scheduler sweep; it never undoes the committed message.
  after(async () => {
    try {
      await deliverGroupMessage(messageId)
    } catch (err) {
      logger.error(`[groupMessage] immediate drain failed for message ${messageId}: ${err instanceof Error ? err.message : "error"}`)
    }
  })

  revalidatePath(`/groups/${groupId}/messages`)
  revalidatePath(`/my-groups/${groupId}/messages`)
  redirect(canManageGroups(role) ? `/groups/${groupId}/messages` : `/my-groups/${groupId}/messages`)
}
