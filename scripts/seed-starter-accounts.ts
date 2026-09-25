import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// First-run: give a fresh production install a generic starter chart of
// accounts (category groups + categories) and payment accounts, so the first
// transaction can be recorded without building them by hand. Unlike
// `npm run db:seed` it creates NO users. Each part is only written when its
// table is empty, so re-running (or running against a populated DB) is a
// no-op — rename/extend/deactivate everything in the UI afterwards. Also
// pre-creates the inactive XFER internal-transfer account bank imports use.
// Defaults to a dry-run; pass --apply --yes to commit.
//
//   npx tsx --env-file=.env scripts/seed-starter-accounts.ts --apply --yes

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

type Kind = "INCOME" | "EXPENSE"

const CHART: { group: string; type: Kind; accounts: [code: string, name: string][] }[] = [
  { group: "Regular Giving", type: "INCOME", accounts: [["4001", "Offertory"], ["4002", "Tithes"], ["4003", "Membership Subscriptions"]] },
  { group: "Donations", type: "INCOME", accounts: [["4004", "General Donations"], ["4005", "Charity Appeals"]] },
  { group: "Events & Programs", type: "INCOME", accounts: [["4006", "Event Income"], ["4007", "Sunday School"]] },
  { group: "Other Income", type: "INCOME", accounts: [["4008", "Interest"], ["4009", "Miscellaneous Income"]] },
  { group: "Operations", type: "EXPENSE", accounts: [["5001", "Rent & Utilities"], ["5002", "Maintenance & Repairs"], ["5003", "Insurance"], ["5004", "IT & Software"], ["5005", "Bank Fees"]] },
  { group: "Clergy & Staff", type: "EXPENSE", accounts: [["5006", "Clergy Allowances"]] },
  { group: "Ministry & Outreach", type: "EXPENSE", accounts: [["5007", "Charity & Outreach"], ["5008", "Youth & Children"], ["5009", "Events"]] },
  { group: "Other Expenses", type: "EXPENSE", accounts: [["5010", "Miscellaneous Expense"]] },
]

const PAYMENT_ACCOUNTS = [
  { name: "Main Bank Account", kind: "BANK" as const, isDefault: true },
  { name: "Petty Cash", kind: "CASH" as const, isDefault: false },
]

const { apply: APPLY, confirmed: CONFIRMED } = parseScriptArgs()

async function main() {
  console.log(`Seed starter accounts — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)

  const groupCount = await prisma.accountGroup.count()
  // XFER is an inactive system account, not part of the user's chart.
  const accountCount = await prisma.account.count({ where: { code: { not: "XFER" } } })
  const paymentCount = await prisma.paymentAccount.count()

  const seedChart = groupCount === 0 && accountCount === 0
  const seedPayments = paymentCount === 0
  const nCategories = CHART.reduce((n, g) => n + g.accounts.length, 0)

  console.log(
    seedChart
      ? `Chart of accounts: will create ${CHART.length} groups, ${nCategories} categories`
      : `Chart of accounts: skipped — ${groupCount} groups / ${accountCount} categories already exist`,
  )
  console.log(
    seedPayments
      ? `Payment accounts: will create ${PAYMENT_ACCOUNTS.map((p) => p.name).join(", ")}`
      : `Payment accounts: skipped — ${paymentCount} already exist`,
  )

  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  if (APPLY) {
    await prisma.$transaction(async (tx) => {
      if (seedChart) {
        for (const [i, g] of CHART.entries()) {
          const sortOrder = CHART.slice(0, i).filter((x) => x.type === g.type).length + 1
          const group = await tx.accountGroup.create({ data: { name: g.group, type: g.type, sortOrder } })
          await tx.account.createMany({
            data: g.accounts.map(([code, name]) => ({ code, name, type: g.type, groupId: group.id })),
          })
        }
      }
      if (seedPayments) {
        await tx.paymentAccount.createMany({ data: PAYMENT_ACCOUNTS })
      }
      // update:{} keeps any existing XFER row untouched.
      await tx.account.upsert({
        where: { code: "XFER" },
        update: {},
        create: { code: "XFER", name: "Internal Transfer", type: "EXPENSE", isActive: false },
      })
    })
  }

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
