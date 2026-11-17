import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for audit 2026-11 phase 1 (AUD-1-17): these free-text columns are now
// encrypted on every write path, but historical rows are still plaintext at rest:
//   Person.maritalStatus, Person.profession, GroupMessage.body, FamilyUpdateSubmission.reviewNote,
//   MembershipApplication.reviewNote, Transaction.reference.
// Idempotent: values already `enc:`-shaped are skipped (keyIdOf !== null). Read paths tolerate
// plaintext, so the app works before, during and after the backfill. Dry run by default.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

type Delegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>
  update(args: unknown): Promise<unknown>
}

/**
 * Encrypts one nullable text column on every row still holding plaintext.
 * @param label - log label, `model.field`
 * @param delegate - Prisma model delegate
 * @param field - column name
 * @returns number of rows changed (or that would change in a dry run)
 */
async function backfill(label: string, delegate: Delegate, field: string): Promise<number> {
  let cursor = 0
  let changed = 0
  for (;;) {
    const rows = await delegate.findMany({
      where: { id: { gt: cursor }, [field]: { not: null } },
      orderBy: { id: "asc" }, take: BATCH, select: { id: true, [field]: true },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      const v = row[field]
      if (typeof v === "string" && v.length > 0 && keyIdOf(v) === null) {
        changed++
        if (APPLY) await delegate.update({ where: { id: row.id }, data: { [field]: encrypt(v) } })
      }
    }
    cursor = rows[rows.length - 1].id as number
  }
  console.log(`${label}: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"}`)
  return changed
}

async function main() {
  console.log(`Encrypting audit phase 1 fields — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  await backfill("person.maritalStatus", prisma.person as unknown as Delegate, "maritalStatus")
  await backfill("person.profession", prisma.person as unknown as Delegate, "profession")
  await backfill("groupMessage.body", prisma.groupMessage as unknown as Delegate, "body")
  await backfill("familyUpdateSubmission.reviewNote", prisma.familyUpdateSubmission as unknown as Delegate, "reviewNote")
  await backfill("membershipApplication.reviewNote", prisma.membershipApplication as unknown as Delegate, "reviewNote")
  await backfill("transaction.reference", prisma.transaction as unknown as Delegate, "reference")

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
