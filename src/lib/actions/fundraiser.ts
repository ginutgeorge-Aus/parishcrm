"use server"

import { auth } from "@/auth"
import type { Session } from "next-auth"
import { CheckoutStatus, FundraiserPaymentMethod } from "@/lib/generated/prisma/enums"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canManageFundraiser } from "@/lib/roleGuard"
import { featureGuard } from "@/lib/featureFlags"
import { assertNotDemo } from "@/lib/demoMode"
import { isP2002, isRealCalendarDate, isValidEmail, isValidPgId, MONEY_DECIMAL_RE } from "@/lib/validation"
import { toCents, centsToNumber, fmtAUD } from "@/lib/formatting"
import { encrypt } from "@/lib/crypto"
import { entryTotals } from "@/lib/fundraiserMath"
import { generateUniqueBankRef, mintEntryToken, NoFreeBankRefError } from "@/lib/fundraiserEntry"
import { serializableWrite } from "@/lib/serializableWrite"
import type { Prisma } from "@/lib/generated/prisma/client"
import { sendFundraiserReminderEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { getCardFeeConfig } from "@/lib/cardFeeSettings"
import { grossUpTotal } from "@/lib/cardFee"
import { stripeConfigured } from "@/lib/stripe"
import { loadReminderCandidates } from "@/lib/fundraiserReminders"
import { logger } from "@/lib/logger"
import type { ActionResult } from "./types"

const MAX_NAME = 120
const MAX_LABEL = 40
const MAX_PREFIX = 12

/**
 * Create or update the fundraiser of one event (one per event). Changing the
 * unit price only affects entries created afterwards: entries snapshot the
 * price at creation.
 *
 * @param eventId - Event id.
 * @param input - Fundraiser settings; `unitPrice` is a 2-dp decimal string > 0.
 * @returns `{ error }` on failure, `undefined` on success.
 */
export async function saveFundraiser(
  eventId: number,
  input: { name: string; unitLabel: string; unitPrice: string; refPrefix?: string },
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user || !canManageFundraiser(session.user.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  if (!isValidPgId(eventId)) return { error: "Invalid event" }

  const name = input.name.trim()
  if (!name || name.length > MAX_NAME) return { error: "Name is required (max 120 characters)" }
  const unitLabel = input.unitLabel.trim()
  if (!unitLabel || unitLabel.length > MAX_LABEL) return { error: "Unit label is required (max 40 characters)" }
  const unitPrice = input.unitPrice.trim()
  if (!MONEY_DECIMAL_RE.test(unitPrice) || !(toCents(unitPrice) > 0)) {
    return { error: "Unit price must be a positive amount with at most 2 decimals" }
  }
  const refPrefix = (input.refPrefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_PREFIX) || null

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } })
  if (!event) return { error: "Event not found" }

  // Changing refPrefix does not alter bankRef values already issued to entries.
  const data = { name, unitLabel, unitPrice, refPrefix }
  const saved = await prisma.fundraiser.upsert({
    where: { eventId },
    create: { eventId, ...data },
    update: data,
    select: { id: true },
  })
  await logAudit(actorId(session), "FUNDRAISER_SAVE", "Fundraiser", saved.id, { eventId, unitPrice, unitLabel })
  revalidatePath(`/events/${eventId}/fundraiser`)
  revalidatePath("/events")
  return undefined
}

const QUANTITY_RE = /^(?!0+$)\d{1,4}$/
const MAX_EMAIL = 254
const MAX_PHONE = 40
const MAX_NOTE = 500
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{1,100}$/
/** Whole-transaction attempts for addEntry when a bankRef/publicToken collides. */
const MAX_ADD_ATTEMPTS = 5
const BUSY = { error: "Busy, please try again" }

type Guarded = { session: Session } | { error: string }

/**
 * Shared gate for fundraiser entry/payment mutations: demo block, manager
 * role, events feature flag.
 * @returns the session, or `{ error }` to return as-is
 */
async function guardManage(): Promise<Guarded> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user || !canManageFundraiser(session.user.role)) return { error: "Unauthorized" }
  const off = await featureGuard("events")
  if (off) return off
  return { session }
}

/**
 * Revalidate the pages that show fundraiser rows/totals for an event.
 * @param eventId - Event id owning the fundraiser.
 */
function revalidateFundraiser(eventId: number): void {
  revalidatePath(`/events/${eventId}/fundraiser`)
  revalidatePath("/events")
}

