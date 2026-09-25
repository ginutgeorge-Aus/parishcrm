import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient, Prisma } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { decrypt, hmacEmail } from "../src/lib/cryptoCore"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill for: Person.emailHash and Registration.emailHash are
// deterministic blind indexes of the (decrypted) email, used by the person-export
// to match a member's registrations with an indexed lookup instead of a
// full-table decrypt scan. This populates the column for rows that pre-date the
// write-path change. Idempotent — rows that already have a hash are skipped, and
// the hash is deterministic, so re-running is a no-op.
//
// Run AFTER the schema migration has added the columns. A corrupt/undecryptable
// email is logged and skipped (its registrations simply won't link until fixed).

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

function hashFor(label: string, id: number, email: string): string | null {
  try {
    return hmacEmail(decrypt(email))
  } catch {
    console.warn(`  ${label} #${id}: email could not be decrypted — skipped`)
    return null
  }
}

// Page by an id cursor (not by re-querying `emailHash: null`) so the walk is
// identical in dry-run and apply: in dry-run nothing is written, so a WHERE on
// the null column would keep returning the same first page forever.
async function backfill(
  label: string,
  fetchPage: (afterId: number) => Promise<{ id: number; email: string | null }[]>,
  update: (id: number, hash: string) => Prisma.PrismaPromise<unknown>,
): Promise<void> {
  let afterId = 0
  let changed = 0
  let scanned = 0
  while (true) {
    const rows = await fetchPage(afterId)
    if (rows.length === 0) break
    const ops = []
    for (const row of rows) {
      afterId = row.id
      if (!row.email) continue
      scanned++
      const hash = hashFor(label, row.id, row.email)
      if (!hash) continue
      changed++
      if (APPLY) ops.push(update(row.id, hash))
    }
    if (ops.length) await prisma.$transaction(ops)
  }
  console.log(`${label}.emailHash: ${changed} row(s) ${APPLY ? "set" : "would be set"} (of ${scanned} with an email, no hash)`)
}

async function main() {
  console.log(`Backfilling email blind index — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  await backfill(
    "Person",
    (afterId) =>
      prisma.person.findMany({
        where: { id: { gt: afterId }, email: { not: null }, emailHash: null },
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, email: true },
      }),
    (id, hash) => prisma.person.update({ where: { id }, data: { emailHash: hash } }),
  )

  await backfill(
    "Registration",
    (afterId) =>
      prisma.registration.findMany({
        where: { id: { gt: afterId }, emailHash: null },
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, email: true },
      }),
    (id, hash) => prisma.registration.update({ where: { id }, data: { emailHash: hash } }),
  )

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
