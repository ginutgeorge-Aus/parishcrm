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
 * Call only after a role guard has confirmed an authenticated session.
 * Returns null when the user row is gone or has no email.
 */
export async function actorEmail(session: Session | null): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: actorId(session) }, select: { email: true } })
  return user?.email || null
}
