import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: Transaction.notes is now encrypted on every write
// path (bankImportConfirm.ts and the manual transaction action,/), but
// historical rows — bank-import details and any manually-keyed notes — remain
// plaintext at rest. Encrypt any value not yet `enc:`-prefixed. Idempotent —
// already-encrypted values are skipped (keyIdOf !== null), so it is safe to
// re-run. Read paths use safeDecrypt (plaintext no-op), so reads work before,
// during, and after the backfill.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

// Returns the ciphertext for a plaintext value, or null if already encrypted.
function maybeEncrypt(v: string | null): string | null {
  if (typeof v === "string" && v.length > 0 && keyIdOf(v) === null) return encrypt(v)
  return null
}

async function backfillNotes(): Promise<number> {
  const total = await prisma.transaction.count({ where: { notes: { not: null } } })
  let done = 0
  let changed = 0
  while (done < total) {
    const rows = await prisma.transaction.findMany({
      where: { notes: { not: null } },
      orderBy: { id: "asc" }, skip: done, take: BATCH,
      select: { id: true, notes: true },
    })
    const ops = []
    for (const row of rows) {
      const notes = maybeEncrypt(row.notes)
      if (notes !== null) {
        changed++
        if (APPLY) ops.push(prisma.transaction.update({ where: { id: row.id }, data: { notes } }))
      }
    }
    if (ops.length) await prisma.$transaction(ops)
    done += rows.length
  }
  console.log(`transaction.notes: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"} (of ${total} with notes)`)
  return changed
}

async function main() {
  console.log(`Encrypting plaintext transaction notes — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  await backfillNotes()

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
