import { decrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { bearerOk } from "@/lib/cronAuth"
import { prisma } from "@/lib/prisma"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { readAutoEmailFlags, readBirthdayTemplate, readAnniversaryTemplate } from "@/lib/celebrationSettings"
import { renderBirthdayEmail } from "@/lib/birthdayTemplate"
import { renderAnniversaryEmail } from "@/lib/anniversaryTemplate"
import { getChurchSettings } from "@/lib/churchSettings"
import { pronouns } from "@/lib/pronouns"
import { upcomingBirthdays, type BirthdayPerson } from "@/lib/birthdays"
import { upcomingAnniversaries, type AnniversaryFamily, type FamilyRoleLite } from "@/lib/anniversaries"
import { claimCelebrationSend, BIRTHDAY_ACTION, ANNIVERSARY_ACTION } from "@/lib/celebrationClaim"
import { deliverCelebration } from "@/lib/celebrationDeliver"

type Counts = { sent: number; skipped: number; failed: number }
const ZERO: Counts = { sent: 0, skipped: 0, failed: 0 }

/**
 * Daily celebration-email sweep (Phase 2). Bearer-authed like the reminder
 * sweep. Reuses the Phase 1 pure matchers/templates at window 0 (exact-today).
 *
 * Idempotent via an atomic DB-backed delivery reservation:
 * `claimCelebrationSend` is called BEFORE each send and only the invocation
 * that wins the claim (create succeeds, or a FAILED slot is reclaimed) sends
 * — a re-run, manual-send overlap, or a second recipient loop can never
 * double-deliver, because the claim itself (not a preflight read) is the
 * atomic decision point. The sweep runs with no session, so it reads
 * settings via the auth-free readers (the gated `getAutoEmailFlags`/
 * `get*Template` would return off/defaults here) and audits with a null
 * (System) actor.
 */
export async function sendDueCelebrations(
  authorization: string | null,
  now: Date,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Loud, not silent — an unset secret means celebration emails never send.
    // Mirrors the reminder sweep: fail the run (503) so the
    // misconfiguration is visible rather than a green no-op.
    console.error("[celebrationSweep] CRON_SECRET unset — celebration email sweep is DISABLED")
    return { status: 503, body: { error: "CRON_SECRET unset — celebration emails disabled" } }
  }
  if (!bearerOk(authorization, secret)) return { status: 401, body: { error: "Unauthorized" } }

  const flags = await readAutoEmailFlags()
  const today = sydneyToday(now)
  const sendDate = sydneyTodayYMD(now)

  const birthdays = flags.birthday ? await sendDueBirthdays(today, sendDate) : ZERO
  const anniversaries = flags.anniversary ? await sendDueAnniversaries(today, sendDate) : ZERO

  return { status: 200, body: { birthdays, anniversaries } }
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
// used (no DOB, undecryptable field, or a garbage decrypted date). Split out
// of the per-row try/catch below — one corrupt/legacy ciphertext must not
// abort the batch for everyone. Mirrors the manual bulk send exactly.
function toBirthdayPersonOrNull(p: BirthdayCandidateRow): BirthdayPerson | null {
  if (!p.dateOfBirth) return null
  try {
    const dateOfBirth = new Date(decrypt(p.dateOfBirth))
    if (Number.isNaN(dateOfBirth.getTime())) return null
    return {
      id: p.id, firstName: p.firstName, lastName: p.lastName, dateOfBirth,
      email: p.email ? decrypt(p.email) : null, emailConsent: p.emailConsent,
      gender: p.gender, family: p.family,
    }
  } catch {
    logger.error("[celebration] skipped a member with an undecryptable field (run the rotation/backfill script to repair)")
    return null
  }
}

// Attempts to send one person's due birthday email under the atomic delivery
// claim. Returns which bucket the attempt landed in so the caller just tallies.
async function sendCelebrationBirthday(
  p: BirthdayPerson,
  template: Awaited<ReturnType<typeof readBirthdayTemplate>>,
  churchName: string,
  sendDate: string,
): Promise<"sent" | "skipped" | "failed"> {
  if (!p.emailConsent || !p.email) return "skipped"
  // Atomic claim BEFORE sending — see claimCelebrationSend. A false
  // return means another invocation already holds or resolved today's slot
  // for this person; this invocation must not send.
  const claimed = await claimCelebrationSend(p.id, BIRTHDAY_ACTION, sendDate)
  if (!claimed) return "skipped"
  const { subject, html, text } = renderBirthdayEmail(template, { firstName: p.firstName, ...pronouns(p.gender), churchName })
  if (await deliverCelebration(p.email, subject, html, text, p.id, BIRTHDAY_ACTION, sendDate)) {
    await logAudit(null, BIRTHDAY_ACTION, "Person", p.id)
    return "sent"
  }
  return "failed"
}

async function sendDueBirthdays(today: Date, sendDate: string): Promise<Counts> {
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

  const due = upcomingBirthdays(people, 0, today)
  const template = await readBirthdayTemplate()
  const { name: churchName } = await getChurchSettings()

  let sent = 0, skipped = 0, failed = 0
  for (const p of due) {
    const result = await sendCelebrationBirthday(p, template, churchName, sendDate)
    if (result === "sent") sent++
    else if (result === "skipped") skipped++
    else failed++
  }
  // Total-failure signal: the birthday window is exact-day-only, so a
  // failed send is never retried. If every attempted send failed (likely an SMTP
  // outage) emit a loud error — otherwise the outage is invisible in a
  // fire-and-forget cron. Mirrors reminderSweep's all-failed guard.
  if (failed > 0 && sent === 0)
    logger.error(`[celebration] all ${failed} birthday email(s) failed to send today — likely an SMTP outage; no retry (exact-day window), investigate`)
  await logAudit(null, "BIRTHDAY_EMAIL_BATCH_SENT", "Person", undefined, { window: 0, sent, skipped, failed })
  return { sent, skipped, failed }
}

async function sendDueAnniversaries(today: Date, sendDate: string): Promise<Counts> {
  const rows = await prisma.family.findMany({
    where: { marriageDate: { not: null }, archivedAt: null },
    select: {
      id: true, name: true, marriageDate: true,
      people: {
        where: { archivedAt: null, role: { in: ["HEAD", "SPOUSE"] } },
        select: { id: true, firstName: true, role: true, email: true, emailConsent: true },
      },
    },
  })

  const families: AnniversaryFamily[] = rows.map((f) => ({
    id: f.id, name: f.name, marriageDate: f.marriageDate as Date,
    people: f.people.map((p) => {
      let email: string | null = null
      try { email = p.email ? decrypt(p.email) : null }
      catch { email = null; logger.error("[celebration] undecryptable anniversary recipient email skipped (run rotation/backfill)") }
      return { id: p.id, firstName: p.firstName, role: p.role as FamilyRoleLite, email, emailConsent: p.emailConsent }
    }),
  }))

  const due = upcomingAnniversaries(families, 0, today)
  const template = await readAnniversaryTemplate()
  const { name: churchName } = await getChurchSettings()

  let sent = 0, skipped = 0, failed = 0
  for (const d of due) {
    const { subject, html, text } = renderAnniversaryEmail(template, { names: d.coupleNames, years: String(d.yearsMarried), churchName })
    for (const r of d.recipients) {
      if (!r.emailConsent || !r.email) { skipped++; continue }
      const claimed = await claimCelebrationSend(r.id, ANNIVERSARY_ACTION, sendDate)
      if (!claimed) { skipped++; continue }
      if (await deliverCelebration(r.email, subject, html, text, r.id, ANNIVERSARY_ACTION, sendDate)) {
        await logAudit(null, ANNIVERSARY_ACTION, "Person", r.id)
        sent++
      } else failed++
    }
  }
  // Total-failure signal — see sendDueBirthdays.
  if (failed > 0 && sent === 0)
    logger.error(`[celebration] all ${failed} anniversary email(s) failed to send today — likely an SMTP outage; no retry (exact-day window), investigate`)
  await logAudit(null, "ANNIVERSARY_EMAIL_BATCH_SENT", "Family", undefined, { window: 0, sent, skipped, failed })
  return { sent, skipped, failed }
}
