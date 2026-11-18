import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, keyIdOf } from "../src/lib/cryptoCore"
import { canonicalStoredToken } from "../src/lib/tokenHash"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for audit 2026-11 phase 1 (AUD-1-17): these free-text columns are now
// encrypted on every write path, but historical rows are still plaintext at rest:
//   Person.maritalStatus, Person.profession, GroupMessage.body, FamilyUpdateSubmission.reviewNote,
//   MembershipApplication.reviewNote, Transaction.reference.
// Also hashes the share-link secrets (Event.volunteerToken, AppSetting venueUsage.calendarToken) to
// SHA-256 digests; existing links keep working because lookups hash the URL token. Links can no longer be
// re-displayed afterwards. Idempotent: values already `enc:`-shaped are skipped (keyIdOf !== null). Read paths tolerate
// plaintext, so the app works before, during and after the backfill. Dry run by default.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

type Delegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>
  updateMany(args: unknown): Promise<unknown>
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
        // Guarded on the value we read: a concurrent edit matches 0 rows and is never overwritten.
        if (APPLY) await delegate.updateMany({ where: { id: row.id, [field]: v }, data: { [field]: encrypt(v) } })
      }
    }
    cursor = rows[rows.length - 1].id as number
  }
  console.log(`${label}: ${changed} row(s) ${APPLY ? "encrypted" : "would be encrypted"}`)
  return changed
}

/**
 * Replace raw share-link tokens with their SHA-256 digest, and lowercase any uppercased digest so DB
 * lookups (which compare verbatim) can match it. Canonical digests are skipped, so re-runs are no-ops.
 */
async function hashTokens(): Promise<void> {
  const events = await prisma.event.findMany({ where: { volunteerToken: { not: null } }, select: { id: true, volunteerToken: true } })
  let n = 0
  for (const e of events) {
    const next = e.volunteerToken ? canonicalStoredToken(e.volunteerToken) : null
    if (next) {
      n++
      // Guarded on the value read: a concurrent regenerate matches 0 rows and is never overwritten.
      if (APPLY) await prisma.event.updateMany({ where: { id: e.id, volunteerToken: e.volunteerToken }, data: { volunteerToken: next } })
    }
  }
  console.log(`event.volunteerToken: ${n} row(s) ${APPLY ? "hashed" : "would be hashed"}`)

  const row = await prisma.appSetting.findUnique({ where: { key: "venueUsage.calendarToken" } })
  const nextVenue = row?.value ? canonicalStoredToken(row.value) : null
  const venue = nextVenue ? 1 : 0
  if (nextVenue && APPLY) await prisma.appSetting.updateMany({ where: { key: "venueUsage.calendarToken", value: row!.value }, data: { value: nextVenue } })
  console.log(`venueUsage.calendarToken: ${venue} row(s) ${APPLY ? "hashed" : "would be hashed"}`)
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

  await hashTokens()

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
