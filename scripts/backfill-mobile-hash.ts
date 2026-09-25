import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient, Prisma } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, decrypt, hmacMobile } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: MembershipApplication.mobile was stored plaintext
// and is now encrypted at rest, with a mobileHash blind index (mirrors's
// emailHash) so findMembershipMatches can look it up against Person.mobileHash.
// This script:
//   1. Person.mobileHash — already-encrypted mobile, just needs the hash (like
//      the Person.emailHash backfill).
//   2. MembershipApplication.mobile/mobileHash — pre-existing rows still hold
//      PLAINTEXT mobile; this encrypts it in place and sets the hash from the
//      plaintext first.
// Idempotent — rows that already have a hash are skipped; encrypt()/decrypt()
// round-trip safely on values already in the target state.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function backfillPersonMobileHash(): Promise<void> {
  let afterId = 0
  let changed = 0
  let scanned = 0
  while (true) {
    const rows = await prisma.person.findMany({
      where: { id: { gt: afterId }, mobile: { not: null }, mobileHash: null },
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
        console.warn(`  Person #${row.id}: mobile could not be decrypted — skipped`)
        continue
      }
      changed++
      if (APPLY) ops.push(prisma.person.update({ where: { id: row.id }, data: { mobileHash: hash } }))
    }
    if (ops.length) await prisma.$transaction(ops)
  }
  console.log(`Person.mobileHash: ${changed} row(s) ${APPLY ? "set" : "would be set"} (of ${scanned} with a mobile, no hash)`)
}

async function backfillMembershipApplicationMobile(): Promise<void> {
  let afterId = 0
  let changed = 0
  let scanned = 0
  while (true) {
    const rows = await prisma.membershipApplication.findMany({
      where: { id: { gt: afterId }, mobile: { not: null }, mobileHash: null },
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
      // Legacy rows hold plaintext; decrypt() is a safe no-op on plaintext so
      // this also tolerates a re-run against an already-encrypted row. But a
      // genuinely corrupt / bad-auth-tag ciphertext throws — guard-and-skip so
      // one bad row can't abort the whole backfill, mirroring the Person path
      // above.
      let plaintext: string
      try {
        plaintext = decrypt(row.mobile)
      } catch {
        console.warn(`  MembershipApplication #${row.id}: mobile could not be decrypted — skipped`)
        continue
      }
      changed++
      if (APPLY)
        ops.push(
          prisma.membershipApplication.update({
            where: { id: row.id },
            data: { mobile: encrypt(plaintext), mobileHash: hmacMobile(plaintext) },
          })
        )
    }
    if (ops.length) await prisma.$transaction(ops)
  }
  console.log(`MembershipApplication.mobile/mobileHash: ${changed} row(s) ${APPLY ? "set" : "would be set"} (of ${scanned} with a mobile, no hash)`)
}

async function main() {
  console.log(`Backfilling mobile blind index — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  await backfillPersonMobileHash()
  await backfillMembershipApplicationMobile()

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
