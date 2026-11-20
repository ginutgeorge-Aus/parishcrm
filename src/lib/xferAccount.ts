import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client"
import { logger } from "@/lib/logger"

type Client = PrismaClient | Prisma.TransactionClient

/** Code of the internal-transfer clearing account. Transfer legs on it are neither income nor expense. */
export const XFER_CODE = "XFER"

/**
 * Transaction where-fragment that excludes internal-transfer legs. Add it to every
 * Transaction aggregate / giving query so a new report can't forget the clearing account.
 */
export const NOT_XFER = { account: { code: { not: XFER_CODE } } } as const

/**
 * Read-only lookup of the XFER account id — never creates it (safe for GET renders).
 * @param client Prisma client or transaction client
 * @returns the account id, or null when XFER hasn't been created yet
 */
export async function findXferAccountId(client: Client): Promise<number | null> {
  const existing = await client.account.findUnique({ where: { code: XFER_CODE }, select: { id: true } })
  return existing?.id ?? null
}

// Resolve (or lazily create) the petty-cash / bank internal-transfer account.
// XFER is pre-seeded by `npm run db:seed`; self-heal-create with a warning if a
// given DB hasn't been seeded. Inactive + EXPENSE so it stays out of the P&L
// category picker. Shared by the bank-import confirm route and session transfers
// so both legs of an internal transfer post to the same account.
export async function getXferAccountId(client: Client): Promise<number> {
  const existing = await client.account.findUnique({ where: { code: XFER_CODE }, select: { id: true } })
  if (existing) return existing.id
  logger.warn("[xfer] XFER account missing — creating it; run `npm run db:seed` to pre-seed it")
  // Self-heal via upsert (INSERT … ON CONFLICT), not create-then-catch-P2002: a
  // concurrent self-heal resolves to the existing row without
  // raising a constraint error. Catching P2002 and re-querying breaks when
  // `client` is a Prisma.TransactionClient — Postgres aborts the whole
  // transaction on the violation (25P02), so the recovery read fails too.
  const acct = await client.account.upsert({
    where: { code: XFER_CODE },
    update: {},
    create: { code: XFER_CODE, name: "Internal Transfer", type: "EXPENSE", isActive: false },
    select: { id: true },
  })
  return acct.id
}
