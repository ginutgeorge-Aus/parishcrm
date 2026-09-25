"use server"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { decrypt, safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { actorId } from "@/lib/actor"
import { logger } from "@/lib/logger"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { getAnniversaryTemplate } from "@/lib/actions/settings"
import { renderAnniversaryEmail } from "@/lib/anniversaryTemplate"
import { getChurchSettings } from "@/lib/churchSettings"
import {
  upcomingAnniversaries, anniversaryYears, ANNIVERSARY_WINDOWS,
  type AnniversaryFamily, type FamilyRoleLite,
} from "@/lib/anniversaries"
import { claimCelebrationSend, ANNIVERSARY_ACTION } from "@/lib/celebrationClaim"
import { deliverCelebration } from "@/lib/celebrationDeliver"
import type { ActionResultWithSuccess } from "./types"

const COUPLE = { in: ["HEAD", "SPOUSE"] as FamilyRoleLite[] }

export async function sendAnniversaryEmail(familyId: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: {
      id: true, marriageDate: true, archivedAt: true,
      people: { where: { archivedAt: null, role: COUPLE }, select: { id: true, firstName: true, role: true, email: true, emailConsent: true } },
    },
  })
  if (!family || family.archivedAt) return { error: "Family not found" }
  if (!family.marriageDate) return { error: "Family has no marriage date" }

  const couple = [...family.people].sort((a, b) => (a.role === "HEAD" ? -1 : 1) - (b.role === "HEAD" ? -1 : 1))
  const coupleNames = couple.map((p) => p.firstName).join(" and ")
  const years = anniversaryYears(family.marriageDate, sydneyToday())

  const recipients = couple
    .filter((p) => p.emailConsent && p.email)
    .map((p) => ({ id: p.id, email: safeDecrypt(p.email as string) }))
    .filter((p) => p.email && p.email !== "[decryption error]")
  if (recipients.length === 0) return { error: "No spouse with a consented email address" }

  const template = await getAnniversaryTemplate()
  const { name: churchName } = await getChurchSettings()
  const { subject, html, text } = renderAnniversaryEmail(template, { names: coupleNames, years: String(years), churchName })
  const sendDate = sydneyTodayYMD()

  let sent = 0
  let alreadySent = 0
  for (const r of recipients) {
    // Atomic delivery reservation — shared with the daily cron sweep
    // so an admin's manual send and the automatic sweep can never double-email
    // the same spouse on the same Sydney day.
    const claimed = await claimCelebrationSend(r.id, ANNIVERSARY_ACTION, sendDate)
    if (!claimed) { alreadySent++; continue }
    // one bad address must not abort the couple; sendEmail already retries transient SMTP
    if (await deliverCelebration(r.email, subject, html, text, r.id, ANNIVERSARY_ACTION, sendDate)) {
      await logAudit(actorId(session), "ANNIVERSARY_EMAIL_SENT", "Person", r.id)
      sent++
    }
  }
  if (sent === 0) {
    if (alreadySent > 0 && alreadySent === recipients.length) {
      return { error: `Anniversary email already sent to ${coupleNames} today` }
    }
    return { error: "Email delivery failed" }
  }
  return { success: `Anniversary email sent to ${coupleNames}` }
}

export async function sendAnniversaryEmailsBulk(
  windowDays: number,
): Promise<{ sent: number; skipped: number; failed: number } | { error: string }> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!ANNIVERSARY_WINDOWS.includes(windowDays as (typeof ANNIVERSARY_WINDOWS)[number])) return { error: "Invalid window" }

  const rows = await prisma.family.findMany({
    where: { marriageDate: { not: null }, archivedAt: null },
    select: {
      id: true, name: true, marriageDate: true,
      people: { where: { archivedAt: null, role: COUPLE }, select: { id: true, firstName: true, role: true, email: true, emailConsent: true } },
    },
  })

  const families: AnniversaryFamily[] = rows.map((f) => ({
    id: f.id, name: f.name, marriageDate: f.marriageDate as Date,
    people: f.people.map((p) => {
      let email: string | null = null
      try { email = p.email ? decrypt(p.email) : null } catch { email = null; logger.error("[anniversary] undecryptable email skipped (run rotation/backfill)") }
      return { id: p.id, firstName: p.firstName, role: p.role as FamilyRoleLite, email, emailConsent: p.emailConsent }
    }),
  }))

  const due = upcomingAnniversaries(families, windowDays, sydneyToday())
  const template = await getAnniversaryTemplate()
  const { name: churchName } = await getChurchSettings()

  const sendDate = sydneyTodayYMD()
  let sent = 0, skipped = 0, failed = 0
  for (const d of due) {
    const { subject, html, text } = renderAnniversaryEmail(template, { names: d.coupleNames, years: String(d.yearsMarried), churchName })
    for (const r of d.recipients) {
      if (!r.emailConsent || !r.email) { skipped++; continue }
      // Atomic delivery reservation, shared with the cron sweep and
      // the single-recipient send.
      const claimed = await claimCelebrationSend(r.id, ANNIVERSARY_ACTION, sendDate)
      if (!claimed) { skipped++; continue }
      if (await deliverCelebration(r.email, subject, html, text, r.id, ANNIVERSARY_ACTION, sendDate)) {
        await logAudit(actorId(session), "ANNIVERSARY_EMAIL_SENT", "Person", r.id)
        sent++
      } else failed++
    }
  }
  await logAudit(actorId(session), "ANNIVERSARY_EMAIL_BATCH_SENT", "Family", undefined, { window: windowDays, sent, skipped, failed })
  return { sent, skipped, failed }
}
