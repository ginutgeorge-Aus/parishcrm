"use server"

// Event access-delegation actions: sharing a token-gated volunteer view and
// assigning EVENT_ORGANISER accounts to an event. Split out of event.ts
// to keep the core CRUD module small — these are "who can see/manage this event"
// concerns, distinct from create/update/delete/publish.

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { canEdit } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { isValidPgId, isP2002 } from "@/lib/validation"
import { generateVolunteerToken } from "@/lib/volunteerToken"
import { hashToken } from "@/lib/tokenHash"
import { UserRole } from "@/lib/generated/prisma/enums"

import type { ActionResult } from "./types"
import { featureGuard } from "@/lib/featureFlags"

export type VolunteerTokenResult = { error: string } | { token: string | null }

/**
 * Enable → mint a fresh token and return it once (only a digest is stored); NOT idempotent: it errors
 * when a token already exists, so a stale tab cannot replace a live link. Disable → null the token so
 * the shared link 404s. canEdit-gated.
 * @param id event id
 * @param enabled true to turn the volunteer view on, false to turn it off
 */
export async function setVolunteerView(id: number, enabled: boolean): Promise<VolunteerTokenResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid event" }

  let token: string | null = null
  if (enabled) {
    // Only a digest is stored, so an existing link cannot be shown again: turning the view on mints a
    // fresh token and returns it once. Turning on when it is already on (a stale tab, or two
    // concurrent enables) would replace the live shared link, so the write is conditional on the
    // token still being null: the loser of a race gets the already-on error, not a second token.
    token = generateVolunteerToken()
    const { count } = await prisma.event.updateMany({ where: { id, volunteerToken: null }, data: { volunteerToken: hashToken(token) } })
    if (count === 0) {
      // Re-read the token: another editor may have turned the view off since the conditional write
      // missed. Never retry the write, that could undo their disable.
      const current = await prisma.event.findUnique({ where: { id }, select: { id: true, volunteerToken: true } })
      if (!current) return { error: "Event not found" }
      return { error: current.volunteerToken ? "Volunteer view is already on. Reload the page." : "Volunteer view changed in the meantime. Reload the page." }
    }
  } else {
    // One updateMany by id (no existence pre-check): a delete racing the write yields count 0 and
    // "Event not found", not a thrown P2025 shown as a retryable error.
    const { count } = await prisma.event.updateMany({ where: { id }, data: { volunteerToken: null } })
    if (count === 0) return { error: "Event not found" }
  }
  await logAudit(actorId(session), enabled ? "VOLUNTEER_VIEW_ENABLED" : "VOLUNTEER_VIEW_DISABLED", "Event", id)
  revalidatePath(`/events/${id}/registrations`)
  return { token }
}

/**
 * Mint a fresh token, invalidating any previously-shared link. Only while the view is on: the write
 * is conditional on a non-null token, so a stale tab cannot re-enable a link someone turned off.
 * canEdit-gated.
 * @param id event id
 */
export async function regenerateVolunteerToken(id: number): Promise<VolunteerTokenResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid event" }

  const token = generateVolunteerToken()
  const { count } = await prisma.event.updateMany({
    where: { id, volunteerToken: { not: null } },
    data: { volunteerToken: hashToken(token) },
  })
  if (count === 0) {
    // Re-read the token: another editor may have turned the view on since the conditional write
    // missed. Never retry, that would replace the link they just issued.
    const current = await prisma.event.findUnique({ where: { id }, select: { id: true, volunteerToken: true } })
    if (!current) return { error: "Event not found" }
    return { error: current.volunteerToken ? "Volunteer view changed in the meantime. Reload the page." : "Volunteer view is off. Reload the page." }
  }
  await logAudit(actorId(session), "VOLUNTEER_VIEW_REGENERATED", "Event", id)
  revalidatePath(`/events/${id}/registrations`)
  return { token }
}

/**
 * Assign / unassign an EVENT_ORGANISER to an event. canEdit-gated. Idempotent: the unique
 * (eventId,userId) makes a duplicate add a no-op via catch; remove uses deleteMany so a missing
 * link is a silent success.
 */
export async function addEventManager(eventId: number, userId: number): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(eventId) || !isValidPgId(userId)) return { error: "Invalid input" }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } })
  if (!event) return { error: "Event not found" }
  // findFirst (not findUnique) so we can exclude soft-deleted organisers
  // — an archived user must not be assignable even if its id is passed directly.
  const user = await prisma.user.findFirst({ where: { id: userId, archivedAt: null }, select: { id: true, role: true } })
  if (!user) return { error: "User not found" }
  if (user.role !== UserRole.EVENT_ORGANISER) return { error: "User is not an event organiser" }

  try {
    await prisma.eventManager.create({ data: { eventId, userId } })
  } catch (e) {
    // Duplicate assignment (unique eventId_userId) — treat as success.
    if (!isP2002(e)) throw e
  }
  await logAudit(actorId(session), "EVENT_MANAGER_ADDED", "Event", eventId, { targetUserId: userId })
  revalidatePath(`/events/${eventId}/registrations`)
}

/** Remove an organiser from an event. Editors only. */
export async function removeEventManager(eventId: number, userId: number): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(eventId) || !isValidPgId(userId)) return { error: "Invalid input" }

  await prisma.eventManager.deleteMany({ where: { eventId, userId } })
  await logAudit(actorId(session), "EVENT_MANAGER_REMOVED", "Event", eventId, { targetUserId: userId })
  revalidatePath(`/events/${eventId}/registrations`)
}

// EVENT_ORGANISER accounts available to assign. canEdit-gated (read).
export async function listAssignableOrganisers(): Promise<{ id: number; name: string; email: string }[]> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return []
  return prisma.user.findMany({
    where: { role: UserRole.EVENT_ORGANISER, archivedAt: null }, // exclude soft-deleted
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  })
}
