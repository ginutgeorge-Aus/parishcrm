import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: Family.state and Family.postcode were written in
// plaintext before encryption was added on all write paths (they sit beside the
// already-encrypted address/suburb). Encrypt any row whose value is not yet
// `enc:`-prefixed. Idempotent — already-encrypted rows are skipped, so it is
// safe to re-run.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  console.log(`Encrypting plaintext Family.state / Family.postcode values — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  const total = await prisma.family.count({
    where: { OR: [{ state: { not: null } }, { postcode: { not: null } }] },
  })
  let done = 0
  let changedState = 0
  let changedPostcode = 0
  while (done < total) {
    const rows = await prisma.family.findMany({
      where: { OR: [{ state: { not: null } }, { postcode: { not: null } }] },
      orderBy: { id: "asc" },
      skip: done,
      take: BATCH,
      select: { id: true, state: true, postcode: true },
    })
    // Batch this page's updates into one transaction: a crash leaves a clean
    // page boundary (each page is all-or-nothing) and avoids one round-trip per
    // row. Re-running resumes safely since encrypted rows are skipped.
    const ops = []
    for (const row of rows) {
      // keyIdOf returns a key id for `enc:`-prefixed values, null for plaintext.
      const data: { state?: string; postcode?: string } = {}
      if (typeof row.state === "string" && keyIdOf(row.state) === null) {
        data.state = encrypt(row.state)
        changedState++
      }
      if (typeof row.postcode === "string" && keyIdOf(row.postcode) === null) {
        data.postcode = encrypt(row.postcode)
        changedPostcode++
      }
      if (APPLY && (data.state || data.postcode)) {
        ops.push(prisma.family.update({ where: { id: row.id }, data }))
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }

  console.log(`family.state:    ${changedState} row(s) ${APPLY ? "encrypted" : "would be encrypted"}`)
  console.log(`family.postcode: ${changedPostcode} row(s) ${APPLY ? "encrypted" : "would be encrypted"}`)
  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
