// Webhook completion for fundraiser card payments (sessions staged by
// `src/lib/fundraiserCheckout.ts`). Called from `completePaidCheckout` in
// `src/lib/stripeCheckout.ts`. No refunds: every "charged but not recorded"
// outcome keeps the money and alerts ops, like the ticket flow.
import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { toCents } from "@/lib/formatting"
import { toStripeAmount } from "@/lib/stripeAmount"
import { entryTotals } from "@/lib/fundraiserMath"
import { notifyStripeAlert } from "@/lib/notifications"
import { logAudit } from "@/lib/audit"
import { isP2002 } from "@/lib/validation"
import type { Prisma } from "@/lib/generated/prisma/client"

// After a failed attempt, give Stripe's retry room before the hourly sweep
// could expire the row (mirrors stripeCheckout.ts).
const RETRY_EXPIRY_MS = 31 * 60 * 1000

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
 * Terminalise an OPEN row without recording a payment. Doubles as the claim:
 * only one delivery flips OPEN→UNFULFILLED.
 * @param stagingId CheckoutSession id
 * @returns true when this delivery owned the transition
 */
async function claimUnfulfilled(stagingId: number): Promise<boolean> {
  const r = await prisma.checkoutSession.updateMany({
    where: { id: stagingId, status: "OPEN" },
    data: { status: "UNFULFILLED", completedAt: new Date() },
  })
  return r.count > 0
}

/**
 * Lock the entry, claim the staging row (OPEN→COMPLETED) and insert the ONLINE
 * payment in one transaction. The entry lock serialises with `deleteEntry`, so
 * an entry cannot vanish between claim and insert, and a failure rolls the
 * claim back so Stripe's retry can try again.
 * @param stagingId CheckoutSession id
 * @param entryId FundraiserEntry id
 * @param amount base amount (charge minus card fee) as staged
 * @param paymentRef Stripe PaymentIntent id (unique per payment)
 * @returns what happened
 */
async function claimAndRecord(
  stagingId: number,
  entryId: number,
  amount: FundraiserStaging["totalAmount"],
  paymentRef: string | null,
): Promise<Outcome> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "FundraiserEntry" WHERE id = ${entryId} FOR UPDATE`
    const claim = await tx.checkoutSession.updateMany({
      where: { id: stagingId, status: "OPEN" },
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
    return { kind: "recorded" as const, paymentId: created.id, entryId, overpaidCents: Math.max(0, toCents(amount) - remainingCents) }
  })
}

/**
 * Settle a paid fundraiser Checkout Session: record one ONLINE payment for the
 * base amount (charge minus the snapshotted card fee). Idempotent across Stripe
 * redeliveries (atomic claim + unique `stripePaymentRef`). An amount mismatch or
 * a deleted entry records nothing and alerts ops. An overpayment (a cash/bank
 * payment cleared the balance first) is still recorded, and ops is alerted.
 * @param session the paid Stripe Checkout Session
 * @param staging the staged CheckoutSession row for it
 * @returns HTTP status for the webhook response (500 = let Stripe retry)
 */
export async function completeFundraiserPayment(
  session: Stripe.Checkout.Session,
  staging: FundraiserStaging,
): Promise<{ status: number }> {
  if (staging.status !== "OPEN") {
    // COMPLETED/UNFULFILLED: already handled by an earlier delivery.
    if (staging.status === "EXPIRED") {
      console.error(`Stripe webhook: paid fundraiser session ${session.id} matched an EXPIRED staging row; no payment recorded, money retained`)
      await notifyStripeAlert(
        "fundraiser card payment after checkout expired — money retained",
        `Session ${session.id}: payment settled after the staging row expired. No fundraiser payment was recorded; record it manually.`,
      )
    }
    return { status: 200 }
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
    outcome = await claimAndRecord(staging.id, entryId, staging.totalAmount, pi)
  } catch (err) {
    if (isP2002(err)) {
      // This PaymentIntent is already recorded: a benign redelivery. The tx
      // rolled the claim back, so close the row now.
      await prisma.checkoutSession.updateMany({
        where: { id: staging.id, status: "OPEN" },
        data: { status: "COMPLETED", completedAt: new Date() },
      })
      return { status: 200 }
    }
    console.error(`Stripe webhook: recording fundraiser payment for session ${session.id} failed; Stripe will retry`, err)
    await notifyStripeAlert(
      "fundraiser card payment: record failed — Stripe retrying",
      `Session ${session.id}: payment settled but recording it threw (${err instanceof Error ? err.message : String(err)}). Row left OPEN for Stripe retry; if retries exhaust, record it manually.`,
    )
    await prisma.checkoutSession.updateMany({
      where: { id: staging.id, status: "OPEN" },
      data: { expiresAt: new Date(Date.now() + RETRY_EXPIRY_MS) },
    })
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
  await logAudit(null, "FUNDRAISER_PAYMENT_ONLINE", "FundraiserPayment", outcome.paymentId, {
    entryId: outcome.entryId,
    amountCents: toCents(staging.totalAmount),
    surchargeCents: staging.surchargeCents,
    overpaidCents: outcome.overpaidCents,
  })
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
