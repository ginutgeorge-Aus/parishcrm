import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: Registration.email and Registration.phone were
// written in plaintext (public event sign-ups) before encryption was added on
// the register write path. Encrypt any row whose value is not yet `enc:`-
// prefixed. Idempotent — already-encrypted rows are skipped, so it is safe to
// re-run.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  console.log(`Encrypting plaintext Registration.email / Registration.phone — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  const total = await prisma.registration.count()
  let done = 0
  let changedEmail = 0
  let changedPhone = 0
  while (done < total) {
    const rows = await prisma.registration.findMany({
      orderBy: { id: "asc" },
      skip: done,
      take: BATCH,
      select: { id: true, email: true, phone: true },
    })
    // Batch this page's updates into one transaction: a crash leaves a clean
    // page boundary (each page is all-or-nothing) and avoids one round-trip per
    // row. Re-running resumes safely since encrypted rows are skipped.
    const ops = []
    for (const row of rows) {
      // keyIdOf returns a key id for `enc:`-prefixed values, null for plaintext.
      const data: { email?: string; phone?: string } = {}
      if (typeof row.email === "string" && keyIdOf(row.email) === null) {
        data.email = encrypt(row.email)
        changedEmail++
      }
      if (typeof row.phone === "string" && keyIdOf(row.phone) === null) {
        data.phone = encrypt(row.phone)
        changedPhone++
      }
      if (APPLY && (data.email || data.phone)) {
        ops.push(prisma.registration.update({ where: { id: row.id }, data }))
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }

  console.log(`registration.email: ${changedEmail} row(s) ${APPLY ? "encrypted" : "would be encrypted"}`)
  console.log(`registration.phone: ${changedPhone} row(s) ${APPLY ? "encrypted" : "would be encrypted"}`)
  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
