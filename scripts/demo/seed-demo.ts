// Live demo reseed — writes buildDemoData() into a freshly migrated + seeded DB.
//   prisma migrate reset --force
//   ALLOW_DEMO_SEED=true npm run db:seed
//   ALLOW_DEMO_SEED=true DEMO_MODE=true npm run demo:seed
// Uses cryptoCore (not crypto.ts, which is server-only) so PII is stored in
// exactly the app's format. ENCRYPTION_KEY must match the demo app's.
import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) { dotenv.config({ path: ".env.local" }); dotenv.config() }
import { randomBytes } from "node:crypto"
import { hash } from "bcryptjs"
import { PrismaClient } from "../../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { encrypt, hmacEmail, hmacMobile } from "../../src/lib/cryptoCore"
import { buildDemoData, centsToDecimal } from "./demoData"
import { sydneyToday } from "../../src/lib/dates"

if (process.env.DEMO_MODE !== "true" || process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data: set both DEMO_MODE=true and ALLOW_DEMO_SEED=true.")
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  const extra = await prisma.family.count({ where: { name: { not: "Sample" } } })
  if (extra > 0) throw new Error(`${extra} families already present — run after a reset (prisma migrate reset + db:seed).`)

  // Church calendar day (APP_TIMEZONE, default Sydney) — the dashboard's
  // celebration window uses it, and the nightly reset runs while the UTC date
  // is still "yesterday".
  const today = sydneyToday()
  const data = buildDemoData(today)

  const accounts = new Map((await prisma.account.findMany({ select: { id: true, code: true, name: true } })).map((a) => [a.code, a]))
  const acct = (code: string) => {
    const a = accounts.get(code)
    if (!a) throw new Error(`Account ${code} missing — run db:seed first`)
    return a
  }
  const fund = await prisma.fund.findUniqueOrThrow({ where: { name: "General" } })
  const bank = await prisma.paymentAccount.findFirstOrThrow({ where: { kind: "BANK" }, orderBy: { id: "asc" } })
  const cash = await prisma.paymentAccount.findFirstOrThrow({ where: { kind: "CASH" }, orderBy: { id: "asc" } })

  // Users: random unusable password — demo login never checks it.
  const passwordHash = await hash(randomBytes(32).toString("hex"), 12)

  // One transaction, so a failed run leaves nothing behind and a plain rerun
  // works (the guard above only counts families). Timeout covers a slow,
  // remote DB — the run makes a few hundred sequential writes.
  await prisma.$transaction(async (tx) => {
    // Opening balances a year back, so the dashboard shows real running balances
    // instead of "Set opening balance".
    const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), 1))
    await tx.accountOpeningBalance.createMany({
      data: [
        { paymentAccountId: bank.id, amount: "15000.00", asOfDate: yearAgo },
        { paymentAccountId: cash.id, amount: "200.00", asOfDate: yearAgo },
      ],
    })

    const userIds = new Map<string, number>()
    for (const u of data.users) {
      const row = await tx.user.create({ data: { name: u.name, email: u.email, role: u.role, passwordHash } })
      userIds.set(u.role, row.id)
    }

    const familyIds: number[] = []
    let custodianId: number | null = null
    for (const f of data.families) {
      const fam = await tx.family.create({
        data: {
          name: f.name, status: f.status, joinedDate: f.joinedDate, marriageDate: f.marriageDate, createdAt: f.joinedDate,
          address: encrypt(f.address), suburb: encrypt(f.suburb), state: encrypt(f.state), postcode: encrypt(f.postcode),
        },
      })
      familyIds.push(fam.id)
      for (const p of f.people) {
        const person = await tx.person.create({
          data: {
            familyId: fam.id, firstName: p.firstName, lastName: p.lastName, role: p.role, gender: p.gender, createdAt: f.joinedDate,
            classification: "MEMBER", membershipDate: p.membershipDate, consentUpdatedAt: new Date(),
            dateOfBirth: encrypt(p.dateOfBirth),
            email: p.email ? encrypt(p.email) : null, emailHash: p.email ? hmacEmail(p.email) : null,
            mobile: p.mobile ? encrypt(p.mobile) : null, mobileHash: p.mobile ? hmacMobile(p.mobile) : null,
            pastoralNotes: p.pastoralNotes ? encrypt(p.pastoralNotes) : null,
          },
        })
        custodianId ??= person.id
      }
    }

    await tx.transaction.createMany({
      data: data.transactions.map((t) => ({
        date: t.date, amount: centsToDecimal(t.cents), type: t.type, accountId: acct(t.accountCode).id,
        description: encrypt(t.description), familyId: t.familyIndex === null ? null : familyIds[t.familyIndex],
        isGiving: t.familyIndex !== null, fundId: fund.id, paymentAccountId: bank.id, reconciled: t.reconciled,
      })),
    })

    for (const e of data.events) {
      const event = await tx.event.create({
        data: {
          title: e.title, slug: e.slug, category: e.category, date: e.date, location: e.location, isPublished: true,
          ticketTypes: { create: e.tickets.map((t) => ({ name: t.name, price: centsToDecimal(t.cents) })) },
        },
        select: { id: true, ticketTypes: { select: { id: true }, orderBy: { id: "asc" } } },
      })
      if (e.managedByOrganiser) {
        await tx.eventManager.create({ data: { eventId: event.id, userId: userIds.get("EVENT_ORGANISER")! } })
      }
      for (const r of e.registrations) {
        const total = r.items.reduce((s, it) => s + it.attendees.length * e.tickets[it.ticketIndex].cents, 0)
        await tx.registration.create({
          data: {
            eventId: event.id, publicToken: "REG-" + randomBytes(6).toString("hex").toUpperCase(),
            firstName: r.firstName, lastName: r.lastName,
            email: encrypt(r.email), emailHash: hmacEmail(r.email), phone: r.phone ? encrypt(r.phone) : null,
            paymentStatus: r.paid ? "PAID" : "PENDING", totalAmount: centsToDecimal(total),
            items: {
              create: r.items.map((it) => ({
                ticketTypeId: event.ticketTypes[it.ticketIndex].id, quantity: it.attendees.length,
                unitPrice: centsToDecimal(e.tickets[it.ticketIndex].cents),
                attendees: { create: it.attendees.map((a) => ({ name: a.name, checkedInAt: a.checkedIn ? e.date : null })) },
              })),
            },
          },
        })
      }
    }

    // Petty cash: entries + their mirror ledger rows, same shape as
    // receiptMirrorData/expenseMirrorData in src/lib/actions/pettyCashEntry.ts.
    for (const s of data.pettyCash) {
      const inCents = s.receipts.reduce((x, r) => x + r.cents, 0)
      const outCents = s.expenses.reduce((x, r) => x + r.cents, 0)
      const session = await tx.pettyCashSession.create({
        data: {
          title: s.title, custodianId: custodianId!, openingBalance: centsToDecimal(s.openingCents), openedAt: s.date,
          status: s.closed ? "CLOSED" : "OPEN",
          ...(s.closed ? { closedAt: s.date, countedCash: centsToDecimal(s.openingCents + inCents - outCents), closingVariance: "0.00" } : {}),
        },
      })
      for (const r of s.receipts) {
        const a = acct(r.accountCode)
        const receipt = await tx.pettyCashReceipt.create({
          data: { sessionId: session.id, date: s.date, accountId: a.id, amount: centsToDecimal(r.cents), notes: encrypt(r.notes), fundId: fund.id },
        })
        await tx.transaction.create({
          data: {
            date: s.date, amount: centsToDecimal(r.cents), type: "INCOME", accountId: a.id, isGiving: false,
            paymentAccountId: cash.id, bankRef: `PC_R_${receipt.id}`, description: encrypt(a.name),
            reference: s.title, pettyCashReceiptId: receipt.id, fundId: fund.id,
          },
        })
      }
      for (const x of s.expenses) {
        const a = acct(x.accountCode)
        const expense = await tx.pettyCashExpense.create({
          data: {
            sessionId: session.id, date: s.date, accountId: a.id, amount: centsToDecimal(x.cents),
            payee: encrypt(x.payee), description: encrypt(x.description), receiptRef: x.receiptRef, fundId: fund.id,
          },
        })
        await tx.transaction.create({
          data: {
            date: s.date, amount: centsToDecimal(x.cents), type: "EXPENSE", accountId: a.id, isGiving: false,
            paymentAccountId: cash.id, bankRef: `PC_E_${expense.id}`, description: encrypt(a.name),
            reference: s.title, pettyCashExpenseId: expense.id, fundId: fund.id,
          },
        })
      }
    }
  }, { maxWait: 10_000, timeout: 300_000 })

  const [fams, people, txns, regs] = await Promise.all([
    prisma.family.count(), prisma.person.count(), prisma.transaction.count(), prisma.registration.count(),
  ])
  console.log("Demo seed complete:")
  console.table({ families: fams, people, transactions: txns, registrations: regs })
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
