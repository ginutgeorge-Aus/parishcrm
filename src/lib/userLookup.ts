import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
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
 * Result of a user email lookup.
 */
export type EmailLookup = {
  user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> | null
}

/**
 * Find a user by email, tolerating legacy mixed-case rows. A unique index on
 * `lower(email)` (`User_email_lower_key`) guarantees at most one row matches
 * case-insensitively, but pre-existing rows keep their stored case (e.g.
 * `Admin@x.com`), so lookups must still match across case.
 * Order: (1) exact match on the trimmed RAW input (case preserved, unique
 * index); (2) if the lower-cased form differs, exact match on it; (3) only on a
 * double miss, a single `lower(email) = lower($input)` raw query. Raw SQL is
 * used instead of Prisma's `mode: "insensitive"` because that compiles to
 * ILIKE, so `_` and `%` in the input would act as wildcards. The fallback
 * compares both sides with Postgres' own lower() (JS and Postgres can differ on
 * non-ASCII case folding). Input longer than 254 chars (the schema max) returns
 * no user without touching the DB.
 * @param email raw email input (any case, surrounding whitespace allowed)
 * @param select optional Prisma `select` so callers load only the columns they use (default: full row)
 * @returns the user, or null when none matches
 */
export async function findUserByEmailInsensitive(email: string): Promise<EmailLookup>
export async function findUserByEmailInsensitive<S extends Prisma.UserSelect>(
  email: string,
  select: S,
): Promise<{ user: Prisma.UserGetPayload<{ select: S }> | null }>
export async function findUserByEmailInsensitive(email: string, select?: Prisma.UserSelect): Promise<{ user: unknown }> {
  const trimmed = email.trim()
  const normalized = normalizeEmail(email)
  if (!normalized || normalized.length > 254) return { user: null }
  const exactRaw = await prisma.user.findUnique({ where: { email: trimmed }, ...(select && { select }) })
  if (exactRaw) return { user: exactRaw }
  if (normalized !== trimmed) {
    const exact = await prisma.user.findUnique({ where: { email: normalized }, ...(select && { select }) })
    if (exact) return { user: exact }
  }
  // nosemgrep: crm-no-raw-sql — lower() equality; Prisma mode:"insensitive" is ILIKE and treats _ and % as wildcards
  const rows = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM "User" WHERE lower(email) = lower(${trimmed}) LIMIT 1`
  if (rows.length === 0) return { user: null }
  const user = await prisma.user.findUnique({ where: { id: rows[0].id }, ...(select && { select }) })
  return { user: user }
}

/**
 * Whether any user other than `excludeId` already holds this email, compared
 * case-insensitively and without wildcard semantics (see
 * {@link findUserByEmailInsensitive}).
 * @param email raw email input
 * @param excludeId user id to ignore (the user being edited), if any
 * @returns true when another row matches
 */
export async function isEmailTaken(email: string, excludeId?: number): Promise<boolean> {
  const trimmed = email.trim()
  if (excludeId === undefined) {
    // nosemgrep: crm-no-raw-sql — lower() equality; Prisma mode:"insensitive" is ILIKE and treats _ and % as wildcards
    const rows = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM "User" WHERE lower(email) = lower(${trimmed}) LIMIT 1`
    return rows.length > 0
  }
  // nosemgrep: crm-no-raw-sql — lower() equality; Prisma mode:"insensitive" is ILIKE and treats _ and % as wildcards
  const rows = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM "User" WHERE lower(email) = lower(${trimmed}) AND id <> ${excludeId} LIMIT 1`
  return rows.length > 0
}
