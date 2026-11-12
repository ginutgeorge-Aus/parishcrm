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

/** A prior session as seen from Stripe; `session` is null when it could not be retrieved. */
type LivePrior = { session: Stripe.Checkout.Session | null; gone: boolean }

/**
 * True when a Stripe error says the object does not exist (deleted, or from
 * another account/mode). Such a session can never be paid.
 * @param e thrown value
 * @returns whether it is Stripe's `resource_missing`
 */
function isResourceMissing(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "resource_missing"
}

/**
 * Retrieve one prior session, treating a failure as a dead session so one bad
 * row cannot block every checkout for the entry. `gone` marks a session Stripe
 * says does not exist (safe to mark its staging row EXPIRED).
 * @param stripe Stripe client
 * @param id Checkout Session id
 * @returns the session, or null with `gone` set for resource_missing
 */
async function retrievePrior(stripe: Stripe, id: string): Promise<LivePrior> {
  try {
    return { session: await stripe.checkout.sessions.retrieve(id), gone: false }
  } catch (e) {
    console.warn(`Fundraiser checkout: could not retrieve prior session ${id}; treating it as dead`, e instanceof Error ? e.message : e)
    return { session: null, gone: isResourceMissing(e) }
  }
}

/**
 * Best-effort: expire every OPEN card checkout staged for an entry, in Stripe
 * and in the staging table. Used when the amount owed changes (quantity edit),
 * so a session priced for the old amount cannot still be paid. A row is marked
 * EXPIRED only once Stripe confirms the session is dead (expired now, already
 * expired, or missing); a completed session is left for its webhook. Never
 * throws: a Stripe or DB failure is logged and the sweep cleans up later.
 * @param entryId FundraiserEntry id
 * @returns number of staging rows marked EXPIRED
 */
export async function expireOpenFundraiserCheckouts(entryId: number): Promise<number> {
  try {
    const open = await prisma.checkoutSession.findMany({
      where: { fundraiserEntryId: entryId, status: "OPEN" },
      select: { stripeSessionId: true },
    })
    if (open.length === 0) return 0
    const stripe = getStripe()
    const dead: string[] = []
    for (const { stripeSessionId: id } of open) {
      try {
        await stripe.checkout.sessions.expire(id)
        dead.push(id)
      } catch (e) {
        if (isResourceMissing(e)) {
          dead.push(id)
          continue
        }
        // Expire refuses a session that is not open: check whether it is already dead.
        const { session, gone } = await retrievePrior(stripe, id)
        if (gone || session?.status === "expired") dead.push(id)
      }
    }
    if (dead.length === 0) return 0
    const r = await prisma.checkoutSession.updateMany({
      where: { stripeSessionId: { in: dead }, status: "OPEN" },
      data: { status: "EXPIRED", payload: "" },
    })
    return r.count
  } catch (e) {
    console.warn(`Fundraiser checkout: expiring open sessions for entry ${entryId} failed`, e instanceof Error ? e.message : e)
    return 0
  }
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
 *
 * Stripe calls stay inside the transaction on purpose: the entry lock must span
 * the retrieve → expire → create decision, or two clicks could each open a
 * payable session. A prior session that cannot be retrieved is treated as dead
 * (not reused, not blocking). Prior rows whose session is dead (expired here,
 * already expired, or missing in Stripe) are marked EXPIRED in the same
 * transaction, so `deleteEntry` is not blocked by them until the sweep.
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
        const live = await Promise.all(priors.map((p) => retrievePrior(stripe, p.stripeSessionId)))
        // Paid, webhook not processed yet: the balance is about to drop. A new
        // session now could charge the same balance twice.
        const paid = live.some((l) => l.session?.status === "complete")
        const sameAmount = (i: number) =>
          toCents(priors[i].totalAmount) === remainingCents && priors[i].surchargeCents === surchargeCents
        const reuse = paid
          ? undefined
          : live.find((l, i) => {
              const s = l.session
              return s?.status === "open" && s.url && sameAmount(i) && s.expires_at * 1000 - Date.now() > REUSE_MIN_REMAINING_MS
            })?.session
        // Near expiry, stale amount, or a duplicate: expire so it can't also be paid.
        const dead: string[] = []
        for (const [i, { session: s, gone }] of live.entries()) {
          if (s?.status === "open" && s !== reuse) {
            await stripe.checkout.sessions.expire(s.id)
            dead.push(s.id)
          } else if (gone || s?.status === "expired") {
            dead.push(priors[i].stripeSessionId)
          }
        }
        if (paid) throw new FundraiserNotPayableError()
        if (dead.length > 0) {
          await tx.checkoutSession.updateMany({
            where: { stripeSessionId: { in: dead }, status: "OPEN" },
            data: { status: "EXPIRED", payload: "" },
          })
        }
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
