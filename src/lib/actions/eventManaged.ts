"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canManageEvent } from "@/lib/eventManager"
import { featureGuard } from "@/lib/featureFlags"
import { syncEventToWebsite } from "@/lib/websiteSync"
import { isValidPgId, parseOptimisticUpdatedAt } from "@/lib/validation"
import { EventImageKind } from "@/lib/generated/prisma/enums"
import {
  STALE_EVENT,
  applyImageOp,
  managedEventData,
  parseImageUpload,
  parseManagedEventForm,
} from "./eventForm"
import type { ActionResult } from "./types"

/**
 * Equality for audit diffing: dates by instant, everything else by value with
 * `undefined` treated as `null`.
 *
 * @param a - Stored value.
 * @param b - New value.
 * @returns True when the two represent the same value.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return (a ?? null) === (b ?? null)
}

/**
 * Update the public details of one event. Allowed for editors and for an
 * EVENT_ORGANISER assigned to this event (`canManageEvent`). Writes only the
 * detail allowlist (`managedEventData` + organiser contacts + banner/poster);
 * money, publish, slug, registration settings and managers are never touched.
 *
 * @param id - Event id (bound from the route).
 * @param _prev - Previous action state (unused).
 * @param formData - Submitted details form.
 * @returns `{ error }` on failure; on success redirects to the edit page.
 */
export async function updateManagedEvent(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid event" }

  // IDOR gate first: an unassigned event is indistinguishable from a missing one.
  const userId = Number.parseInt(session.user.id, 10)
  if (!(await canManageEvent(userId, id, session.user.role))) return { error: "Unauthorized" }

  const existing = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true, slug: true, kind: true, title: true, description: true, category: true, date: true,
      endDate: true, recurs: true, recursLabel: true, startTime: true, location: true,
      organizers: true, registrationDeadline: true,
    },
  })
  if (!existing) return { error: "Event not found" }

  const result = parseManagedEventForm(formData, existing.kind === "recurring" ? "recurring" : "one_off")
  if ("error" in result) return { error: result.error }
  const { parsed, organizers } = result

  const banner = await parseImageUpload(formData, "banner")
  if ("error" in banner) return { error: banner.error }
  const poster = await parseImageUpload(formData, "poster")
  if ("error" in poster) return { error: poster.error }

  const data = managedEventData(parsed)

  // The registration deadline is staff-only, so an organiser moving the date
  // earlier could leave it after the event ends (EventSchema forbids that).
  const closesBy = data.endDate ?? data.date
  if (existing.registrationDeadline && closesBy && existing.registrationDeadline > closesBy) {
    return { error: "The event would end before its registration deadline. Ask an editor to change the deadline first." }
  }

  const seenAt = parseOptimisticUpdatedAt(formData)
  try {
    await prisma.$transaction(async (tx) => {
      const res = await tx.event.updateMany({
        where: seenAt ? { id, updatedAt: seenAt } : { id },
        // Empty array (not undefined) so removing every organiser persists —
        // same rationale as updateEvent.
        data: { ...data, organizers: organizers.length > 0 ? organizers : [] },
      })
      if (res.count === 0) throw new Error(STALE_EVENT)
      await applyImageOp(tx, id, EventImageKind.BANNER, banner)
      await applyImageOp(tx, id, EventImageKind.POSTER, poster)
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.message === STALE_EVENT) {
      return { error: "This event was changed by someone else since you opened it. Reload the page and reapply your edit." }
    }
    throw e
  }

  const fields = (Object.keys(data) as (keyof typeof data)[]).filter((k) => !sameValue(existing[k], data[k]))
  if (JSON.stringify(existing.organizers ?? []) !== JSON.stringify(organizers)) fields.push("organizers" as never)
  if (banner.op !== "skip") fields.push("banner" as never)
  if (poster.op !== "skip") fields.push("poster" as never)
  await logAudit(actorId(session), "EVENT_UPDATED", "Event", id, {
    slug: existing.slug,
    role: session.user.role,
    fields,
  })
  await syncEventToWebsite(id)
  revalidatePath(`/my-events/${id}/edit`)
  revalidatePath("/my-events")
  revalidatePath("/events")
  redirect(`/my-events/${id}/edit?saved=1`)
}
