import * as dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
  dotenv.config()
}

import { PrismaClient, Prisma } from "../src/lib/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  RETENTION_MONTHS,
  retentionCutoff,
  anonymisedRegistrationData,
  anonymisedAttendeeData,
  anonymisedWaitlistData,
  anonymisedCheckoutSessionData,
} from "../src/lib/registrationRetention"
import { dbHost, parseScriptArgs, requireConfirmation } from "./lib/script-helpers"

// Registration PII retention purge. The Australian Privacy Act expects
// data minimisation: once an event is well past, the PII collected to run it
// (encrypted email/phone, registrant + attendee names, custom answers) must not
// be kept. This scrubs those fields on registrations for events that ended more
// than RETENTION_MONTHS ago, while leaving the financial aggregates accounting
// needs (RegistrationItem quantity/unitPrice, Registration.totalAmount /
// paymentStatus / createdAt) untouched. Also scrubs two sibling tables tied to
// the same events that carried the same PII class but were never covered:
//   Waitlist         — name + encrypted email, joined per event.
//   CheckoutSession  — encrypted PricedRegistration payload
//                              (name/email/phone/customAnswers), retained
//                              indefinitely on COMPLETED/UNFULFILLED checkouts.
//
// Idempotent: each table's own `anonymizedAt` is set on scrub and excluded
// from its query, so re-running is a no-op. Dry-run by default; --apply --yes
// to write. Runs on the self-hosted runner with the prod DATABASE_URL (same as
// the email-hash backfill) — the prod standalone image has no scripts/ or tsx.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const { apply: APPLY, confirmed: CONFIRMED, batchSize: BATCH } = parseScriptArgs()

async function main() {
  const now = new Date()
  const cutoff = retentionCutoff(now)
  console.log(`Registration PII retention purge — ${APPLY ? "APPLY" : "DRY RUN"}`)
  console.log(`Target DB host: ${dbHost(process.env.DATABASE_URL)}`)
  console.log(`Retention window: ${RETENTION_MONTHS} months — anonymising events ended before ${cutoff.toISOString()}`)
  await requireConfirmation(APPLY, CONFIRMED, () => prisma.$disconnect())

  // Events past retention: endDate wins when set (multi-day/recurring), else the
  // one-off date. Events with neither date are never purged (no anchor).
  const pastEvents = await prisma.event.findMany({
    where: {
      OR: [
        { endDate: { not: null, lt: cutoff } },
        { endDate: null, date: { not: null, lt: cutoff } },
      ],
    },
    select: { id: true },
  })
  const pastEventIds = pastEvents.map((e) => e.id)
  console.log(`Events past retention: ${pastEventIds.length}`)
  if (pastEventIds.length === 0) {
    console.log("Nothing to purge.")
    await prisma.$disconnect()
    return
  }

  // Page by an id cursor (not by re-querying anonymizedAt: null) so the walk is
  // identical in dry-run and apply — in dry-run nothing is written, so a WHERE on
  // the marker column would keep returning the same first page forever.
  let afterId = 0
  let regs = 0
  let attendees = 0
  while (true) {
    const rows = await prisma.registration.findMany({
      where: { id: { gt: afterId }, eventId: { in: pastEventIds }, anonymizedAt: null },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true },
    })
    if (rows.length === 0) break
    for (const reg of rows) {
      afterId = reg.id
      regs++
      const attendeeCount = await prisma.attendee.count({
        where: { registrationItem: { registrationId: reg.id } },
      })
      attendees += attendeeCount
      if (APPLY) {
        // Json columns (customAnswers / answers) must be cleared with
        // Prisma.DbNull, not a literal null — the pure payloads carry `null` to
        // document intent, so override just those two fields here.
        await prisma.$transaction([
          prisma.attendee.updateMany({
            where: { registrationItem: { registrationId: reg.id } },
            data: { ...anonymisedAttendeeData(), answers: Prisma.DbNull },
          }),
          prisma.registration.update({
            where: { id: reg.id },
            data: { ...anonymisedRegistrationData(now), customAnswers: Prisma.DbNull },
          }),
        ])
      }
    }
  }

  console.log(
    `${regs} registration(s) and ${attendees} attendee(s) ${APPLY ? "anonymised" : "would be anonymised"}.`,
  )

  // Waitlist rows for the same past-retention events — same cursor-
  // pagination shape as the registration loop above.
  let waitlistAfterId = 0
  let waitlisted = 0
  while (true) {
    const rows = await prisma.waitlist.findMany({
      where: { id: { gt: waitlistAfterId }, eventId: { in: pastEventIds }, anonymizedAt: null },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      waitlistAfterId = row.id
      waitlisted++
      if (APPLY) {
        await prisma.waitlist.update({ where: { id: row.id }, data: anonymisedWaitlistData(now) })
      }
    }
  }
  console.log(`${waitlisted} waitlist entr${waitlisted === 1 ? "y" : "ies"} ${APPLY ? "anonymised" : "would be anonymised"}.`)

  // CheckoutSession.payload for the same past-retention events.
  let checkoutAfterId = 0
  let checkouts = 0
  while (true) {
    const rows = await prisma.checkoutSession.findMany({
      where: { id: { gt: checkoutAfterId }, eventId: { in: pastEventIds }, anonymizedAt: null },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      checkoutAfterId = row.id
      checkouts++
      if (APPLY) {
        await prisma.checkoutSession.update({ where: { id: row.id }, data: anonymisedCheckoutSessionData(now) })
      }
    }
  }
  console.log(`${checkouts} checkout session(s) ${APPLY ? "anonymised" : "would be anonymised"}.`)

  console.log(APPLY ? "Done." : "Dry run complete. Re-run with --apply --yes to write.")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
