// Webhook completion for fundraiser card payments (sessions staged by
// `src/lib/fundraiserCheckout.ts`). Called from `completePaidCheckout` in
// `src/lib/stripeCheckout.ts`. No refunds: every "charged but not recorded"
// outcome keeps the money and alerts ops, like the ticket flow.
// A payment that lands after the hourly sweep marked its row EXPIRED is still
// recorded: entry and amount are both known, so there is nothing to resolve by hand.
import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { toCents } from "@/lib/formatting"
import { toStripeAmount } from "@/lib/stripeAmount"
import { entryTotals } from "@/lib/fundraiserMath"
import { notifyStripeAlert } from "@/lib/notifications"
import { logAuditTx } from "@/lib/audit"
import { isP2002, isP2034 } from "@/lib/validation"
// Value import (isolation-level enum), not the @/lib/prisma re-export — see serializableWrite.ts.
import { Prisma } from "@/lib/generated/prisma/client"
import type { CheckoutStatus } from "@/lib/generated/prisma/enums"

// After a failed attempt, give Stripe's retry room before the hourly sweep
// could expire the row (mirrors stripeCheckout.ts).
const RETRY_EXPIRY_MS = 31 * 60 * 1000

// Staging statuses a paid delivery may still claim. EXPIRED is claimable because
// the sweep only means "abandoned by the clock", not "cannot have been paid"
// (late completion, delayed or retried webhook). COMPLETED/UNFULFILLED are terminal.
const CLAIMABLE = { in: ["OPEN", "EXPIRED"] as CheckoutStatus[] }

/** Staged CheckoutSession fields the fundraiser branch needs. */
export type FundraiserStaging = {
  id: number
  status: string
  fundraiserEntryId: number | null
  totalAmount: Prisma.Decimal | string | number
  surchargeCents: number
}

type Outcome =
  | { kind: "lost" }
  | { kind: "missing" }
  | { kind: "recorded"; paymentId: number; entryId: number; overpaidCents: number }

/**
 * Normalise a Stripe expandable PaymentIntent reference to its id.
 * @param pi string id, expanded object, or null
 * @returns the id, or null when absent
 */
function piOf(pi: string | { id: string } | null | undefined): string | null {
  if (!pi) return null
  return typeof pi === "string" ? pi : pi.id
}

/**
 * Terminalise an OPEN/EXPIRED row without recording a payment. Doubles as the
 * claim: only one delivery flips it to UNFULFILLED.
 * @param stagingId CheckoutSession id
 * @returns true when this delivery owned the transition
 */
async function claimUnfulfilled(stagingId: number): Promise<boolean> {
  const r = await prisma.checkoutSession.updateMany({
    where: { id: stagingId, status: CLAIMABLE },
    data: { status: "UNFULFILLED", completedAt: new Date() },
  })
  return r.count > 0
}

/**
 * Lock the entry, claim the staging row (OPEN/EXPIRED→COMPLETED) and insert the ONLINE
 * payment in one Serializable transaction. The entry lock serialises with
 * `deleteEntry`, so an entry cannot vanish between claim and insert, and a
 * failure rolls the claim back so Stripe's retry can try again.
 *
 * Why Serializable: `recordPayment` / `updateEntryQuantity` run Serializable
 * and take the same FOR UPDATE lock, but their snapshot is fixed when the
 * lock statement starts, before it waits on ours — so the row lock alone does
 * not make them see this insert. SSI only catches that read/write conflict when
 * both sides are Serializable; under Read Committed here a staff payment could
 * commit against a stale balance (silent overpay). A conflict now aborts one
 * side with P2034; on this side the caller returns 500 so Stripe redelivers.
 * @param stagingId CheckoutSession id
 * @param entryId FundraiserEntry id
 * @param amount base amount (charge minus card fee) as staged
 * The FUNDRAISER_PAYMENT_ONLINE audit row is written in the same transaction,
 * so a recorded payment never lacks its audit row (a failed audit write rolls
 * the claim back and Stripe retries).
 * @param paymentRef Stripe PaymentIntent id (unique per payment)
 * @param surchargeCents card fee charged on top (audit metadata)
 * @returns what happened
 */
