import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: PettyCashTransfer.depositedByName and .notes were
// written in plaintext before encryption was added on the write path. Encrypt
// any value not yet `enc:`-prefixed. Idempotent — already-encrypted values are
// skipped (keyIdOf !== null), so it is safe to re-run. safeDecrypt() is
// plaintext-safe, so reads work before and during backfill.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

// Returns the ciphertext for a plaintext value, or null if already encrypted.
function maybeEncrypt(v: string | null): string | null {
  if (typeof v === "string" && v.length > 0 && keyIdOf(v) === null) return encrypt(v)
  return null
}

async function backfillTransfers(): Promise<number> {
  const total = await prisma.pettyCashTransfer.count()
  let done = 0
  let changed = 0
  while (done < total) {
    const rows = await prisma.pettyCashTransfer.findMany({
      orderBy: { id: "asc" }, skip: done, take: BATCH,
      select: { id: true, depositedByName: true, notes: true },
    })
    const ops = []
    for (const row of rows) {
      const depositedByName = maybeEncrypt(row.depositedByName)
      const notes = maybeEncrypt(row.notes)
      if (depositedByName !== null || notes !== null) {
        changed++
        if (APPLY) {
          ops.push(prisma.pettyCashTransfer.update({
            where: { id: row.id },
            data: {
              ...(depositedByName !== null && { depositedByName }),
              ...(notes !== null && { notes }),
            },
          }))
        }
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }
  console.log(`pettyCashTransfer.depositedByName/notes: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"} (of ${total})`)
  return changed
}

async function main() {
  console.log(`Encrypting plaintext petty-cash transfer fields — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  await backfillTransfers()

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
