import { accountOfStoredBankRef } from "../../src/lib/bankRefMask"
import { createBankRefHasher } from "../../src/lib/bankRefHash"
import { XFER_OUT_PREFIX } from "../../src/lib/xferRefs"

// Legacy (full account number) Transaction.bankRef detection for #459, shared
// by the `hash-bankref-account` backfill and the `audit-data-integrity` check
// so "what still needs hashing" can never drift between the two.

// Ref prefixes that can carry an account number (incl. the paired cash-out leg).
const SENSITIVE_PREFIXES = ["ANZ_", "ANZTR_", "OFX_"]
/** Stored bankRef prefixes a legacy (plaintext account number) ref can start with. */
export const CANDIDATE_PREFIXES = [...SENSITIVE_PREFIXES, ...SENSITIVE_PREFIXES.map((p) => `${XFER_OUT_PREFIX}${p}`)]

/** Minimal Transaction delegate surface the scans need (real Prisma or a test fake). */
export type FindManyDelegate = { findMany(args: unknown): Promise<unknown[]> }
type Row = { id: number; bankRef: string | null }

// One hasher per process: each account's keyed digest is derived once, not per row.
// Only legacy refs are hashed, so a database with none never needs the key.
const hasher = createBankRefHasher()

/**
 * The hashed bankRef a stored row should hold, or null when it needs no change
 * (already hashed, QIF, petty-cash, manual or null).
 *
 * @param bankRef - the stored value (null for unreferenced rows)
 * @returns the rewritten ref, or null
 */
export function planBankRefRewrite(bankRef: string | null): string | null {
  if (!bankRef) return null
  const hashed = hasher.stored(bankRef)
  return hashed === bankRef ? null : hashed
}

/**
 * Count Transaction rows whose bankRef still holds a plaintext account number
 * (key-free `accountOfStoredBankRef(...) !== null`, so no ENCRYPTION_KEY is needed), keyset-paginated over the candidate
 * prefixes. Read-only; never returns refs (they hold the account number).
 *
 * @param delegate - Transaction delegate
 * @param batchSize - rows read per page
 * @returns how many legacy rows remain and up to 5 of their ids
 */
export async function countLegacyBankRefs(
  delegate: FindManyDelegate,
  batchSize = 500,
): Promise<{ count: number; sampleIds: number[] }> {
  let count = 0
  const sampleIds: number[] = []
  let lastId = 0
  for (;;) {
    const rows = (await delegate.findMany({
      where: { id: { gt: lastId }, OR: CANDIDATE_PREFIXES.map((p) => ({ bankRef: { startsWith: p } })) },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, bankRef: true },
    })) as Row[]
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id
    for (const row of rows) {
      // Key-free predicate: the audit must work without ENCRYPTION_KEY.
      if (row.bankRef === null || accountOfStoredBankRef(row.bankRef) === null) continue
      count++
      if (sampleIds.length < 5) sampleIds.push(row.id)
    }
    if (rows.length < batchSize) break
  }
  return { count, sampleIds }
}
