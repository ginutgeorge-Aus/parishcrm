import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client"
import { logger } from "@/lib/logger"

type Client = PrismaClient | Prisma.TransactionClient

// Resolve (or lazily create) the petty-cash / bank internal-transfer account.
// XFER is pre-seeded by `npm run db:seed`; self-heal-create with a warning if a
// given DB hasn't been seeded. Inactive + EXPENSE so it stays out of the P&L
// category picker. Shared by the bank-import confirm route and session transfers
// so both legs of an internal transfer post to the same account.
export async function getXferAccountId(client: Client): Promise<number> {
  const existing = await client.account.findUnique({ where: { code: "XFER" }, select: { id: true } })
  if (existing) return existing.id
  logger.warn("[xfer] XFER account missing — creating it; run `npm run db:seed` to pre-seed it")
  // Self-heal via upsert (INSERT … ON CONFLICT), not create-then-catch-P2002: a
  // concurrent self-heal resolves to the existing row without
  // raising a constraint error. Catching P2002 and re-querying breaks when
  // `client` is a Prisma.TransactionClient — Postgres aborts the whole
  // transaction on the violation (25P02), so the recovery read fails too.
  const acct = await client.account.upsert({
    where: { code: "XFER" },
    update: {},
    create: { code: "XFER", name: "Internal Transfer", type: "EXPENSE", isActive: false },
    select: { id: true },
  })
  return acct.id
}
