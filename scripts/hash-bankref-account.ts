import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { createBankRefHasher } from "../src/lib/bankRefHash"
import { decrypt, keyIdOf } from "../src/lib/cryptoCore"
import { XFER_OUT_PREFIX, depositRefOfLeg, xferOutRef } from "../src/lib/xferRefs"
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
//   - refuses to --apply unless an existing v1-encrypted Transaction.description
//     decrypts with this run's key: hashing with the wrong ENCRYPTION_KEY_V1 is
//     irreversible (the number is gone) and would break every later dedup;
//   - every write is conditional on the bankRef that was read (like
//     rotate-encryption-key) and each write unit commits all-or-nothing, so a
//     row changed in between is re-read and retried instead of overwritten;
//   - a unique collision (a hashed twin of the same line already stored) is
//     skipped and reported, never merged — review it by hand;
//   - a deposit and its `XFER_OUT_` paired leg are always written in the same
//     transaction (even across batches), so a collision or crash never leaves
//     one hashed and the other legacy — `xferOutRef(deposit.bankRef)` lookups
//     (transfer picker, adoption guards) would silently stop pairing them;
//   - refs are never printed (they hold the account number) — only row ids,
//     and error text is scrubbed of refs before it is logged;
//   - the dry run also reports rows whose hashed form already exists.
// Needs the same ENCRYPTION_KEY(_V1) as the app: the hash is keyed. Once this
// has run, ENCRYPTION_KEY_V1 can never be retired — the stored hashes cannot
// be rebuilt from a new root (unlike emailHash, the plaintext is gone).

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

// Ref prefixes that can carry an account number (incl. the paired cash-out leg).
const SENSITIVE_PREFIXES = ["ANZ_", "ANZTR_", "OFX_"]
const CANDIDATE_PREFIXES = [...SENSITIVE_PREFIXES, ...SENSITIVE_PREFIXES.map((p) => `${XFER_OUT_PREFIX}${p}`)]
// Times a write unit whose rows changed between read and write is re-read and retried.
const MAX_CONFLICT_RETRIES = 3
// Oldest encrypted descriptions scanned for a v1 key-check canary.
const CANARY_SCAN = 100

type Row = { id: number; bankRef: string | null }
type Delegate = { findMany(args: unknown): Promise<unknown[]> }
type Write = { where: { id: number; bankRef: string | null }; data: { bankRef: string } }
/** Commits every write or none; throws StaleWriteError when a guarded write matched no row. */
type RunWrites = (writes: Write[]) => Promise<void>
type HashOpts = { delegate?: Delegate; runWrites?: RunWrites; apply?: boolean; batchSize?: number }
type Pending = { row: Row; next: string }
type HashResult = { changed: number; conflicts: number; collisions: number }
type Outcome = "written" | "resolved" | "collision" | "conflict"

/** A guarded write matched no row: the row changed (or vanished) since it was read. */
export class StaleWriteError extends Error {
  /** @param id - the row whose guarded write matched nothing */
  constructor(readonly id: number) {
    super(`Transaction #${id} changed since it was read`)
  }
}

let prismaClient: PrismaClient | undefined
/** Lazily-built Prisma client, so importing this module in tests never connects. */
function prisma(): PrismaClient {
  prismaClient ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  return prismaClient
}

/**
 * Production RunWrites: one interactive transaction that rolls back unless
 * every guarded write hits exactly one row.
 *
 * @param writes - guarded updateMany args
 */
async function prismaRunWrites(writes: Write[]): Promise<void> {
  await prisma().$transaction(async (tx) => {
    for (const w of writes) {
      const { count } = await tx.transaction.updateMany(w)
      if (count !== 1) throw new StaleWriteError(w.where.id)
    }
  })
}

// One hasher per run: each account's keyed digest is derived once, not per row.
const hasher = createBankRefHasher()

/**
 * The hashed bankRef a stored row should hold, or null when it needs no change.
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
 * Conditional write: only matches while the row still holds the value that was
 * read, so a concurrent change is never overwritten.
 *
 * @param p - the row as read and its hashed ref
 * @returns updateMany args
 */
