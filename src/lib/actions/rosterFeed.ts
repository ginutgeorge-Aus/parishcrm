"use server"

// Roster calendar feed link (#628, part of #306). Staff (canManageRoster)
// create or rotate a person's secret feed link. The plain token is returned
// once and never stored (only its hash is); rotating replaces the hash, so the
// old link stops working at once. Revoking = rotating and discarding the link.

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import { canManageRoster } from "@/lib/roleGuard"
import { hashRosterFeedToken, mintRosterFeedToken, rosterFeedUrl } from "@/lib/rosterFeed"
import { isP2002, isP2003, isValidPgId } from "@/lib/validation"

/**
 * Create or rotate a person's calendar feed link. The returned `url` is the
 * only time the secret is visible; the audit row carries no token.
 * @param personId the person the feed belongs to
 */
export async function rotateRosterFeedToken(personId: number): Promise<{ error: string } | { url: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageRoster(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  // Build the URL first: with no valid AUTH_URL there is nothing to hand back,
  // so refuse before rotating (rotating would kill the old link for nothing).
  const token = mintRosterFeedToken()
  const url = rosterFeedUrl(token)
  if (!url) return { error: "AUTH_URL is not set to a valid URL" }
  const tokenHash = hashRosterFeedToken(token)
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.rosterFeedToken.upsert({
        where: { personId },
        create: { personId, tokenHash },
        update: { tokenHash, createdAt: new Date() },
        select: { id: true },
      })
      await logAuditTx(tx, actorId(session), "ROSTER_FEED_TOKEN_ROTATED", "RosterFeedToken", row.id, { personId })
    })
  } catch (e) {
    if (isP2003(e)) return { error: "Person not found" }
    // A concurrent first-time create for the same person: ask the caller to retry.
    if (isP2002(e)) return { error: "Please try again" }
    throw e
  }
  revalidatePath(`/people/${personId}`)
  return { url }
}
