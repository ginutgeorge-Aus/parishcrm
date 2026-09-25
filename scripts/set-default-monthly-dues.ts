import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill: set the default monthly subscription (Family.monthlyDues)
// to $60 for every member family that has no amount yet. "Member" = a family
// with a memberNo; non-member families are left untouched. Existing custom
// amounts are preserved (only null monthlyDues is filled). Idempotent — re-runs
// skip rows already set, so it is safe to run more than once.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const DEFAULT_DUES = 60
const { apply: APPLY, confirmed: CONFIRMED } = parseScriptArgs()

async function main() {
  console.log(`Set default monthlyDues=$${DEFAULT_DUES} for member families with no amount — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  // Member family with no subscription set yet.
  const where = { memberNo: { not: null }, monthlyDues: null }

  const candidates = await prisma.family.count({ where })
  console.log(`${candidates} member family(ies) have no monthlyDues and would be set to $${DEFAULT_DUES}.`)

  if (APPLY && candidates > 0) {
    const res = await prisma.family.updateMany({ where, data: { monthlyDues: DEFAULT_DUES } })
    console.log(`Updated ${res.count} row(s).`)
  }

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
