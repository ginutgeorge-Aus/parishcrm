"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canManageFundraiser } from "@/lib/roleGuard"
import { featureGuard } from "@/lib/featureFlags"
import { assertNotDemo } from "@/lib/demoMode"
import { isValidPgId, MONEY_DECIMAL_RE } from "@/lib/validation"
import { toCents } from "@/lib/formatting"
import type { ActionResult } from "./types"

const MAX_NAME = 120
const MAX_LABEL = 40
const MAX_PREFIX = 12

/**
 * Create or update the fundraiser of one event (one per event). Changing the
 * unit price only affects entries created afterwards: entries snapshot the
 * price at creation.
 *
 * @param eventId - Event id.
 * @param input - Fundraiser settings; `unitPrice` is a 2-dp decimal string > 0.
 * @returns `{ error }` on failure, `undefined` on success.
 */
export async function saveFundraiser(
  eventId: number,
  input: { name: string; unitLabel: string; unitPrice: string; refPrefix?: string },
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user || !canManageFundraiser(session.user.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(eventId)) return { error: "Invalid event" }

  const name = input.name.trim()
  if (!name || name.length > MAX_NAME) return { error: "Name is required (max 120 characters)" }
  const unitLabel = input.unitLabel.trim()
  if (!unitLabel || unitLabel.length > MAX_LABEL) return { error: "Unit label is required (max 40 characters)" }
  const unitPrice = input.unitPrice.trim()
  if (!MONEY_DECIMAL_RE.test(unitPrice) || !(toCents(unitPrice) > 0)) {
    return { error: "Unit price must be a positive amount with at most 2 decimals" }
  }
  const refPrefix = (input.refPrefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_PREFIX) || null

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } })
  if (!event) return { error: "Event not found" }

  // Changing refPrefix does not alter bankRef values already issued to entries.
  const data = { name, unitLabel, unitPrice, refPrefix }
  const saved = await prisma.fundraiser.upsert({
    where: { eventId },
    create: { eventId, ...data },
    update: data,
    select: { id: true },
  })
  await logAudit(actorId(session), "FUNDRAISER_SAVE", "Fundraiser", saved.id, { eventId, unitPrice, unitLabel })
  revalidatePath(`/events/${eventId}/fundraiser`)
  revalidatePath("/events")
  return undefined
}