function guardedWrite(p: Pending): Write {
  return { where: { id: p.row.id, bankRef: p.row.bankRef }, data: { bankRef: p.next } }
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(e: unknown): boolean {
  if ((e as { code?: unknown } | null)?.code === "P2002") return true
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("Unique constraint")
}

// A bankRef-shaped token (optionally an XFER_OUT_ leg) — scrubbed from logged errors.
const REF_IN_TEXT_RE = /(?:XFER_OUT_)?(?:ANZ|ANZTR|OFX|QIF)_[^\s'"`,)}\]]*/g

/**
 * Loggable text for an unexpected error with every bankRef scrubbed: a Prisma
 * error can echo a guarded write's `where`, i.e. the legacy ref holding the
 * account number.
 *
 * @param e - the thrown value
 * @returns `<code or name>: <scrubbed message>`
 */
export function safeErrorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  const label = typeof code === "string" ? code : e instanceof Error ? e.name : "Error"
  const msg = e instanceof Error ? e.message : String(e)
  return `${label}: ${msg.replace(REF_IN_TEXT_RE, "<bankRef>")}`
}

/**
 * Refuse to write unless this run's v1 key is the database's: a v1-encrypted
 * Transaction.description (oldest first) must decrypt. The bankRef hash is
 * keyed on the v1-derived blind-index key, and a wrong key would irreversibly
 * store hashes the app can never reproduce.
 *
 * @param delegate - Transaction delegate
 * @throws when no v1 canary exists or it fails to decrypt
 */
export async function assertV1KeyMatches(delegate: Delegate): Promise<void> {
  const rows = (await delegate.findMany({
    where: { description: { startsWith: "enc:" } },
    orderBy: { id: "asc" },
    take: CANARY_SCAN,
    select: { id: true, description: true },
  })) as { id: number; description: string | null }[]
  const canary = rows.find((r) => r.description !== null && keyIdOf(r.description) === "v1")
  if (!canary) {
    throw new Error(
      "Key check failed: no v1-encrypted Transaction.description found to verify ENCRYPTION_KEY(_V1) against — refusing to --apply.",
    )
  }
  try {
    decrypt(canary.description!)
  } catch {
    throw new Error(
      `Key check failed: Transaction #${canary.id} does not decrypt with this run's ENCRYPTION_KEY(_V1) — not the app's key. Refusing to --apply.`,
    )
  }
}

/**
 * The other half of a petty-cash pair: a deposit's `XFER_OUT_` leg, or a leg's
 * deposit. Most refs have none; the lookup then simply finds nothing.
 *
 * @param ref - a legacy stored bankRef
 * @returns the ref its paired row would hold
 */
function companionRef(ref: string): string {
  return ref.startsWith(XFER_OUT_PREFIX) ? depositRefOfLeg(ref) : xferOutRef(ref)
}

/**
 * Group a batch's pending rewrites into write units: a deposit and its
 * `XFER_OUT_` leg form one unit (the mate is fetched when it falls outside this
 * batch), everything else is a unit of one.
 *
 * @param pending - this batch's rows that need a rewrite
 * @param delegate - Transaction delegate (to fetch out-of-batch mates)
 * @returns units, each written all-or-nothing
 */
async function pairUnits(pending: Pending[], delegate: Delegate): Promise<Pending[][]> {
  const inBatch = new Map(pending.map((p) => [p.row.bankRef!, p]))
  const missing = [...new Set(pending.map((p) => companionRef(p.row.bankRef!)))].filter((r) => !inBatch.has(r))
  const outside = missing.length
    ? ((await delegate.findMany({ where: { bankRef: { in: missing } }, select: { id: true, bankRef: true } })) as Row[])
    : []
  const outsideByRef = new Map(
    outside.flatMap((row) => {
      const next = planBankRefRewrite(row.bankRef)
      return next === null ? [] : [[row.bankRef!, { row, next }] as const]
    }),
  )
  const used = new Set<number>()
  const units: Pending[][] = []
  for (const p of pending) {
    if (used.has(p.row.id)) continue
    used.add(p.row.id)
    const ref = companionRef(p.row.bankRef!)
    const mate = inBatch.get(ref) ?? outsideByRef.get(ref)
    if (mate && !used.has(mate.row.id)) {
      used.add(mate.row.id)
      units.push([p, mate])
    } else units.push([p])
  }
  return units
}

/**
 * Write one unit (a row, or a deposit + its leg) all-or-nothing. When a row in
 * it changed since it was read, the whole unit is re-read and retried, so a
 * pair is never left half-hashed.
 *
 * @param unit - the unit as read
 * @param ctx - delegate and runWrites
 * @returns the outcome — "written", "resolved" (nothing left to write),
 *   "collision" (a hashed form already exists) or "conflict" (kept changing) —
 *   and how many rows were written
 */
async function writeUnit(
  unit: Pending[],
  ctx: { delegate: Delegate; runWrites: RunWrites },
): Promise<{ outcome: Outcome; written: number }> {
  let current = unit
  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
    if (attempt > 0) {
      const ids = unit.map((p) => p.row.id)
      const fresh = (await ctx.delegate.findMany({ where: { id: { in: ids } }, select: { id: true, bankRef: true } })) as Row[]
      current = fresh.flatMap((row) => {
        const next = planBankRefRewrite(row.bankRef)
        return next === null ? [] : [{ row, next }]
      })
    }
    if (current.length === 0) return { outcome: "resolved", written: 0 }
    try {
      await ctx.runWrites(current.map(guardedWrite))
      return { outcome: "written", written: current.length }
    } catch (e) {
      if (isUniqueViolation(e)) return { outcome: "collision", written: 0 }
      if (!(e instanceof StaleWriteError)) throw e
    }
  }
  return { outcome: "conflict", written: 0 }
}

