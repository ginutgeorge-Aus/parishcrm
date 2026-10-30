import { Prisma } from "./generated/prisma/client"

/**
 * Raw SQL that finds the id of the user whose email matches `email`
 * case-insensitively: `lower(email) = lower($1)`, served by the
 * `User_email_lower_key` expression index. Raw SQL instead of Prisma's
 * `mode: "insensitive"`, which compiles to ILIKE and would treat `_` and `%` in
 * the input as wildcards; Postgres' own lower() folds both sides, so JS and
 * Postgres can't disagree on non-ASCII case folding.
 *
 * Shared by the app (`src/lib/userLookup.ts`) and `scripts/create-admin-user.ts`
 * so every lookup applies the same rule. Uses a relative import (no `@/`
 * alias, no prisma singleton) so the standalone script can import it.
 * @param email email to match (bound as a parameter, never interpolated)
 * @param excludeId user id to ignore (the user being edited), if any
 * @returns a `Prisma.Sql` for `$queryRaw` yielding `{ id }[]` (at most one row)
 */
export function userIdByEmailSql(email: string, excludeId?: number): Prisma.Sql {
  const exclude = excludeId === undefined ? Prisma.empty : Prisma.sql` AND id <> ${excludeId}`
  return Prisma.sql`SELECT id FROM "User" WHERE lower(email) = lower(${email})${exclude} LIMIT 1`
}
