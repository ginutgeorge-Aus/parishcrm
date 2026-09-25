import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: Registration.customAnswers was stored as a
// plaintext JSON object before encryption was added on the write path. Encrypt
// any row whose customAnswers is still a JSON object (new rows store an `enc:`
// string scalar). Idempotent — string values are already encrypted and skipped,
// and null is left untouched, so it is safe to re-run. The CSV export reader
// handles both shapes during the transition.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  console.log(`Encrypting plaintext Registration.customAnswers — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  const total = await prisma.registration.count()
  let done = 0
  let changed = 0
  while (done < total) {
    const rows = await prisma.registration.findMany({
      orderBy: { id: "asc" }, skip: done, take: BATCH,
      select: { id: true, customAnswers: true },
    })
    const ops = []
    for (const row of rows) {
      // null = never answered (skip). A string is already an `enc:` ciphertext
      // scalar (skip). Anything else is a legacy plaintext JSON object.
      if (row.customAnswers !== null && typeof row.customAnswers !== "string") {
        changed++
        if (APPLY) {
          ops.push(prisma.registration.update({
            where: { id: row.id },
            data: { customAnswers: encrypt(JSON.stringify(row.customAnswers)) },
          }))
        }
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }

  console.log(`registration.customAnswers: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"} (of ${total})`)
  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
