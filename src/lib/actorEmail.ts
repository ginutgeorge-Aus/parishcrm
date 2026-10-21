import type { Session } from "next-auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"

/**
 * Email address of the authenticated actor, read from the DB (#369).
 *
 * The jwt callback in `src/auth.ts` strips `email` from the token, so
 * `session.user.email` is always undefined. Never read it; resolve the
 * address here by the session's user id instead.
 *
 * Returns null when there is no session user id, the user is gone or archived,
 * or it has no email.
 */
export async function actorEmail(session: Session | null): Promise<string | null> {
  if (!session?.user?.id) return null
  const user = await prisma.user.findUnique({ where: { id: actorId(session), archivedAt: null }, select: { email: true } })
  return user?.email || null
}
