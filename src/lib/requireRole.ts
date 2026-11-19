import type { Session } from "next-auth"
import { auth } from "@/auth"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { actorId } from "@/lib/actor"

/** Result of a failed `requireRole` check; same shape as `ActionResult`'s error arm. */
export type RoleDenied = { error: "Unauthorized" }

/** Result of a passed `requireRole` check. */
export type RoleGranted = { session: Session; actor: number }

/**
 * Server Action role gate: one call replaces the hand-written
 * `const session = await auth(); if (!canX(session?.user?.role)) return { error: "Unauthorized" }`.
 * Use: `const gate = await requireRole(canEdit); if ("error" in gate) return gate`.
 * Behaviour matches the hand-written form: a missing session or role is denied
 * (predicates treat `undefined` as no access). On success it also resolves the
 * validated numeric actor id via `actorId`, which throws if the id is invalid.
 * @param predicate a roleGuard helper such as `canEdit`
 * @returns `{ session, actor }` when allowed, else `{ error: "Unauthorized" }`
 */
export async function requireRole(
  predicate: (role: UserRole | undefined) => boolean,
): Promise<RoleGranted | RoleDenied> {
  const session = await auth()
  if (!session || !predicate(session.user?.role)) return { error: "Unauthorized" }
  return { session, actor: actorId(session) }
}
