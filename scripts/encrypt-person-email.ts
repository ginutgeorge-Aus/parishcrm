import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: Person.email was written in plaintext before
// encryption was added on all write paths. Encrypt any row whose email is not
// yet `enc:`-prefixed. Idempotent — already-encrypted rows are skipped, so it
// is safe to re-run.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  console.log(`Encrypting plaintext Person.email values — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  const total = await prisma.person.count({ where: { email: { not: null } } })
  let done = 0
  let changed = 0
  while (done < total) {
    const rows = await prisma.person.findMany({
      where: { email: { not: null } },
      orderBy: { id: "asc" },
      skip: done,
      take: BATCH,
      select: { id: true, email: true },
    })
    // Batch this page's updates into one transaction: a crash leaves a clean
    // page boundary (each page is all-or-nothing) and avoids one round-trip per
    // row. Re-running resumes safely since encrypted rows are skipped.
    const ops = []
    for (const row of rows) {
      // keyIdOf returns a key id for `enc:`-prefixed values, null for plaintext.
      if (typeof row.email === "string" && keyIdOf(row.email) === null) {
        changed++
        if (APPLY) {
          ops.push(prisma.person.update({ where: { id: row.id }, data: { email: encrypt(row.email) } }))
        }
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }

  console.log(`person.email: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"} (of ${total} with an email)`)
  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
