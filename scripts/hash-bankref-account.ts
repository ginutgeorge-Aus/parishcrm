import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { hashStoredBankRef } from "../src/lib/bankRefHash"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-off backfill for #459: imported Transaction.bankRef values (ANZ_/ANZTR_/
// OFX_, their `#n` split siblings and `XFER_OUT_` petty-cash paired legs) still
// embed the bank account number in plaintext. This rewrites each to the hashed
// at-rest format (`h<hmacBankAccount(acct)[0..16]>` in place of every
// occurrence; account number read from the ref's first segment), the same
// format new imports write.
//
//   npx tsx scripts/hash-bankref-account.ts                # dry run (default)
//   npx tsx scripts/hash-bankref-account.ts --apply --yes  # write
//
// Safe to run with the app live and to re-run:
//   - idempotent: hashed, QIF, petty-cash (PC_*) and manual refs are skipped;
//   - every write is conditional on the bankRef that was read (like
//     rotate-encryption-key), so a row changed in between is re-read and
//     retried instead of overwritten;
//   - a unique collision (a hashed twin of the same line already stored) is
//     skipped and reported, never merged — review it by hand;
//   - refs are never printed (they hold the account number) — only row ids.
// Needs the same ENCRYPTION_KEY(_V1) as the app: the hash is keyed.

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

// Ref prefixes that can carry an account number (incl. the paired cash-out leg).
const SENSITIVE_PREFIXES = ["ANZ_", "ANZTR_", "OFX_"]
const CANDIDATE_PREFIXES = [...SENSITIVE_PREFIXES, ...SENSITIVE_PREFIXES.map((p) => `XFER_OUT_${p}`)]
// Times a row that changed between read and write is re-read and retried.
const MAX_CONFLICT_RETRIES = 3

type Row = { id: number; bankRef: string | null }
type Delegate = {
  findMany(args: unknown): Promise<Row[]>
  updateMany(args: unknown): unknown
}
type HashOpts = { delegate?: Delegate; runTx?: (ops: unknown[]) => Promise<unknown>; apply?: boolean }
type HashResult = { changed: number; conflicts: number; collisions: number }

let prismaClient: PrismaClient | undefined
/** Lazily-built Prisma client, so importing this module in tests never connects. */
function prisma(): PrismaClient {
  prismaClient ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  return prismaClient
}

/**
 * The hashed bankRef a stored row should hold, or null when it needs no change.
 *
 * @param bankRef - the stored value (null for unreferenced rows)
 * @returns the rewritten ref, or null
 */
export function planBankRefRewrite(bankRef: string | null): string | null {
  if (!bankRef) return null
  const hashed = hashStoredBankRef(bankRef)
  return hashed === bankRef ? null : hashed
}

/**
 * Conditional write: only matches while the row still holds the value that was
 * read, so a concurrent change is never overwritten.
 *
 * @param row - the row as read
 * @param next - its hashed ref
 * @returns updateMany args
 */
function guardedWrite(row: Row, next: string) {
  return { where: { id: row.id, bankRef: row.bankRef }, data: { bankRef: next } }
}

/** Affected-row count of one updateMany result (0 for an unexpected shape). */
function countOf(res: unknown): number {
  const count = (res as { count?: unknown } | undefined)?.count
  return typeof count === "number" ? count : 0
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(e: unknown): boolean {
  if ((e as { code?: unknown } | null)?.code === "P2002") return true
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("Unique constraint")
}

/**
 * Write one row on its own, re-reading and retrying when it changed since it
 * was read.
 *
 * @returns "written", "resolved" (gone, or no longer legacy), "collision" (its
 *   hashed form already exists on another row) or "conflict" (kept changing)
 */
async function writeOne(
  row: Row,
  ctx: { delegate: Delegate; runTx: (ops: unknown[]) => Promise<unknown> },
): Promise<"written" | "resolved" | "collision" | "conflict"> {
  let current: Row | undefined = row
  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
    if (attempt > 0) [current] = await ctx.delegate.findMany({ where: { id: row.id }, take: 1, select: { id: true, bankRef: true } })
    const next = current ? planBankRefRewrite(current.bankRef) : null
    if (!current || next === null) return "resolved"
    try {
      const res = (await ctx.runTx([ctx.delegate.updateMany(guardedWrite(current, next))])) as unknown[] | undefined
      if (countOf(res?.[0]) === 1) return "written"
    } catch (e) {
      if (isUniqueViolation(e)) return "collision"
      throw e
    }
  }
  return "conflict"
}

