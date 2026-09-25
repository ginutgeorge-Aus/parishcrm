"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { canEdit } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { actorId } from "@/lib/actor"
import type { ActionResult } from "./types"

export async function markWaitlistNotified(
  waitlistId: number,
  eventId: number,
  notified: boolean,
): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const row = await prisma.waitlist.findUnique({ where: { id: waitlistId }, select: { eventId: true } })
  if (!row || row.eventId !== eventId) return { error: "Waitlist entry not found" }

  // updateMany: a concurrent resetEventRegistrations can delete the row after
  // the read above; update() would throw P2025 out of the action.
  const res = await prisma.waitlist.updateMany({
    where: { id: waitlistId, eventId },
    data: { notifiedAt: notified ? new Date() : null },
  })
  if (res.count === 0) return { error: "Waitlist entry not found" }
  await logAudit(actorId(session), "WAITLIST_NOTIFIED", "Waitlist", waitlistId, { eventId })
  revalidatePath(`/events/${eventId}/waitlist`)
}
