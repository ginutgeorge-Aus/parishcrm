import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: FamilyUpdateSubmission.payload was stored as a
// plaintext JSON object before encryption was added on the write path. Encrypt
// any row whose payload is still a JSON object (new rows store an `enc:` string
// scalar). Idempotent — string payloads are already encrypted and skipped, so
// it is safe to re-run. readers handle both shapes during the transition.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  console.log(`Encrypting plaintext FamilyUpdateSubmission.payload — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  const total = await prisma.familyUpdateSubmission.count()
  let done = 0
  let changed = 0
  while (done < total) {
    const rows = await prisma.familyUpdateSubmission.findMany({
      orderBy: { id: "asc" }, skip: done, take: BATCH,
      select: { id: true, payload: true },
    })
    const ops = []
    for (const row of rows) {
      // A string payload is already an `enc:` ciphertext scalar — skip. Anything
      // else is a legacy plaintext JSON object.
      if (typeof row.payload !== "string") {
        changed++
        if (APPLY) {
          ops.push(prisma.familyUpdateSubmission.update({
            where: { id: row.id },
            data: { payload: encrypt(JSON.stringify(row.payload)) },
          }))
        }
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }

  console.log(`familyUpdateSubmission.payload: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"} (of ${total})`)
  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
