"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { canEditOrOrganise } from "@/lib/roleGuard"
import { canManageEvent } from "@/lib/eventManager"
import { featureGuard } from "@/lib/featureFlags"
import { assertNotDemo } from "@/lib/demoMode"
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
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user || !canEditOrOrganise(session.user.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid event" }

  // Coarse role gate above (before the feature check); this is the per-event
  // IDOR gate. First: an unassigned event is indistinguishable from a missing one.
  const userId = actorId(session)
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
  // Only checked when the organiser actually changes the date/endDate, so a
  // legacy-bad stored combination doesn't block unrelated (e.g. title) edits.
  const closesBy = data.endDate ?? data.date
  const datesChanged = !sameValue(existing.date, data.date) || !sameValue(existing.endDate, data.endDate)
  if (datesChanged && existing.registrationDeadline && closesBy && existing.registrationDeadline > closesBy) {
    return { error: "The event would end before its registration deadline. Ask an editor to change the deadline first." }
  }

  const seenAt = parseOptimisticUpdatedAt(formData)
  if (!seenAt) return { error: "This form is out of date. Reload the page and try again." }

  const fields: string[] = (Object.keys(data) as (keyof typeof data)[]).filter((k) => !sameValue(existing[k], data[k]))
  if (JSON.stringify(existing.organizers ?? []) !== JSON.stringify(organizers)) fields.push("organizers")
  if (banner.op !== "skip") fields.push("banner")
  if (poster.op !== "skip") fields.push("poster")

  // No-op save: skip the write so it neither bumps updatedAt (which would
  // stale other open forms) nor writes an empty audit row or website sync.
  if (fields.length === 0) redirect(`/my-events/${id}/edit?saved=1`)

  try {
    await prisma.$transaction(async (tx) => {
      const res = await tx.event.updateMany({
        where: { id, updatedAt: seenAt },
        // Empty array (not undefined) so removing every organiser persists —
        // same rationale as updateEvent.
        data: { ...data, organizers: organizers.length > 0 ? organizers : [] },
      })
      if (res.count === 0) throw new Error(STALE_EVENT)
      await applyImageOp(tx, id, EventImageKind.BANNER, banner)
      await applyImageOp(tx, id, EventImageKind.POSTER, poster)
      await logAuditTx(tx, actorId(session), "EVENT_UPDATED", "Event", id, {
        slug: existing.slug,
        role: session.user.role,
        fields,
      })
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.message === STALE_EVENT) {
      return { error: "This event was changed by someone else since you opened it. Reload the page and reapply your edit." }
    }
    throw e
  }

  await syncEventToWebsite(id)
  revalidatePath(`/my-events/${id}/edit`)
  revalidatePath("/my-events")
  revalidatePath("/events")
  redirect(`/my-events/${id}/edit?saved=1`)
}