/**
 * Rewrite every legacy (full account number) Transaction.bankRef to the hashed
 * format. Keyset-paginated; each batch commits in one transaction, falling
 * back to per-unit writes (a deposit + its `XFER_OUT_` leg stay together) when
 * a row in it hit a unique collision or changed concurrently. Apply first runs
 * the v1 key check; the dry run also reports rows whose hashed form exists.
 *
 * @param opts - test seams: delegate, runWrites, apply (defaults from argv), batchSize
 * @returns rows (that would be) rewritten, rows left because they kept
 *   changing, and rows left because their hashed form (or their pair's) already exists
 */
export async function hashBankRefs(opts: HashOpts = {}): Promise<HashResult> {
  const delegate = opts.delegate ?? (prisma().transaction as unknown as Delegate)
  const runWrites = opts.runWrites ?? prismaRunWrites
  const apply = opts.apply ?? APPLY
  const batchSize = opts.batchSize ?? BATCH
  const result: HashResult = { changed: 0, conflicts: 0, collisions: 0 }
  if (apply) await assertV1KeyMatches(delegate)
  // A pair skipped in one batch is met again from its mate's batch — report each row once.
  const reported = new Set<number>()
  const report = (kind: "conflict" | "collision", id: number) => {
    if (reported.has(id)) return
    reported.add(id)
    if (kind === "conflict") {
      result.conflicts++
      console.warn(`Transaction #${id}: changed concurrently on ${MAX_CONFLICT_RETRIES} retries — skipped (re-run)`)
    } else {
      result.collisions++
      console.warn(`Transaction #${id}: its (or its paired leg's) hashed bankRef already exists on another row — skipped (review by hand)`)
    }
  }
  const ctx = { delegate, runWrites }
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
    const pending = rows.flatMap((row) => {
      const next = planBankRefRewrite(row.bankRef)
      return next === null ? [] : [{ row, next }]
    })
    if (!apply) {
      // Read-only collision pre-check: rows whose hashed form is already stored.
      const twins = pending.length
        ? ((await delegate.findMany({ where: { bankRef: { in: pending.map((p) => p.next) } }, select: { id: true, bankRef: true } })) as Row[])
        : []
      const taken = new Set(twins.map((t) => t.bankRef))
      for (const p of pending) {
        if (taken.has(p.next)) report("collision", p.row.id)
        else result.changed++
      }
    } else if (pending.length > 0) {
      const units = await pairUnits(pending, delegate)
      let batchCommitted = true
      try {
        await runWrites(units.flat().map(guardedWrite))
      } catch (e) {
        if (!isUniqueViolation(e) && !(e instanceof StaleWriteError)) throw e
        batchCommitted = false // the batch rolled back — write unit by unit
      }
      if (batchCommitted) result.changed += units.flat().length
      else {
        for (const unit of units) {
          const { outcome, written } = await writeUnit(unit, ctx)
          result.changed += written
          if (outcome === "collision" || outcome === "conflict") for (const p of unit) report(outcome, p.row.id)
        }
      }
    }
    if (rows.length < batchSize) break
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
    console.error(safeErrorText(e))
    await prisma().$disconnect()
    process.exit(1)
  })
}
