// Stripe Checkout for a fundraiser entry's remaining balance (the public
// /pay/fundraiser/[token] link in reminder emails). No `next/server` import —
// Jest tests import this module directly. Request-specific work (headers,
// rate limit, origin) stays in `src/lib/actions/eventCheckout.ts`.
import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
import { toCents } from "@/lib/formatting"
import { STRIPE_CURRENCY, toStripeAmount, roundCentsForCurrency } from "@/lib/stripeAmount"
import { grossUpTotal } from "@/lib/cardFee"
import { getCardFeeConfig } from "@/lib/cardFeeSettings"
import { entryTotals } from "@/lib/fundraiserMath"
import { isP2034 } from "@/lib/validation"
// Value import from the generated client (not @/lib/prisma): tests mock
// @/lib/prisma as `{ prisma }` and would lose the isolation-level enum.
import { Prisma } from "@/lib/generated/prisma/client"

// Stripe's `expires_at` floor is 30 min; +1 min buffer (same as stripeCheckout.ts).
const CHECKOUT_EXPIRY_MS = 31 * 60 * 1000
// Reuse a prior open session only if the payer still has time to finish it.
const REUSE_MIN_REMAINING_MS = 5 * 60 * 1000
// Serializable attempts before a conflict is surfaced (same as serializableWrite).
const MAX_TX_ATTEMPTS = 3

/** Nothing is owed on the entry, it is gone, or a card payment for it is already settling. */
export class FundraiserNotPayableError extends Error {}

/**
 * Format integer cents as a 2-dp decimal string for a `Decimal(10,2)` column,
 * without float maths.
 * @param cents non-negative integer cents
 * @returns e.g. 3000 → "30.00"
 */
function centsToDecimalString(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const frac = String(cents % 100).padStart(2, "0")
  return `${whole}.${frac}`
}

/**
 * Card fee passed to the payer on a fundraiser card payment. Same computation as
 * the reminder email (`grossUpTotal(remaining).feeCents`), so the fee quoted in
 * the email matches what Stripe charges.
 * @param remainingCents amount owed in integer cents
 * @param passCardFee the event's pass-card-fee flag
 * @returns fee in integer cents (0 when not passed on or nothing owed)
 */
export async function fundraiserSurchargeCents(remainingCents: number, passCardFee: boolean): Promise<number> {
  if (!passCardFee || remainingCents <= 0) return 0
  return surchargeCentsFor(remainingCents, await getCardFeeConfig())
}

/**
 * Pure form of `fundraiserSurchargeCents` for a fee config already loaded, so a
 * batch (the reminder loop) reads the card-fee settings once, not per entry.
 * @param remainingCents amount owed in integer cents
 * @param cfg card-fee config (`getCardFeeConfig()` result)
 * @returns fee in integer cents (0 when nothing owed)
 */
export function surchargeCentsFor(remainingCents: number, cfg: { pct: number; fixedCents: number }): number {
  if (remainingCents <= 0) return 0
  return roundCentsForCurrency(grossUpTotal(remainingCents, cfg.pct, cfg.fixedCents).feeCents)
}

/**
 * Open (or reuse) a Stripe Checkout Session paying an entry's remaining balance.
 * Mirrors `createExistingRegistrationCheckoutSession`: the entry row is locked in
 * a transaction so concurrent clicks serialise, a live open session for the same
 * amount is reused, stale or duplicate open sessions are expired, and the staged
 * `CheckoutSession` carries `fundraiserEntryId` for the webhook. Remaining is
 * re-read under the lock, so a cash payment recorded meanwhile is respected.
 *
 * Runs Serializable, like `deleteEntry` / `updateEntryQuantity`: a Serializable
 * delete's snapshot predates its wait on the row lock, so against a Read
 * Committed checkout it could miss the just-staged OPEN session and delete the
 * entry under a payable checkout. With both sides Serializable, Postgres SSI
 * aborts one (P2034). The aborted attempt's Stripe session (if any) is expired,
 * then the whole attempt is retried against committed state, up to
 * `MAX_TX_ATTEMPTS`.
 * @param entry entry id, public token and the caller's remaining (cents)
 * @param event the entry's event (title for the line item, card-fee flag)
 * @param origin trusted app base URL for Stripe's return redirects
 * @returns the Stripe Checkout URL
 * @throws FundraiserNotPayableError when nothing remains or a payment is settling
 */
