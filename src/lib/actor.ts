import type { Session } from "next-auth"

/**
 * Validated numeric id of the authenticated actor (AUDIT-070).
 *
 * Replaces the `parseInt(session!.user!.id!, 10)` chain scattered across actions
 * and routes: the `!` suppressed a real TS gap — a session that passed a falsy-role
 * guard but carried no `id` would yield `NaN` silently into logAudit / rate-limit keys.
 * This throws instead, so the failure surfaces rather than corrupting an audit row.
 *
 * Call only after a role guard has confirmed an authenticated session.
 */
export function actorId(session: Session | null): number {
  const raw = session?.user?.id
  const id = raw ? parseInt(raw, 10) : NaN
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Authenticated session is missing a valid user id")
  }
  return id
}
