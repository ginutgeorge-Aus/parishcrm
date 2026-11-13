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
 * An entry reminded (or being reminded) within this window is skipped, so a
 * double-click or two staff sending at once never emails anyone twice.
 */
export const REMINDER_DEDUPE_MS = 10 * 60 * 1000
/** Most reminders one run will email; the rest are deferred to a later run. */
export const REMINDER_MAX_PER_RUN = 200

/** Counts for the confirm dialog. */
export type ReminderPlan = {
  sendable: number
  skippedPaid: number
  skippedNoEmail: number
  skippedRecent: number
  /** Eligible entries beyond `REMINDER_MAX_PER_RUN`, left for a later run. */
  deferred: number
  lastSentAt: Date | null
}

/**
 * Count what a "send reminders" run would do, for the confirm dialog. Chaseable
 * means `remainingCents > 0` (not status), so a 0-owed entry is never chased.
 * Mirrors the send: entries reminded within `REMINDER_DEDUPE_MS` are skipped and
 * at most `REMINDER_MAX_PER_RUN` are sendable (the rest are `deferred`).
 * @param fundraiserId - Fundraiser id.
 * @returns counts plus the time of the last successful reminder (null if none).
 */
export async function planReminders(fundraiserId: number): Promise<ReminderPlan> {
  const [loaded, recent, agg] = await Promise.all([
    loadReminderCandidates(fundraiserId),
    loadRecentlyRemindedIds(fundraiserId),
    prisma.fundraiserReminderSend.aggregate({
      where: { status: "SUCCESS", entry: { fundraiserId } },
      _max: { sentAt: true },
    }),
  ])
  const { due, skippedPaid, skippedNoEmail, skippedRecent } = partitionReminders(loaded?.candidates ?? [], recent)
  const sendable = Math.min(due.length, REMINDER_MAX_PER_RUN)
  return { sendable, skippedPaid, skippedNoEmail, skippedRecent, deferred: due.length - sendable, lastSentAt: agg._max.sentAt ?? null }
}

/**
 * Entry ids of a fundraiser reminded (or being reminded) within
 * `REMINDER_DEDUPE_MS`. Shared by the plan and the send so both skip the same
 * entries; the send's per-entry claim stays the atomic race guard.
 * @param fundraiserId - Fundraiser id.
 * @returns the set of recently reminded entry ids.
 */
export async function loadRecentlyRemindedIds(fundraiserId: number): Promise<Set<number>> {
  const rows = await prisma.fundraiserReminderSend.findMany({
    where: {
      status: { in: ["PENDING", "SUCCESS"] },
      sentAt: { gte: new Date(Date.now() - REMINDER_DEDUPE_MS) },
      entry: { fundraiserId },
    },
    select: { entryId: true },
    distinct: ["entryId"],
  })
  return new Set(rows.map((r) => r.entryId))
}

/**
 * Split candidates into those to email and the skip counts. Shared by the plan
 * and the send so the confirm dialog matches what a run does. Order: nothing
 * owed, then no usable email, then recently reminded.
 * @param candidates - Candidates from `loadReminderCandidates`, in send order.
 * @param recent - Ids from `loadRecentlyRemindedIds`.
 * @returns the due candidates (recipient narrowed to string) plus skip counts.
 */
export function partitionReminders<C extends { entryId: number; remainingCents: number; recipient: string | null }>(
  candidates: readonly C[],
  recent: ReadonlySet<number>,
): { due: (C & { recipient: string })[]; skippedPaid: number; skippedNoEmail: number; skippedRecent: number } {
  const due: (C & { recipient: string })[] = []
  let skippedPaid = 0
  let skippedNoEmail = 0
  let skippedRecent = 0
  for (const c of candidates) {
    if (c.remainingCents === 0) skippedPaid++
    else if (!c.recipient) skippedNoEmail++
    else if (recent.has(c.entryId)) skippedRecent++
    else due.push({ ...c, recipient: c.recipient })
  }
  return { due, skippedPaid, skippedNoEmail, skippedRecent }
}

/**
 * Order due candidates never-reminded first, then least recently reminded, so a
 * capped run (`REMINDER_MAX_PER_RUN`) reaches entries a previous run deferred
 * instead of re-emailing the same first N. Stable: ties keep entry-id order.
 * @param fundraiserId - Fundraiser id.
 * @param due - Due candidates from `partitionReminders`.
 * @returns a new array in send order.
 */
export async function orderLeastRecentlyReminded<C extends { entryId: number }>(fundraiserId: number, due: readonly C[]): Promise<C[]> {
  const rows = await prisma.fundraiserReminderSend.groupBy({
    by: ["entryId"],
    where: { status: "SUCCESS", entryId: { in: due.map((c) => c.entryId) }, entry: { fundraiserId } },
    _max: { sentAt: true },
  })
  const last = new Map(rows.map((r) => [r.entryId, r._max.sentAt?.getTime() ?? 0]))
  return due.map((c, i) => ({ c, i })).sort((a, b) => (last.get(a.c.entryId) ?? 0) - (last.get(b.c.entryId) ?? 0) || a.i - b.i).map((x) => x.c)
}