async function claimAndRecord(
  stagingId: number,
  entryId: number,
  amount: FundraiserStaging["totalAmount"],
  paymentRef: string | null,
  surchargeCents: number,
): Promise<Outcome> {
  return prisma.$transaction(async (tx) => {
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "FundraiserEntry" WHERE id = ${entryId} FOR UPDATE` // nosemgrep: crm-no-raw-sql
    const claim = await tx.checkoutSession.updateMany({
      where: { id: stagingId, status: CLAIMABLE },
      data: locked.length === 0
        ? { status: "UNFULFILLED", completedAt: new Date() }
        : { status: "COMPLETED", completedAt: new Date() },
    })
    if (claim.count === 0) return { kind: "lost" as const }
    if (locked.length === 0) return { kind: "missing" as const }
    const entry = await tx.fundraiserEntry.findUnique({
      where: { id: entryId },
      select: { quantity: true, unitPrice: true, payments: { select: { amount: true } } },
    })
    if (!entry) return { kind: "missing" as const }
    const { remainingCents } = entryTotals(entry, entry.payments)
    const created = await tx.fundraiserPayment.create({
      data: {
        entryId,
        amount,
        method: "ONLINE",
        paidAt: new Date(),
        stripePaymentRef: paymentRef,
        recordedById: null,
      },
      select: { id: true },
    })
    const overpaidCents = Math.max(0, toCents(amount) - remainingCents)
    await logAuditTx(tx, null, "FUNDRAISER_PAYMENT_ONLINE", "FundraiserPayment", created.id, {
      entryId,
      amountCents: toCents(amount),
      surchargeCents,
      overpaidCents,
    })
    return { kind: "recorded" as const, paymentId: created.id, entryId, overpaidCents }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/**
 * Leave the staging row OPEN for Stripe's retry, pushing its expiry past the
 * retry window so the hourly sweep does not expire it first.
 * @param stagingId CheckoutSession id
 */
async function extendForRetry(stagingId: number): Promise<void> {
  await prisma.checkoutSession.updateMany({
    where: { id: stagingId, status: "OPEN" },
    data: { expiresAt: new Date(Date.now() + RETRY_EXPIRY_MS) },
  })
}

/**
 * Settle a paid fundraiser Checkout Session: record one ONLINE payment for the
 * base amount (charge minus the snapshotted card fee). Idempotent across Stripe
 * redeliveries (atomic claim + unique `stripePaymentRef`). A row the sweep
 * already marked EXPIRED is still claimed and recorded (late payment). An amount mismatch or
 * a deleted entry records nothing and alerts ops. An overpayment (a cash/bank
 * payment cleared the balance first) is still recorded, and ops is alerted.
 * A serialization conflict (P2034) with a concurrent staff write returns 500
 * without an alert: the claim rolled back and Stripe redelivers.
 * @param session the paid Stripe Checkout Session
 * @param staging the staged CheckoutSession row for it
 * @returns HTTP status for the webhook response (500 = let Stripe retry)
 */
export async function completeFundraiserPayment(
  session: Stripe.Checkout.Session,
  staging: FundraiserStaging,
): Promise<{ status: number }> {
  // COMPLETED/UNFULFILLED: already handled by an earlier delivery.
  if (staging.status !== "OPEN" && staging.status !== "EXPIRED") return { status: 200 }
  if (staging.status === "EXPIRED") {
    console.warn(`Stripe webhook: paid fundraiser session ${session.id} matched an EXPIRED staging row; recording it anyway`)
  }

  const pi = piOf(session.payment_intent)
  const expectedCents = toCents(staging.totalAmount) + staging.surchargeCents
  if (session.amount_total !== toStripeAmount(expectedCents)) {
    if (await claimUnfulfilled(staging.id)) {
      console.error(`Stripe webhook: fundraiser amount mismatch (charged ${session.amount_total}, expected ${toStripeAmount(expectedCents)}) for PI ${pi ?? "?"}; no payment recorded`)
      await notifyStripeAlert(
        "fundraiser card payment: amount mismatch — money retained",
        `Charged ${session.amount_total}, expected ${toStripeAmount(expectedCents)} (session ${session.id}). No fundraiser payment recorded; resolve manually.`,
      )
    }
    return { status: 200 }
  }

  const entryId = staging.fundraiserEntryId
  if (entryId == null) {
    if (await claimUnfulfilled(staging.id)) await alertEntryMissing(session.id)
    return { status: 200 }
  }

  let outcome: Outcome
  try {
    outcome = await claimAndRecord(staging.id, entryId, staging.totalAmount, pi, staging.surchargeCents)
  } catch (err) {
    if (isP2002(err)) {
      // This PaymentIntent is already recorded: a benign redelivery. The tx
      // rolled the claim back, so close the row now.
      await prisma.checkoutSession.updateMany({
        where: { id: staging.id, status: CLAIMABLE },
        data: { status: "COMPLETED", completedAt: new Date() },
      })
      return { status: 200 }
    }
    if (isP2034(err)) {
      // Lost a Serializable conflict with a concurrent staff payment/quantity
      // edit on this entry. The claim rolled back; Stripe's retry re-reads the
      // committed balance. Transient, so no ops alert.
      console.warn(`Stripe webhook: fundraiser payment for session ${session.id} hit a serialization conflict; Stripe will retry`)
      await extendForRetry(staging.id)
      return { status: 500 }
    }
    console.error(`Stripe webhook: recording fundraiser payment for session ${session.id} failed; Stripe will retry`, err)
    await notifyStripeAlert(
      "fundraiser card payment: record failed — Stripe retrying",
      `Session ${session.id}: payment settled but recording it threw (${err instanceof Error ? err.message : String(err)}). Row left OPEN for Stripe retry; if retries exhaust, record it manually.`,
    )
    await extendForRetry(staging.id)
    return { status: 500 }
  }

  if (outcome.kind === "missing") await alertEntryMissing(session.id)
  if (outcome.kind !== "recorded") return { status: 200 }

  if (outcome.overpaidCents > 0) {
    await notifyStripeAlert(
      "fundraiser card payment: entry overpaid",
      `Session ${session.id}: card payment recorded on fundraiser entry ${outcome.entryId}, which is now overpaid by ${outcome.overpaidCents} cents (another payment cleared it first). Review whether to refund.`,
    )
  }
  return { status: 200 }
}

/**
 * Alert ops that a fundraiser card payment settled for an entry that no longer exists.
 * @param sessionId Stripe Checkout Session id
 */
async function alertEntryMissing(sessionId: string): Promise<void> {
  console.error(`Stripe webhook: paid fundraiser session ${sessionId} has no entry (deleted?); no payment recorded, money retained`)
  await notifyStripeAlert(
    "fundraiser card payment: entry missing — money retained",
    `Session ${sessionId}: payment settled but its fundraiser entry no longer exists. No payment recorded; resolve manually.`,
  )
}
