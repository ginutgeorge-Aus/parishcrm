import "dotenv/config"
import { PrismaClient } from "../../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// perf baseline — seed realistic single-parish scale into a LOCAL dev DB so the
// slow-query + route-metrics pass runs against volume, not the tiny fixture in
// prisma/seed.ts. Deterministic (no faker, index-derived) so re-runs after a
// reset produce identical data. Refuses any non-local DATABASE_URL.
//
//   npx tsx scripts/perf/seed-volume.ts
//
// Prereq: `npm run db:seed` first (needs the admin user + chart of accounts + General fund).

const TARGETS = {
  families: 500,
  peoplePerFamily: 4, // → ~2,000 people
  transactions: 30_000,
  auditLogs: 50_000,
  registrations: 5_000, // 1 published event
} as const

const CHUNK = 5_000

function assertLocalDb(url: string | undefined): void {
  if (!url) throw new Error("DATABASE_URL is required")
  const host = new URL(url).hostname
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to seed volume data: DATABASE_URL host "${host}" is not local. This script is dev-only.`)
  }
}

assertLocalDb(process.env.DATABASE_URL)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// Deterministic spread helper — a plain LCG seeded by index, so amounts/dates are
// varied but reproducible without Math.random.
const spread = (i: number, mod: number) => ((i * 1103515245 + 12345) >>> 8) % mod

// Dates spread across the last 5 years at UTC midnight (matches the app's calendar-date convention).
const EPOCH = Date.UTC(2021, 0, 1)
const DAY = 86_400_000
const dateForIndex = (i: number) => new Date(EPOCH + spread(i, 5 * 365) * DAY)

async function createInChunks<T>(total: number, build: (i: number) => T, insert: (rows: T[]) => Promise<unknown>) {
  for (let start = 0; start < total; start += CHUNK) {
    const rows = Array.from({ length: Math.min(CHUNK, total - start) }, (_, k) => build(start + k))
    await insert(rows)
  }
}

async function main() {
  // Idempotency: refuse to double-insert. Perf families carry a "PerfFam " prefix.
  const existing = await prisma.family.count({ where: { name: { startsWith: "PerfFam " } } })
  if (existing > 0) {
    throw new Error(`${existing} perf families already present. Reset the DB (npm run db:push -- --force-reset && npm run db:seed) before re-seeding volume.`)
  }

  const admin = await prisma.user.findUnique({ where: { email: "admin@example.com" }, select: { id: true } })
  const incomeAccounts = await prisma.account.findMany({ where: { type: "INCOME", isActive: true }, select: { id: true }, orderBy: { id: "asc" } })
  const generalFund = await prisma.fund.findUnique({ where: { name: "General" }, select: { id: true } })
  // paymentAccount is now an FK to the PaymentAccount table (enum removed) —
  // thread the seeded rows' ids instead of the old enum literals, which Prisma
  // now rejects as an unknown field at runtime.
  const paymentAccounts = await prisma.paymentAccount.findMany({ select: { id: true }, orderBy: { id: "asc" } })
  if (!admin || incomeAccounts.length === 0 || !generalFund || paymentAccounts.length === 0) {
    throw new Error("Missing prerequisites (admin user / income accounts / General fund / payment accounts). Run `npm run db:seed` first.")
  }
  const acctId = (i: number) => incomeAccounts[i % incomeAccounts.length].id
  const paymentAccountId = (i: number) => paymentAccounts[i % paymentAccounts.length].id

  console.log("Seeding families…")
  await createInChunks(
    TARGETS.families,
    (i) => ({
      name: `PerfFam ${String(i + 1).padStart(4, "0")}`,
      state: "NSW",
      postcode: "2148",
      status: "ACTIVE" as const,
      joinedDate: dateForIndex(i),
    }),
    (rows) => prisma.family.createMany({ data: rows }),
  )
  const families = await prisma.family.findMany({ where: { name: { startsWith: "PerfFam " } }, select: { id: true }, orderBy: { id: "asc" } })

  console.log("Seeding people…")
  const ROLES = ["HEAD", "SPOUSE", "CHILD", "CHILD"] as const
  const people = families.flatMap((fam, fi) =>
    Array.from({ length: TARGETS.peoplePerFamily }, (_, k) => ({
      familyId: fam.id,
      firstName: `P${fi + 1}-${k + 1}`,
      lastName: `Fam${fi + 1}`,
      role: ROLES[k],
      classification: "MEMBER" as const,
      gender: (k % 2 === 0 ? "MALE" : "FEMALE") as "MALE" | "FEMALE",
      membershipDate: dateForIndex(fi),
    })),
  )
  await createInChunks(people.length, (i) => people[i], (rows) => prisma.person.createMany({ data: rows }))

  console.log("Seeding transactions…")
  await createInChunks(
    TARGETS.transactions,
    (i) => {
      const familyId = families[i % families.length].id
      return {
        date: dateForIndex(i),
        description: `Perf txn ${i + 1}`,
        amount: (spread(i, 50_000) + 100) / 100, // $1.00–$500.99
        type: "INCOME" as const,
        accountId: acctId(i),
        familyId,
        isGiving: true, // always !!familyId
        fundId: generalFund.id,
        paymentAccountId: paymentAccountId(i),
        reconciled: i % 3 === 0,
      }
    },
    (rows) => prisma.transaction.createMany({ data: rows }),
  )

  console.log("Seeding audit logs…")
  const ACTIONS = ["USER_LOGIN", "PERSON_UPDATE", "TRANSACTION_CREATE", "FAMILY_UPDATE", "RECEIPT_SENT"] as const
  const RESOURCES = ["User", "Person", "Transaction", "Family", "Transaction"] as const
  await createInChunks(
    TARGETS.auditLogs,
    (i) => ({
      userId: admin.id,
      action: ACTIONS[i % ACTIONS.length],
      resourceType: RESOURCES[i % RESOURCES.length],
      resourceId: (i % 1000) + 1,
      createdAt: dateForIndex(i),
    }),
    (rows) => prisma.auditLog.createMany({ data: rows }),
  )

  console.log("Seeding event + registrations…")
  const event = await prisma.event.create({
    data: {
      title: "Perf Baseline Event",
      slug: "perf-event",
      category: "special",
      isPublished: true,
      date: dateForIndex(1),
      ticketTypes: { create: [{ name: "Adult", price: 20 }, { name: "Child", price: 10 }] },
    },
    select: { id: true, ticketTypes: { select: { id: true, price: true } } },
  })
  await createInChunks(
    TARGETS.registrations,
    (i) => ({
      eventId: event.id,
      publicToken: `perf-reg-${i + 1}`,
      firstName: `Reg${i + 1}`,
      lastName: `Attendee`,
      email: `perf${i + 1}@example.test`,
      paymentStatus: (i % 4 === 0 ? "PENDING" : "PAID") as "PENDING" | "PAID",
      totalAmount: 20,
    }),
    (rows) => prisma.registration.createMany({ data: rows }),
  )
  const regs = await prisma.registration.findMany({ where: { eventId: event.id }, select: { id: true }, orderBy: { id: "asc" } })
  const adultTicket = event.ticketTypes[0]
  await createInChunks(
    regs.length,
    (i) => ({ registrationId: regs[i].id, ticketTypeId: adultTicket.id, quantity: 1, unitPrice: adultTicket.price }),
    (rows) => prisma.registrationItem.createMany({ data: rows }),
  )

  // Verify counts (karpathy: goal → check).
  const [famCount, personCount, txnCount, auditCount, regCount] = await Promise.all([
    prisma.family.count({ where: { name: { startsWith: "PerfFam " } } }),
    prisma.person.count({ where: { lastName: { startsWith: "Fam" } } }),
    prisma.transaction.count({ where: { description: { startsWith: "Perf txn " } } }),
    prisma.auditLog.count(),
    prisma.registration.count({ where: { eventId: event.id } }),
  ])
  console.log("Volume seed complete:")
  console.table({ families: famCount, people: personCount, transactions: txnCount, auditLogs: auditCount, registrations: regCount })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
