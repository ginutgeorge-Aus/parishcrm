"use server"

import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { actorId } from "@/lib/actor"
import { canEdit } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { getBirthdayTemplate } from "@/lib/actions/settings"
import { renderBirthdayEmail } from "@/lib/birthdayTemplate"
import { getChurchSettings } from "@/lib/churchSettings"
import { pronouns } from "@/lib/pronouns"
import { upcomingBirthdays, BIRTHDAY_WINDOWS, type BirthdayPerson } from "@/lib/birthdays"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { claimCelebrationSend, BIRTHDAY_ACTION } from "@/lib/celebrationClaim"
import { deliverCelebration } from "@/lib/celebrationDeliver"
import type { ActionResultWithSuccess } from "./types"

export async function sendBirthdayEmail(personId: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, firstName: true, email: true, emailConsent: true, archivedAt: true, gender: true },
  })
  if (!person || person.archivedAt) return { error: "Member not found" }
  if (!person.emailConsent) return { error: "Member has not consented to email" }
  // decrypt throws on a corrupt/rotated-key ciphertext — catch it so the action
  // returns a clean error instead of an unhandled 500. Mirrors the per-row
  // try/catch in sendBirthdayEmailsBulk.
  let email = ""
  try {
    email = person.email ? decrypt(person.email) : ""
  } catch {
    return { error: "Member's email could not be read — run the key rotation/backfill script to repair it" }
  }
  if (!email) return { error: "Member has no email address" }

  // Atomic delivery reservation — shared with the daily cron sweep so
  // an admin's manual send and the automatic sweep can never double-email the
  // same person on the same Sydney day.
  const sendDate = sydneyTodayYMD()
  const claimed = await claimCelebrationSend(personId, BIRTHDAY_ACTION, sendDate)
  if (!claimed) return { error: `A birthday email was already sent to ${person.firstName} today` }

  const template = await getBirthdayTemplate()
  const { name: churchName } = await getChurchSettings()
  const { subject, html, text } = renderBirthdayEmail(template, { firstName: person.firstName, ...pronouns(person.gender), churchName })

  const delivered = await deliverCelebration(email, subject, html, text, personId, BIRTHDAY_ACTION, sendDate)
  if (!delivered) return { error: "Email delivery failed" }
  await logAudit(actorId(session), "BIRTHDAY_EMAIL_SENT", "Person", personId)
  return { success: `Birthday email sent to ${person.firstName}` }
}

type BirthdayCandidateRow = {
  id: number
  firstName: string
  lastName: string
  dateOfBirth: string | null
  email: string | null
  emailConsent: boolean
  gender: BirthdayPerson["gender"]
  family: BirthdayPerson["family"]
}

// Decrypts one candidate row into a BirthdayPerson, or null when it can't be
// used (no DOB, undecryptable field, or a garbage decrypted date). A single
// corrupt/legacy ciphertext must not abort the whole batch for everyone.
function toBirthdayPersonOrNull(p: BirthdayCandidateRow): BirthdayPerson | null {
  // The where clause filters `dateOfBirth: { not: null }`, but the Prisma
  // select types it `string | null`. Guard explicitly instead of casting so a
  // null never reaches decrypt() (which would throw / return garbage).
  if (!p.dateOfBirth) return null
  try {
    const dateOfBirth = new Date(decrypt(p.dateOfBirth))
    // A decrypt that returns non-date text yields an Invalid Date that would
    // poison the whole window calc/sort. Skip the record.
    if (Number.isNaN(dateOfBirth.getTime())) return null
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth,
      email: p.email ? decrypt(p.email) : null,
      emailConsent: p.emailConsent,
      gender: p.gender,
      family: p.family,
    }
  } catch {
    // Skip — but do NOT log the member id or the raw exception: this stdout is
    // readable by anyone with log access and would couple a member identifier
    // with the failure. Repair undecryptable rows via the rotation /
    // encrypt-* backfill scripts, not by reading logs.
    logger.error("[birthday] skipped a member with an undecryptable field (run the rotation/backfill script to repair)")
    return null
  }
}

// Attempts to send one due person's bulk birthday email under the atomic
// delivery claim shared with the cron sweep and the single-recipient send.
// Returns which bucket the attempt landed in so the caller just tallies.
async function sendBulkBirthdayEmail(
  p: BirthdayPerson,
  template: Awaited<ReturnType<typeof getBirthdayTemplate>>,
  churchName: string,
  sendDate: string,
): Promise<"sent" | "skipped" | "failed"> {
  if (!p.emailConsent || !p.email) return "skipped"
  // Atomic delivery reservation, shared with the cron sweep and the
  // single-recipient send — a person is never emailed twice on the same
  // Sydney day regardless of which path triggers it.
  const claimed = await claimCelebrationSend(p.id, BIRTHDAY_ACTION, sendDate)
  if (!claimed) return "skipped"
  const { subject, html, text } = renderBirthdayEmail(template, { firstName: p.firstName, ...pronouns(p.gender), churchName })
  return (await deliverCelebration(p.email, subject, html, text, p.id, BIRTHDAY_ACTION, sendDate)) ? "sent" : "failed"
}

export async function sendBirthdayEmailsBulk(
  windowDays: number,
): Promise<{ sent: number; skipped: number; failed: number } | { error: string }> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!BIRTHDAY_WINDOWS.includes(windowDays as (typeof BIRTHDAY_WINDOWS)[number])) {
    return { error: "Invalid window" }
  }

  const rows = await prisma.person.findMany({
    where: { dateOfBirth: { not: null }, archivedAt: null },
    select: {
      id: true, firstName: true, lastName: true, dateOfBirth: true,
      email: true, emailConsent: true, gender: true, family: { select: { name: true } },
    },
  })

  const people: BirthdayPerson[] = []
  for (const p of rows) {
    const person = toBirthdayPersonOrNull(p)
    if (person) people.push(person)
  }

  const upcoming = upcomingBirthdays(people, windowDays, sydneyToday())
  const template = await getBirthdayTemplate()
  const { name: churchName } = await getChurchSettings()
  const sendDate = sydneyTodayYMD()

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const p of upcoming) {
    const result = await sendBulkBirthdayEmail(p, template, churchName, sendDate)
    if (result === "sent") sent++
    else if (result === "skipped") skipped++
    else failed++
  }

  const userId = actorId(session)
  await logAudit(userId, "BIRTHDAY_EMAIL_BATCH_SENT", "Person", undefined, { window: windowDays, sent, skipped, failed })
  return { sent, skipped, failed }
}