/**
 * Rewrite every legacy (full account number) Transaction.bankRef to the hashed
 * format. Keyset-paginated; each batch commits in one transaction, falling
 * back to per-row writes when a row in it hit a unique collision or changed
 * concurrently.
 *
 * @param opts - test seams: delegate, runTx, apply (defaults from argv)
 * @returns rows (that would be) rewritten, rows left because they kept
 *   changing, and rows left because their hashed form already exists
 */
export async function hashBankRefs(opts: HashOpts = {}): Promise<HashResult> {
  const delegate = opts.delegate ?? (prisma().transaction as unknown as Delegate)
  const runTx = opts.runTx ?? ((ops: unknown[]) => prisma().$transaction(ops as never))
  const apply = opts.apply ?? APPLY
  const result: HashResult = { changed: 0, conflicts: 0, collisions: 0 }
  const tally = (outcome: Awaited<ReturnType<typeof writeOne>>, id: number) => {
    if (outcome === "written") result.changed++
    else if (outcome === "conflict") {
      result.conflicts++
      console.warn(`Transaction #${id}: changed concurrently on ${MAX_CONFLICT_RETRIES} retries — skipped (re-run)`)
    } else if (outcome === "collision") {
      result.collisions++
      console.warn(`Transaction #${id}: its hashed bankRef already exists on another row — skipped (review by hand)`)
    }
  }
  let lastId = 0
  for (;;) {
    const rows = await delegate.findMany({
      where: { id: { gt: lastId }, OR: CANDIDATE_PREFIXES.map((p) => ({ bankRef: { startsWith: p } })) },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, bankRef: true },
    })
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id
    const pending = rows.flatMap((row) => {
      const next = planBankRefRewrite(row.bankRef)
      return next === null ? [] : [{ row, next }]
    })
    if (!apply) {
      result.changed += pending.length
    } else if (pending.length > 0) {
      let results: unknown[] | null
      try {
        results = ((await runTx(pending.map((p) => delegate.updateMany(guardedWrite(p.row, p.next))))) as unknown[]) ?? []
      } catch (e) {
        if (!isUniqueViolation(e)) throw e
        results = null // the batch rolled back — write row by row to isolate the collision
      }
      for (let i = 0; i < pending.length; i++) {
        if (results && countOf(results[i]) === 1) result.changed++
        else tally(await writeOne(pending[i].row, { delegate, runTx }), pending[i].row.id)
      }
    }
    if (rows.length < BATCH) break
  }
  console.log(
    `Transaction.bankRef: ${result.changed} row(s) ${apply ? "hashed" : "would be hashed"}` +
      (result.conflicts ? `, ${result.conflicts} skipped (kept changing)` : "") +
      (result.collisions ? `, ${result.collisions} skipped (hashed twin exists)` : ""),
  )
  return result
}

/** CLI entry: dry run unless `--apply --yes`; non-zero exit when any row was skipped. */
async function main() {
  console.log(`Hashing account numbers in Transaction.bankRef — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma().$disconnect())
  const { conflicts, collisions } = await hashBankRefs()
  console.log(APPLY ? "Done. Re-run (dry run) to confirm 0 rows remain." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma().$disconnect()
  if (conflicts > 0 || collisions > 0) process.exit(1)
}

// Jest sets NODE_ENV=test; skip the auto-run so the module can be imported.
if (process.env.NODE_ENV !== "test") {
  main().catch(async (e) => {
    console.error(e)
    await prisma().$disconnect()
    process.exit(1)
  })
}
