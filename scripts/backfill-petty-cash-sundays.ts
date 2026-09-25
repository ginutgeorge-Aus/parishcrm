import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { sundaysBetween, mostRecentSundayYMD } from "../src/lib/dates"
import { pettyCashTitle } from "../src/lib/formatting"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-time backfill: create zero-balance petty cash sessions for every Sunday
// from --from (default 2025-09-01) through --to (default the current week's
// Sunday). ensureWeeklySession only ever opens the current week, so historical
// Sundays never get a session; this fills the gap. Idempotent — sessions whose
// title already exists are skipped, so it is safe to re-run. Dry-run unless
// both --apply and --yes are passed.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED } = parseScriptArgs()

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function resolveCustodianId(): Promise<number> {
  const flagVal = flag("--custodian")
  if (flagVal) {
    const id = parseInt(flagVal, 10)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid --custodian: ${flagVal}`)
    }
    return id
  }
  const row = await prisma.appSetting.findUnique({ where: { key: "pettyCashDefaultCustodianId" } })
  if (!row || !/^\d+$/.test(row.value)) {
    throw new Error("No --custodian flag and pettyCashDefaultCustodianId setting is unset. Pass --custodian <personId>.")
  }
  return parseInt(row.value, 10)
}

async function main() {
  const from = flag("--from") ?? "2025-09-01"
  const to = flag("--to") ?? mostRecentSundayYMD()
  console.log(`Backfill petty cash Sunday sessions ${from} → ${to} — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  await requireConfirmation(
    APPLY,
    CONFIRMED,
    () => prisma.$disconnect(),
    "Refusing to --apply without --yes. Verify the host above is correct, then re-run with --apply --yes.",
  )

  const custodianId = await resolveCustodianId()
  const custodian = await prisma.person.findUnique({
    where: { id: custodianId },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!custodian) {
    console.error(`Custodian person #${custodianId} not found.`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`Custodian: ${custodian.firstName} ${custodian.lastName} (#${custodianId})`)

  const titles = sundaysBetween(from, to).map(pettyCashTitle)
  if (titles.length === 0) {
    console.log("No Sundays in range — nothing to do.")
    await prisma.$disconnect()
    return
  }

  const existing = await prisma.pettyCashSession.findMany({
    where: { title: { in: titles } },
    select: { title: true },
  })
  const existingTitles = new Set(existing.map((e) => e.title))
  const toCreate = titles.filter((t) => !existingTitles.has(t))

  console.log(`${titles.length} Sundays in range, ${existingTitles.size} already have a session, ${toCreate.length} to create.`)
  for (const t of toCreate) console.log(`  + ${t}`)

  if (toCreate.length === 0) {
    console.log("Nothing to create.")
    await prisma.$disconnect()
    return
  }
  if (!APPLY) {
    console.log("DRY RUN — re-run with --apply --yes to create these.")
    await prisma.$disconnect()
    return
  }

  const result = await prisma.pettyCashSession.createMany({
    data: toCreate.map((title) => ({ title, custodianId, openingBalance: 0 })),
  })
  console.log(`Created ${result.count} sessions.`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
