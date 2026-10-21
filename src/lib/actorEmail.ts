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
 *
 * @public Kept exported: the crm-no-session-user-email semgrep rule points
 * callers here, though today only testSendRecipient uses it.
 */
export async function actorEmail(session: Session | null): Promise<string | null> {
  if (!session?.user?.id) return null
  const user = await prisma.user.findUnique({ where: { id: actorId(session), archivedAt: null }, select: { email: true } })
  return user?.email || null
}

/**
 * Resolve the actor's address as the recipient of a settings test send (#379).
 *
 * The lookup gets its own catch so a DB failure reports a lookup problem
 * rather than the caller's "check email configuration" send error.
 */
export async function testSendRecipient(session: Session | null): Promise<{ to: string } | { error: string }> {
  let to: string | null
  try {
    to = await actorEmail(session)
  } catch {
    return { error: "Couldn't look up your email address — try again" }
  }
  return to ? { to } : { error: "Your account has no email address" }
}
