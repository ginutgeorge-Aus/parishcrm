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
import { UserRole } from "@/lib/generated/prisma/enums"

import type { ActionResult } from "./types"

export type VolunteerTokenResult = { error: string } | { token: string | null }

// Enable → mint a token if none yet (idempotent: re-enabling keeps the link).
// Disable → null the token so the shared link 404s. canEdit-gated.
export async function setVolunteerView(id: number, enabled: boolean): Promise<VolunteerTokenResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid event" }

  const existing = await prisma.event.findUnique({
    where: { id },
    select: { id: true, volunteerToken: true },
  })
  if (!existing) return { error: "Event not found" }

  const token = enabled ? (existing.volunteerToken ?? generateVolunteerToken()) : null
  await prisma.event.update({ where: { id }, data: { volunteerToken: token } })
  await logAudit(actorId(session), enabled ? "VOLUNTEER_VIEW_ENABLED" : "VOLUNTEER_VIEW_DISABLED", "Event", id)
  revalidatePath(`/events/${id}/registrations`)
  return { token }
}

// Mint a fresh token, invalidating any previously-shared link. canEdit-gated.
export async function regenerateVolunteerToken(id: number): Promise<VolunteerTokenResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid event" }

  const existing = await prisma.event.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return { error: "Event not found" }

  const token = generateVolunteerToken()
  await prisma.event.update({ where: { id }, data: { volunteerToken: token } })
  await logAudit(actorId(session), "VOLUNTEER_VIEW_REGENERATED", "Event", id)
  revalidatePath(`/events/${id}/registrations`)
  return { token }
}

// Assign / unassign an EVENT_ORGANISER to an event. canEdit-gated. Idempotent:
// the unique (eventId,userId) makes a duplicate add a no-op via catch; remove
// uses deleteMany so a missing link is a silent success.
export async function addEventManager(eventId: number, userId: number): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
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

export async function removeEventManager(eventId: number, userId: number): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
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
