import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  MEMBERSHIP_RETENTION_MONTHS,
  membershipRetentionCutoff,
  anonymisedMembershipApplicationData,
} from "../src/lib/membershipRetention"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// MembershipApplication PII retention purge — the counterpart to the
// registration purge that this model never had. Scrubs the full
// encrypted payload, signature image, email/mobile (+ blind-index hashes),
// and applicant name for DECIDED (APPROVED/REJECTED) applications whose
// review is older than MEMBERSHIP_RETENTION_MONTHS. PENDING applications are
// never touched — no decision anchor, may still need action. Status/review
// metadata (status, reviewedById, reviewedAt, reviewNote, linkedFamilyId,
// monthlyDues) is left intact so the decision audit trail survives.
//
// Idempotent: `MembershipApplication.anonymizedAt` is set on scrub and
// excluded from the query, so re-running is a no-op. Dry-run by default;
// --apply --yes to write.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  const now = new Date()
  const cutoff = membershipRetentionCutoff(now)
  console.log(`MembershipApplication PII retention purge — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  console.log(
    `Retention window: ${MEMBERSHIP_RETENTION_MONTHS} months — anonymising decided applications reviewed before ${cutoff.toISOString()}`,
  )
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  // Page by an id cursor (not by re-querying anonymizedAt: null) so the walk is
  // identical in dry-run and apply — in dry-run nothing is written, so a WHERE
  // on the marker column would keep returning the same first page forever.
  let afterId = 0
  let changed = 0
  while (true) {
    const rows = await prisma.membershipApplication.findMany({
      where: {
        id: { gt: afterId },
        anonymizedAt: null,
        status: { in: ["APPROVED", "REJECTED"] },
        reviewedAt: { not: null, lt: cutoff },
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      afterId = row.id
      changed++
      if (APPLY) {
        // payload is a NOT NULL Json column storing an encrypted string
        // scalar (not a nested object) — Prisma.DbNull (SQL NULL) is invalid
        // here, unlike Registration.customAnswers (a nullable Json column).
        // Clear it to the empty-string JSON scalar instead, matching the
        // empty-string sentinel CheckoutSession.payload already uses.
        await prisma.membershipApplication.update({
          where: { id: row.id },
          data: { ...anonymisedMembershipApplicationData(now), payload: "" },
        })
      }
    }
  }

  console.log(`${changed} membership application(s) ${APPLY ? "anonymised" : "would be anonymised"}.`)
  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
