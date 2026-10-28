import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { hmacEmail } from "@/lib/crypto"
import { logger } from "@/lib/logger"
import { logAudit } from "@/lib/audit"
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
  .refine((v) => !isDemoEmail(v), DEMO_DOMAIN_RESERVED)

/**
 * Result of a user email lookup. `ambiguous` is true when two or more
 * case-variant rows match and no single account can be chosen.
 */
export type EmailLookup = {
  user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> | null
  ambiguous: boolean
}

/**
 * Find a user by email, tolerating legacy mixed-case rows. `User.email` is
 * unique only case-sensitively, so `Admin@x.com` and `admin@x.com` can coexist,
 * and a legacy account may exist only in mixed case (no lowercase twin).
 * Order: (1) exact match on the trimmed RAW input (case preserved, unique
 * index) so a mixed-case-only account still logs in; (2) if the lower-cased
 * form differs, exact match on it (unique index); (3) only on a double miss,
 * `lower(email) = lower($input)` via a raw query. Raw SQL is used instead of
 * Prisma's `mode: "insensitive"` because that compiles to ILIKE, so `_` and `%`
 * in the input would act as wildcards. Fallback matches are ids only (LIMIT 2);
 * exactly one is accepted, two or more is ambiguous and yields no user, and an
 * `AUTH_EMAIL_AMBIGUOUS` audit row (truncated keyed HMAC of the normalised
 * email via `hmacEmail`, no raw address) is written so locked-out twin pairs
 * can be found. The fallback compares both sides with Postgres' own lower() (JS
 * and Postgres can differ on non-ASCII case folding). Input longer than 254
 * chars (the schema max) returns no user without touching the DB.
 * @param email raw email input (any case, surrounding whitespace allowed)
 * @returns the user (or null) and whether the match was ambiguous
 */
export async function findUserByEmailInsensitive(email: string): Promise<EmailLookup> {
  const trimmed = email.trim()
  const normalized = normalizeEmail(email)
  if (!normalized || normalized.length > 254) return { user: null, ambiguous: false }
  const exactRaw = await prisma.user.findUnique({ where: { email: trimmed } })
  if (exactRaw) return { user: exactRaw, ambiguous: false }
  if (normalized !== trimmed) {
    const exact = await prisma.user.findUnique({ where: { email: normalized } })
    if (exact) return { user: exact, ambiguous: false }
  }
  // nosemgrep: crm-no-raw-sql — lower() equality; Prisma mode:"insensitive" is ILIKE and treats _ and % as wildcards
  const rows = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM "User" WHERE lower(email) = lower(${trimmed}) LIMIT 2`
  if (rows.length > 1) {
    const emailHash = hmacEmail(normalized).slice(0, 16)
    logger.warn("email lookup ambiguous", { reason: "ambiguous_email_case", emailHash })
    await logAudit(null, "AUTH_EMAIL_AMBIGUOUS", "User", undefined, { emailHash })
    return { user: null, ambiguous: true }
  }
  if (rows.length === 0) return { user: null, ambiguous: false }
  const user = await prisma.user.findUnique({ where: { id: rows[0].id } })
  return { user, ambiguous: false }
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
