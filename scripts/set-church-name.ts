import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// One-off: set the `churchName` AppSetting to the church's full name. The
// AppSetting overrides the CHURCH_NAME env / code fallback on receipts and the
// P&L print page (getChurchSettings), so it must hold the canonical full name.
// Idempotent — if the value already matches, it is left untouched. Defaults to
// a dry-run; pass --apply --yes to commit.
//
//   CHURCH_FULL_NAME="Example Community Church" npx tsx scripts/set-church-name.ts

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const KEY = "churchName"
const FULL_NAME = process.env.CHURCH_FULL_NAME?.trim() ?? ""
if (!FULL_NAME) {
  console.error("CHURCH_FULL_NAME is required (the church's full name).")
  process.exit(1)
}
const { apply: APPLY, confirmed: CONFIRMED } = parseScriptArgs()

async function main() {
  console.log(`Set AppSetting ${KEY}="${FULL_NAME}" — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)

  const existing = await prisma.appSetting.findUnique({ where: { key: KEY } })
  console.log(`Current ${KEY}: ${existing ? `"${existing.value}"` : "(not set)"}`)

  if (existing?.value === FULL_NAME) {
    console.log("Already set to the full name — nothing to do.")
    await prisma.$disconnect()
    return
  }

  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  if (APPLY) {
    await prisma.appSetting.upsert({
      where: { key: KEY },
      update: { value: FULL_NAME },
      create: { key: KEY, value: FULL_NAME },
    })
    console.log(`Set ${KEY}="${FULL_NAME}".`)
  }

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
