import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { Prisma, User } from "@/lib/generated/prisma/client"
import { userIdByEmailSql } from "@/lib/userEmailSql"
import { isDemoEmail, DEMO_DOMAIN_RESERVED } from "@/lib/demoMode"

/**
 * Canonical form of an email for storage and lookup: trimmed and lower-cased.
 * @param email raw email input
 * @returns the normalised email
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Shared zod field for a user email: trimmed, lower-cased, valid, <= 254 chars,
 * and not on the reserved demo domain. Use it in every schema that writes
 * `User.email` so storage and login lookups agree.
 */
export const userEmailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email")
  .max(254, "Email is too long")
  .refine((v) => !isDemoEmail(v), { error: DEMO_DOMAIN_RESERVED })

/**
 * Find a user by email, tolerating legacy mixed-case rows. A unique index on
 * `lower(email)` (`User_email_lower_key`) guarantees at most one row matches
 * case-insensitively, but pre-existing rows keep their stored case (e.g.
 * `Admin@x.com`), so lookups must match across case. One indexed
 * `lower(email) = lower($input)` query resolves the id (see
 * {@link userIdByEmailSql}), then the row is loaded by primary key — so a miss
 * costs a single query whatever the input's case. Input longer than 254 chars
 * (the schema max) or blank returns no user without touching the DB.
 * @param email raw email input (any case, surrounding whitespace allowed)
 * @param select optional Prisma `select` so callers load only the columns they use (default: full row)
 * @returns the user (or the `select` payload), or null when none matches
 */
export async function findUserByEmailInsensitive(email: string): Promise<User | null>
export async function findUserByEmailInsensitive<S extends Prisma.UserSelect>(
  email: string,
  select: S,
): Promise<Prisma.UserGetPayload<{ select: S }> | null>
export async function findUserByEmailInsensitive(
  email: string,
  select?: Prisma.UserSelect,
): Promise<object | null> {
  const trimmed = email.trim()
  if (!trimmed || trimmed.length > 254) return null
  // nosemgrep: crm-no-raw-sql — lower() equality via the shared fragment; Prisma mode:"insensitive" is ILIKE (wildcards)
  const rows = await prisma.$queryRaw<{ id: number }[]>(userIdByEmailSql(trimmed))
  if (rows.length === 0) return null
  return prisma.user.findUnique({ where: { id: rows[0].id }, ...(select && { select }) })
}

/**
 * Whether any user other than `excludeId` already holds this email, compared
 * case-insensitively and without wildcard semantics (see
 * {@link userIdByEmailSql}).
 * @param email raw email input
 * @param excludeId user id to ignore (the user being edited), if any
 * @returns true when another row matches
 */
export async function isEmailTaken(email: string, excludeId?: number): Promise<boolean> {
  // nosemgrep: crm-no-raw-sql — lower() equality via the shared fragment; Prisma mode:"insensitive" is ILIKE (wildcards)
  const rows = await prisma.$queryRaw<{ id: number }[]>(userIdByEmailSql(email.trim(), excludeId))
  return rows.length > 0
}
