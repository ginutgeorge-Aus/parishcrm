import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt, hmacSuburb } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for OSS-39: Family.suburbHash is the HMAC blind index of
// the (decrypted, normalised) suburb, used by the families-list suburb filter
// instead of decrypting every candidate row. This populates it for families
// written before the column existed. Idempotent: only rows with a suburb and no
// hash are visited, and the hash is deterministic, so re-running is a no-op.
//
// Run AFTER `prisma migrate deploy` has added the column. A corrupt or
// undecryptable suburb is logged by id and skipped; it can never match a
// suburb search (as before), and it stays in the page's bounded decrypt fallback.

/** Suburb hash for one stored (encrypted) suburb, or null when it is blank or cannot be decrypted. */
export function suburbHashFor(id: number, stored: string): string | null {
  let plain: string
  try {
    plain = decrypt(stored)
  } catch {
    console.warn(`  Family #${id}: suburb could not be decrypted — skipped`)
    return null
  }
  return plain.trim() ? hmacSuburb(plain) : null
}

/** Minimal Prisma surface the backfill uses (lets the test pass a fake). */
export type SuburbBackfillDb = {
  family: {
    findMany(args: {
      where: { id: { gt: number }; suburb: { not: null }; suburbHash: null }
      orderBy: { id: "asc" }
      take: number
      select: { id: true; suburb: true }
    }): Promise<{ id: number; suburb: string | null }[]>
    update(args: { where: { id: number }; data: { suburbHash: string } }): Promise<unknown>
  }
}

/**
 * Walk families with a suburb and no hash, by id cursor (identical in dry run
 * and apply: a WHERE on the null column alone would loop forever in dry run).
 *
 * @param db - Prisma client (or a fake in tests)
 * @param apply - write the hashes; otherwise only count
 * @param batch - page size
 * @returns number of rows set (or that would be set) and rows scanned
 */
export async function backfillSuburbHash(db: SuburbBackfillDb, apply: boolean, batch: number): Promise<{ changed: number; scanned: number }> {
  let afterId = 0
  let changed = 0
  let scanned = 0
  while (true) {
    const rows = await db.family.findMany({
      where: { id: { gt: afterId }, suburb: { not: null }, suburbHash: null },
      orderBy: { id: "asc" },
      take: batch,
      select: { id: true, suburb: true },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      afterId = row.id
      if (!row.suburb) continue
      scanned++
      const hash = suburbHashFor(row.id, row.suburb)
      if (!hash) continue
      changed++
      if (apply) await db.family.update({ where: { id: row.id }, data: { suburbHash: hash } })
    }
  }
  return { changed, scanned }
}

/** CLI entry: dry run by default, `--apply --yes` to write. */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })
  const { apply, confirmed, batchSize } = parseScriptArgs()
  try {
    console.log(`Backfilling suburb blind index — ${apply ? "APPLY" : "DRY RUN"}`)
    console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
    await requireConfirmation(apply, confirmed, () => prisma.$disconnect())
    const { changed, scanned } = await backfillSuburbHash(prisma as unknown as SuburbBackfillDb, apply, batchSize)
    console.log(`Family.suburbHash: ${changed} row(s) ${apply ? "set" : "would be set"} (of ${scanned} with a suburb, no hash)`)
    console.log(apply ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  } finally {
    await prisma.$disconnect()
  }
}

// Jest sets NODE_ENV=test; skip the auto-run so the module can be imported.
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