/**
 * Take a row lock on one entry inside a transaction, serialising quantity
 * edits, deletes and payments against the same entry.
 * @param tx - Transaction client.
 * @param entryId - Entry id.
 * @returns true when the row exists (and is now locked)
 */
async function lockEntry(tx: Prisma.TransactionClient, entryId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "FundraiserEntry" WHERE id = ${entryId} FOR UPDATE`
  return rows.length > 0
}

/**
 * Add a family (member) or an outside buyer to a fundraiser. Exactly one of
 * `familyId` / `outsideName` must be given. The unit price is snapshotted from
 * the fundraiser; outside email/phone are encrypted at rest. Each entry gets a
 * CSPRNG public token and a unique bank reference.
 *
 * @param fundraiserId - Fundraiser id.
 * @param input - Entry fields; `quantity` is a 1-4 digit positive integer string.
 * @returns `{ error }` on failure, `undefined` on success.
 */
export async function addEntry(
  fundraiserId: number,
  input: { familyId?: number; outsideName?: string; outsideEmail?: string; outsidePhone?: string; quantity: string },
): Promise<ActionResult> {
  const g = await guardManage()
  if ("error" in g) return g
  if (!isValidPgId(fundraiserId)) return { error: "Invalid fundraiser" }

  const outsideName = (input.outsideName ?? "").trim()
  const hasFamily = input.familyId !== undefined && input.familyId !== null
  if (hasFamily === !!outsideName) return { error: "Choose a family or enter an outside name" }
  if (hasFamily && !isValidPgId(input.familyId as number)) return { error: "Invalid family" }
  if (outsideName.length > MAX_NAME) return { error: "Name is too long (max 120 characters)" }
  const quantityStr = (input.quantity ?? "").trim()
  if (!QUANTITY_RE.test(quantityStr)) return { error: "Quantity must be a whole number from 1 to 9999" }
  const quantity = Number.parseInt(quantityStr, 10)

  let outsideEmail: string | null = null
  let outsidePhone: string | null = null
  if (!hasFamily) {
    const email = (input.outsideEmail ?? "").trim()
    if (email && (email.length > MAX_EMAIL || !isValidEmail(email))) return { error: "Invalid email address" }
    const phone = (input.outsidePhone ?? "").trim()
    if (phone.length > MAX_PHONE) return { error: "Phone is too long" }
    outsideEmail = email ? encrypt(email) : null
    outsidePhone = phone ? encrypt(phone) : null
  }

  const fundraiser = await prisma.fundraiser.findUnique({
    where: { id: fundraiserId },
    select: { id: true, eventId: true, unitPrice: true, refPrefix: true },
  })
  if (!fundraiser) return { error: "Fundraiser not found" }
  const familyId = hasFamily ? (input.familyId as number) : null
  if (familyId !== null) {
    const fam = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true } })
    if (!fam) return { error: "Family not found" }
  }

  const DUP = { error: "Already on this fundraiser" }
  const isDupFamily = async (db: Prisma.TransactionClient): Promise<boolean> =>
    familyId !== null &&
    !!(await db.fundraiserEntry.findUnique({
      where: { fundraiserId_familyId: { fundraiserId, familyId } },
      select: { id: true },
    }))

  for (let attempt = 1; attempt <= MAX_ADD_ATTEMPTS; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        if (await isDupFamily(tx)) return null
        const bankRef = await generateUniqueBankRef(tx, fundraiser.refPrefix)
        return tx.fundraiserEntry.create({
          data: {
            fundraiserId,
            familyId,
            outsideName: familyId === null ? outsideName : null,
            outsideEmail,
            outsidePhone,
            quantity,
            unitPrice: fundraiser.unitPrice,
            publicToken: mintEntryToken(),
            bankRef,
          },
          select: { id: true },
        })
      })
      if (!created) return DUP
      await logAudit(actorId(g.session), "FUNDRAISER_ENTRY_ADD", "FundraiserEntry", created.id, {
        fundraiserId,
        familyId,
        outside: familyId === null,
        quantity,
      })
      revalidateFundraiser(fundraiser.eventId)
      return undefined
    } catch (e) {
      if (e instanceof NoFreeBankRefError) return BUSY
      if (!isP2002(e)) throw e
      // A concurrent add of the same family wins the unique index: report it.
      // Otherwise the collision was bankRef/publicToken: retry with fresh values.
      if (await isDupFamily(prisma)) return DUP
    }
  }
  return BUSY
}

/**
 * Change an entry's quantity. Rejected when the new total (quantity x the
 * entry's snapshotted unit price) would be below what is already paid. Runs
 * Serializable: a concurrent payment on the same entry makes Postgres SSI abort
 * one side (P2034), which `serializableWrite` retries against committed state.
 * This covers the Stripe webhook's ONLINE insert only because that transaction
 * also runs Serializable (`fundraiserWebhook.ts`). The FOR UPDATE row lock only
 * reduces those aborts; it is not the guarantee (the snapshot predates the wait).
 *
 * @param entryId - Entry id.
 * @param quantity - 1-4 digit positive integer string.
 * @returns `{ error }` on failure, `undefined` on success.
 */
export async function updateEntryQuantity(entryId: number, quantity: string): Promise<ActionResult> {
  const g = await guardManage()
  if ("error" in g) return g
  if (!isValidPgId(entryId)) return { error: "Invalid entry" }
  const q = (quantity ?? "").trim()
  if (!QUANTITY_RE.test(q)) return { error: "Quantity must be a whole number from 1 to 9999" }
  const next = Number.parseInt(q, 10)

  const res = await serializableWrite<{ error: string } | { from: number; eventId: number }>(async (tx) => {
    if (!(await lockEntry(tx, entryId))) return { error: "Entry not found" }
    const entry = await tx.fundraiserEntry.findUnique({
      where: { id: entryId },
      select: { id: true, quantity: true, unitPrice: true, fundraiser: { select: { eventId: true } }, payments: { select: { amount: true } } },
    })
    if (!entry) return { error: "Entry not found" }
    const { paidCents } = entryTotals(entry, entry.payments)
    const newOwed = entryTotals({ quantity: next, unitPrice: entry.unitPrice }, []).owedCents
    if (!(newOwed >= paidCents)) return { error: "Quantity total is below the amount already paid" }
    await tx.fundraiserEntry.update({ where: { id: entryId }, data: { quantity: next } })
    return { from: entry.quantity, eventId: entry.fundraiser.eventId }
  }, BUSY)
  if ("error" in res) return res
  await logAudit(actorId(g.session), "FUNDRAISER_ENTRY_QUANTITY", "FundraiserEntry", entryId, { from: res.from, to: next })
  revalidateFundraiser(res.eventId)
  return undefined
}

/**
 * Delete an entry. Rejected when any payment exists (delete payments first),
 * so money records are never cascaded away silently.
 *
 * @param entryId - Entry id.
 * @returns `{ error }` on failure, `undefined` on success.
 */
export async function deleteEntry(entryId: number): Promise<ActionResult> {
  const g = await guardManage()
  if ("error" in g) return g
  if (!isValidPgId(entryId)) return { error: "Invalid entry" }

  type Deleted = { entry: { fundraiserId: number; familyId: number | null; fundraiser: { eventId: number } } }
  const res = await serializableWrite<{ error: string } | Deleted>(async (tx) => {
    if (!(await lockEntry(tx, entryId))) return { error: "Entry not found" }
    const entry = await tx.fundraiserEntry.findUnique({
      where: { id: entryId },
      select: { id: true, fundraiserId: true, familyId: true, fundraiser: { select: { eventId: true } } },
    })
    if (!entry) return { error: "Entry not found" }
    if ((await tx.fundraiserPayment.count({ where: { entryId } })) > 0) {
      return { error: "Cannot delete an entry that has payments" }
    }
    // An open card checkout would land its webhook on a vanished entry.
    if ((await tx.checkoutSession.count({ where: { fundraiserEntryId: entryId, status: CheckoutStatus.OPEN } })) > 0) {
      return { error: "Payment in progress" }
    }
    await tx.fundraiserEntry.delete({ where: { id: entryId } })
    return { entry }
  }, BUSY)
  if ("error" in res) return res
  await logAudit(actorId(g.session), "FUNDRAISER_ENTRY_DELETE", "FundraiserEntry", entryId, {
    fundraiserId: res.entry.fundraiserId,
    familyId: res.entry.familyId,
  })
  revalidateFundraiser(res.entry.fundraiser.eventId)
  return undefined
}

/**
 * Record a manual (cash or bank) part payment against an entry. ONLINE
 * payments are written only by the Stripe webhook.
 *
 * Idempotent per `submissionKey`: stored as `stripePaymentRef =
 * "manual:<key>"` (unique), and checked BEFORE the remaining-balance check, so
 * a double-click returns success without a second row instead of failing as
 * "Exceeds remaining balance". Runs Serializable: correctness against a
 * concurrent payment/quantity edit comes from SSI aborts (P2034) retried by
 * `serializableWrite` (the webhook's ONLINE insert runs Serializable too, which
 * SSI needs); the FOR UPDATE row lock only reduces aborts. A concurrent twin that loses on the unique index is also treated as success.
 *
 * @param entryId - Entry id.
 * @param input - `amount` 2-dp decimal string > 0 and <= remaining; `paidAt` YYYY-MM-DD.
 * @returns `{ error }` on failure, `undefined` on success (including a repeat).
 */
export async function recordPayment(
  entryId: number,
  input: { amount: string; method: "CASH" | "BANK"; paidAt: string; note?: string; submissionKey: string },
): Promise<ActionResult> {
  const g = await guardManage()
  if ("error" in g) return g
  if (!isValidPgId(entryId)) return { error: "Invalid entry" }
  const amount = (input.amount ?? "").trim()
  if (!MONEY_DECIMAL_RE.test(amount)) return { error: "Amount must be a number with at most 2 decimals" }
  const amountCents = toCents(amount)
  if (!(amountCents > 0)) return { error: "Amount must be greater than zero" }
  if (input.method !== "CASH" && input.method !== "BANK") return { error: "Invalid payment method" }
  const paidAtStr = (input.paidAt ?? "").trim()
  if (!isRealCalendarDate(paidAtStr)) return { error: "Invalid payment date" }
  const note = (input.note ?? "").trim()
  if (note.length > MAX_NOTE) return { error: "Note is too long (max 500 characters)" }
  if (!SUBMISSION_KEY_RE.test(input.submissionKey ?? "")) return { error: "Invalid submission" }
  const ref = `manual:${input.submissionKey}`
  const method = input.method

  /** Resolve an existing row for this key: same entry = idempotent repeat, else misuse. */
  const repeatOf = (existing: { entryId: number } | null): ActionResult | null =>
    existing ? (existing.entryId === entryId ? undefined : { error: "Invalid submission" }) : null

  type Recorded = { error: string } | { repeat: true } | { id: number; eventId: number }
  let res: Recorded
  try {
    res = await serializableWrite<Recorded>(async (tx) => {
      if (!(await lockEntry(tx, entryId))) return { error: "Entry not found" }
      // Key check first: a repeat must not be judged against the balance it already consumed.
      const prior = repeatOf(await tx.fundraiserPayment.findUnique({ where: { stripePaymentRef: ref }, select: { entryId: true } }))
      if (prior) return prior
      if (prior === undefined) return { repeat: true as const }
      const entry = await tx.fundraiserEntry.findUnique({
        where: { id: entryId },
        select: { quantity: true, unitPrice: true, fundraiser: { select: { eventId: true } }, payments: { select: { amount: true } } },
      })
      if (!entry) return { error: "Entry not found" }
      const { remainingCents } = entryTotals(entry, entry.payments)
      if (!(amountCents <= remainingCents)) return { error: "Exceeds remaining balance" }
      const created = await tx.fundraiserPayment.create({
        data: {
          entryId,
          amount,
          method,
          paidAt: new Date(`${paidAtStr}T00:00:00.000Z`),
          note: note || null,
          stripePaymentRef: ref,
          recordedById: actorId(g.session),
        },
        select: { id: true },
      })
      return { id: created.id, eventId: entry.fundraiser.eventId }
    }, BUSY)
  } catch (e) {
    if (!isP2002(e)) throw e
    // A concurrent twin committed the same key between our check and insert.
    const prior = repeatOf(await prisma.fundraiserPayment.findUnique({ where: { stripePaymentRef: ref }, select: { entryId: true } }))
    if (prior === null) throw e
    return prior
  }
  if ("error" in res) return res
  if ("repeat" in res) return undefined
  await logAudit(actorId(g.session), "FUNDRAISER_PAYMENT_ADD", "FundraiserPayment", res.id, { entryId, amount, method, paidAt: paidAtStr })
  revalidateFundraiser(res.eventId)
  return undefined
}

/**
 * Delete one fundraiser payment; the audit row keeps its amount and method.
 *
 * @param paymentId - Payment id.
 * @returns `{ error }` on failure, `undefined` on success.
 */
export async function deletePayment(paymentId: number): Promise<ActionResult> {
  const g = await guardManage()
  if ("error" in g) return g
  if (!isValidPgId(paymentId)) return { error: "Invalid payment" }
  const payment = await prisma.fundraiserPayment.findUnique({
    where: { id: paymentId },
    select: { id: true, entryId: true, amount: true, method: true, entry: { select: { fundraiser: { select: { eventId: true } } } } },
  })
  if (!payment) return { error: "Payment not found" }
  // Stripe-captured money is refunded in Stripe; deleting the row here would
  // desync the ledger and let a webhook replay re-insert it.
  if (payment.method === FundraiserPaymentMethod.ONLINE) return { error: "Online payments must be refunded in Stripe" }
  // deleteMany: a concurrent double-delete gets "not found" instead of a P2025 throw.
  const { count } = await prisma.fundraiserPayment.deleteMany({ where: { id: paymentId } })
  if (count === 0) return { error: "Payment not found" }
  await logAudit(actorId(g.session), "FUNDRAISER_PAYMENT_DELETE", "FundraiserPayment", paymentId, {
    entryId: payment.entryId,
    amount: payment.amount.toFixed(2),
    method: payment.method,
  })
  revalidateFundraiser(payment.entry.fundraiser.eventId)
  return undefined
}

/** Result of a reminder run: counts, or an error. */
export type SendRemindersResult = { error: string } | { sent: number; failed: number; skippedNoEmail: number }

/**
 * Send a payment reminder to every entry that still owes money and has a
 * reachable, consenting email. Each attempt writes its own FundraiserReminderSend
 * row (encrypted recipient); one failure never aborts the rest. Audited once with
 * counts. Raw mail errors are never logged or stored (they embed the address).
 *
 * @param fundraiserId - Fundraiser id.
 * @returns `{ error }`, or the sent / failed / skippedNoEmail counts.
 */
export async function sendFundraiserReminders(fundraiserId: number): Promise<SendRemindersResult> {
  const g = await guardManage()
  if ("error" in g) return g
  if (!isValidPgId(fundraiserId)) return { error: "Invalid fundraiser" }
  const sentById = Number.parseInt(g.session.user.id ?? "", 10)
  if (Number.isNaN(sentById)) return { error: "Unauthorized" }

  const loaded = await loadReminderCandidates(fundraiserId)
  if (!loaded) return { error: "Fundraiser not found" }
  const { fundraiser, candidates } = loaded

  // The pay link is only offered when Stripe is configured and the event takes online payments.
  const base = process.env.AUTH_URL || process.env.NEXTAUTH_URL || ""
  let origin: string | null = null
  try { origin = new URL(base).origin } catch { origin = null }
  const online = stripeConfigured() && fundraiser.event.onlinePaymentEnabled && origin !== null
  const [churchName, invoice, fee] = await Promise.all([
    getChurchName(),
    getInvoiceSettings(),
    fundraiser.event.passCardFee && online ? getCardFeeConfig() : Promise.resolve(null),
  ])

  let sent = 0
  let failed = 0
  let skippedNoEmail = 0
  for (const c of candidates) {
    if (c.remainingCents === 0) continue
    if (!c.recipient) { skippedNoEmail++; continue }
    const feeCents = fee ? grossUpTotal(c.remainingCents, fee.pct, fee.fixedCents).feeCents : 0
    const money = (cents: number) => fmtAUD(centsToNumber(cents))
    let status: "SUCCESS" | "FAILED" = "SUCCESS"
    let errorMessage: string | undefined
    try {
      await sendFundraiserReminderEmail(c.recipient, {
        churchName,
        eventTitle: fundraiser.event.title,
        name: c.name,
        quantity: c.quantity,
        unitLabel: fundraiser.unitLabel,
        unitPrice: money(toCents(c.unitPrice)),
        owed: money(c.owedCents),
        paid: money(c.paidCents),
        remaining: money(c.remainingCents),
        payUrl: online ? `${origin}/pay/fundraiser/${c.publicToken}` : null,
        cardFee: fee ? money(feeCents) : null,
        bankDetails: invoice.paymentDetails,
        bankRef: c.bankRef,
      })
      sent++
    } catch {
      status = "FAILED"
      errorMessage = "Email delivery failed"
      failed++
      logger.error("[fundraiser-reminder] send failed", { entryId: c.entryId })
    }
    // A tracking-write failure must not abort the batch or turn a delivered email into a failure.
    try {
      await prisma.fundraiserReminderSend.create({
        data: { entryId: c.entryId, sentTo: encrypt(c.recipient), sentById, status, errorMessage },
      })
    } catch {
      logger.error("[fundraiser-reminder] failed to persist send row", { entryId: c.entryId })
    }
  }

  await logAudit(actorId(g.session), "FUNDRAISER_REMINDERS_SENT", "Fundraiser", fundraiserId, { sent, failed, skippedNoEmail })
  revalidateFundraiser(fundraiser.eventId)
  return { sent, failed, skippedNoEmail }
}
