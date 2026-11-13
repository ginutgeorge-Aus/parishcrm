import "server-only"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { entryTotals } from "@/lib/fundraiserMath"
import { isValidEmail } from "@/lib/validation"

/** Entry shape needed to find a reminder recipient. */
export type RecipientEntry = {
  familyId: number | null
  outsideEmail: string | null
  family?: { people: { email: string | null; emailConsent: boolean; role: string }[] } | null
}

/**
 * Decrypt and validate one stored email.
 * @param raw - Encrypted (or legacy plaintext) email, or null.
 * @returns the trimmed address, or null when missing or invalid
 */
function validEmail(raw: string | null): string | null {
  if (!raw) return null
  const email = safeDecrypt(raw).trim()
  return isValidEmail(email) ? email : null
}

/**
 * Pick the email address to remind. Member entries: the first consenting family
 * person whose email decrypts to a valid address, trying the family head first,
 * so an invalid head address falls through to a reachable spouse. Outside
 * entries: the decrypted outside email. Returns null when nothing valid is reachable.
 * @param entry - Entry with its family people (member) or outside email.
 */
export async function resolveRecipient(entry: RecipientEntry): Promise<string | null> {
  if (entry.familyId == null) return validEmail(entry.outsideEmail)
  const people = (entry.family?.people ?? []).filter((p) => p.email != null && p.emailConsent)
  const ordered = [...people.filter((p) => p.role === "HEAD"), ...people.filter((p) => p.role !== "HEAD")]
  for (const p of ordered) {
    const email = validEmail(p.email)
    if (email) return email
  }
  return null
}

/** One entry resolved for sending (outside email already decrypted into `recipient`). */
type ReminderCandidate = {
  entryId: number
  name: string
  quantity: number
  unitPrice: string
  bankRef: string
  publicToken: string
  owedCents: number
  paidCents: number
  remainingCents: number
  recipient: string | null
}

/**
 * Load every entry of a fundraiser with totals and resolved recipient.
 * @param fundraiserId - Fundraiser id.
 * @returns the fundraiser and event context plus candidates, or null if missing.
 */
export async function loadReminderCandidates(fundraiserId: number) {
  const f = await prisma.fundraiser.findUnique({
    where: { id: fundraiserId },
    select: {
      id: true, eventId: true, unitLabel: true,
      event: { select: { title: true, onlinePaymentEnabled: true, passCardFee: true } },
      entries: {
        orderBy: { id: "asc" },
        select: {
          id: true, familyId: true, familyNameSnapshot: true, outsideName: true, outsideEmail: true, quantity: true, unitPrice: true,
          bankRef: true, publicToken: true,
          family: { select: { name: true, people: { where: { archivedAt: null }, select: { email: true, emailConsent: true, role: true } } } },
          payments: { select: { amount: true } },
        },
      },
    },
  })
  if (!f) return null
  const candidates: ReminderCandidate[] = []
  for (const e of f.entries) {
    const t = entryTotals(e, e.payments)
    candidates.push({
      entryId: e.id,
      name: e.family?.name ?? e.familyNameSnapshot ?? e.outsideName ?? "Supporter",
      quantity: e.quantity,
      unitPrice: e.unitPrice.toString(),
      bankRef: e.bankRef,
      publicToken: e.publicToken,
      owedCents: t.owedCents,
      paidCents: t.paidCents,
      remainingCents: t.remainingCents,
      recipient: await resolveRecipient(e),
    })
  }
  return { fundraiser: f, candidates }
}

/**
 * Count what a "send reminders" run would do, for the confirm dialog. Chaseable
 * means `remainingCents > 0` (not status), so a 0-owed entry is never chased.
 * @param fundraiserId - Fundraiser id.
 * @returns counts plus the time of the last successful reminder (null if none).
 */
export async function planReminders(
  fundraiserId: number,
): Promise<{ sendable: number; skippedPaid: number; skippedNoEmail: number; lastSentAt: Date | null }> {
  const loaded = await loadReminderCandidates(fundraiserId)
  let sendable = 0
  let skippedPaid = 0
  let skippedNoEmail = 0
  for (const c of loaded?.candidates ?? []) {
    if (c.remainingCents === 0) skippedPaid++
    else if (!c.recipient) skippedNoEmail++
    else sendable++
  }
  const agg = await prisma.fundraiserReminderSend.aggregate({
    where: { status: "SUCCESS", entry: { fundraiserId } },
    _max: { sentAt: true },
  })
  return { sendable, skippedPaid, skippedNoEmail, lastSentAt: agg._max.sentAt ?? null }
}