export async function createFundraiserCheckoutSession(
  entry: { id: number; publicToken: string; remainingCents: number },
  event: { id: number; slug: string; title: string; passCardFee: boolean },
  origin: string,
): Promise<{ url: string }> {
  if (entry.remainingCents <= 0) throw new FundraiserNotPayableError()
  const stripe = getStripe()
  const payUrl = `${origin}/pay/fundraiser/${entry.publicToken}`

  let createdSessionId: string | null = null
  for (let attempt = 1; ; attempt++) {
    createdSessionId = null
    try {
      return await prisma.$transaction(async (tx) => {
        // Same FOR UPDATE lock the staff payment/delete actions take, so this
        // serialises with them and with a twin pay click.
        // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
        const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "FundraiserEntry" WHERE id = ${entry.id} FOR UPDATE` // nosemgrep: crm-no-raw-sql
        if (locked.length === 0) throw new FundraiserNotPayableError()
        const row = await tx.fundraiserEntry.findUnique({
          where: { id: entry.id },
          select: { quantity: true, unitPrice: true, payments: { select: { amount: true } } },
        })
        if (!row) throw new FundraiserNotPayableError()
        const remainingCents = entryTotals(row, row.payments).remainingCents
        if (remainingCents <= 0) throw new FundraiserNotPayableError()
        const surchargeCents = await fundraiserSurchargeCents(remainingCents, event.passCardFee)

        const priors = await tx.checkoutSession.findMany({
          where: { fundraiserEntryId: entry.id, status: "OPEN" },
          orderBy: { createdAt: "desc" },
          select: { stripeSessionId: true, totalAmount: true, surchargeCents: true },
        })
        const live = await Promise.all(priors.map((p) => stripe.checkout.sessions.retrieve(p.stripeSessionId)))
        // Paid, webhook not processed yet: the balance is about to drop. A new
        // session now could charge the same balance twice.
        const paid = live.some((s) => s.status === "complete")
        const sameAmount = (i: number) =>
          toCents(priors[i].totalAmount) === remainingCents && priors[i].surchargeCents === surchargeCents
        const reuse = paid
          ? undefined
          : live.find((s, i) => s.status === "open" && s.url && sameAmount(i) && s.expires_at * 1000 - Date.now() > REUSE_MIN_REMAINING_MS)
        // Near expiry, stale amount, or a duplicate: expire so it can't also be paid.
        for (const s of live) {
          if (s.status === "open" && s !== reuse) await stripe.checkout.sessions.expire(s.id)
        }
        if (paid) throw new FundraiserNotPayableError()
        if (reuse?.url) return { url: reuse.url }

        const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
          {
            quantity: 1,
            price_data: {
              currency: STRIPE_CURRENCY,
              unit_amount: toStripeAmount(remainingCents),
              product_data: { name: `${event.title} — Fundraiser payment` },
            },
          },
        ]
        if (surchargeCents > 0) {
          line_items.push({
            quantity: 1,
            price_data: {
              currency: STRIPE_CURRENCY,
              unit_amount: toStripeAmount(surchargeCents),
              product_data: { name: "Card processing fee" },
            },
          })
        }

        const metadata = { fundraiserEntryId: String(entry.id), eventId: String(event.id) }
        const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRY_MS)
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items,
          expires_at: Math.floor(expiresAt.getTime() / 1000),
          success_url: `${payUrl}?paid=1`,
          cancel_url: payUrl,
          metadata,
          payment_intent_data: { metadata },
        })
        createdSessionId = session.id
        if (!session.url) throw new Error("Stripe returned no checkout URL")

        await tx.checkoutSession.create({
          data: {
            stripeSessionId: session.id,
            eventId: event.id,
            fundraiserEntryId: entry.id,
            payload: "",
            totalAmount: centsToDecimalString(remainingCents),
            surchargeCents,
            expiresAt,
          },
        })
        return { url: session.url }
      }, { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (e) {
      // The tx failed after a session was created: it has no staging row, so
      // expire it rather than leave it payable.
      if (createdSessionId) {
        try {
          await stripe.checkout.sessions.expire(createdSessionId)
        } catch {
          // best effort — surface the original failure
        }
      }
      if (isP2034(e) && attempt < MAX_TX_ATTEMPTS) continue
      throw e
    }
  }
}
