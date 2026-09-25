import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient, Prisma } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt, hmacMobile } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time re-hash for: hmacMobile now normalises the AU prefix/spacing
// before hashing, but existing Person.mobileHash /
// MembershipApplication.mobileHash rows were computed pre-normalisation. A
// format-variant row (e.g. "0412 345 678" vs "+61412345678") hashes to a stale
// value and silently misses the blind-index auto-match. This recomputes the hash
// for EVERY row with a mobile (unconditional — unlike backfill-mobile-hash.ts,
// which only fills nulls). decrypt() is plaintext-safe, so it tolerates any
// still-plaintext legacy mobile; a genuinely corrupt ciphertext is skipped so one
// bad row can't abort the pass. Idempotent — a row already on the normalised hash
// is rewritten to the same value.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

type MobileDelegate = {
  findMany(args: unknown): Promise<{ id: number; mobile: string | null }[]>
  update(args: unknown): Prisma.PrismaPromise<unknown>
}

async function rehash(label: string, delegate: MobileDelegate): Promise<void> {
  let afterId = 0
  let changed = 0
  let scanned = 0
  while (true) {
    const rows = await delegate.findMany({
      where: { id: { gt: afterId }, mobile: { not: null } },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, mobile: true },
    })
    if (rows.length === 0) break
    const ops: Prisma.PrismaPromise<unknown>[] = []
    for (const row of rows) {
      afterId = row.id
      if (!row.mobile) continue
      scanned++
      let hash: string
      try {
        hash = hmacMobile(decrypt(row.mobile))
      } catch {
        console.warn(`  ${label} #${row.id}: mobile could not be decrypted — skipped`)
        continue
      }
      changed++
      if (APPLY) ops.push(delegate.update({ where: { id: row.id }, data: { mobileHash: hash } }))
    }
    if (ops.length) await prisma.$transaction(ops)
  }
  console.log(`${label}.mobileHash: ${changed} row(s) ${APPLY ? "re-hashed" : "would be re-hashed"} (of ${scanned} with a mobile)`)
}

async function main() {
  console.log(`Re-hashing normalised mobile blind index — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  await rehash("Person", prisma.person as unknown as MobileDelegate)
  await rehash("MembershipApplication", prisma.membershipApplication as unknown as MobileDelegate)

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
