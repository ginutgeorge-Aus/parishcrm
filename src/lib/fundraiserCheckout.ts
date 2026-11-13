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
// Stripe charge limits, in app cents: the 0.50 minimum of AUD/USD/EUR and most
// two-decimal currencies, and Stripe's 8-digit amount maximum (999,999.99).
// https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
const STRIPE_MIN_CHARGE_CENTS = 50
const STRIPE_MAX_CHARGE_CENTS = 99_999_999

/** Nothing is owed on the entry, it is gone, or a card payment for it is already settling. */
export class FundraiserNotPayableError extends Error {}

/** The balance (plus card fee) is outside what Stripe can charge in one payment. */
export class FundraiserAmountOutOfRangeError extends Error {}

/**
 * A prior open session for the entry could not be checked in Stripe (timeout,
 * 5xx). Opening a new session then could leave two payable sessions for one
 * balance, so the payer is asked to retry instead.
 */
export class FundraiserCheckoutBusyError extends Error {}

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
 * Whether a Stripe error is a permanent client error that retrying cannot fix
 * (auth, permission, invalid request: e.g. a rotated key or a session id from
 * another account). Such a prior session can never be paid by us. Network
 * failures (no HTTP status), 5xx, 408, 409 and 429 are transient.
 * @param e thrown value
 * @returns true for a permanent 4xx
 */
function isPermanentClientError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false
  const { statusCode, type } = e as { statusCode?: unknown; type?: unknown }
  if (type === "StripeAuthenticationError" || type === "StripePermissionError" || type === "StripeInvalidRequestError") return true
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 && ![408, 409, 429].includes(statusCode)
}

/**
 * Retrieve one prior session without throwing. `gone` marks a session that can
 * never be paid (Stripe says it does not exist, or a permanent 4xx such as a
 * rotated key): safe to mark its staging row EXPIRED and not block checkout.
 * `session: null` with `gone: false` is a transient failure (network, 5xx,
 * 429), so the session's state is unknown.
 * @param stripe Stripe client
 * @param id Checkout Session id
 * @returns the session, or null with `gone` set for resource_missing / permanent 4xx
 */
async function retrievePrior(stripe: Stripe, id: string): Promise<LivePrior> {
  try {
    return { session: await stripe.checkout.sessions.retrieve(id), gone: false }
  } catch (e) {
    console.warn("Fundraiser checkout: could not retrieve prior session %s: %s", String(id), e instanceof Error ? e.message : String(e))
    return { session: null, gone: isResourceMissing(e) || isPermanentClientError(e) }
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
    console.warn("Fundraiser checkout: expiring open sessions for entry %s failed: %s", String(entryId), e instanceof Error ? e.message : String(e))
    return 0
  }
}

/**
 * Retrieve every OPEN prior session of an entry from Stripe, outside any lock.
 * One indexed DB read first; Stripe is only called when OPEN rows exist. Never
 * throws: a DB failure returns an empty map (the caller then retrieves each
 * prior under the lock), and `retrievePrior` already absorbs Stripe errors.
 * @param stripe Stripe client
 * @param entryId FundraiserEntry id
 * @returns live state keyed by Checkout Session id
 */
async function prefetchPriors(stripe: Stripe, entryId: number): Promise<Map<string, LivePrior>> {
  let open: { stripeSessionId: string }[]
  try {
    open = await prisma.checkoutSession.findMany({
      where: { fundraiserEntryId: entryId, status: "OPEN" },
      select: { stripeSessionId: true },
    })
  } catch (e) {
    // Optimisation only: on a DB error, priors are retrieved under the lock instead.
    console.warn("Fundraiser checkout: prefetching prior sessions for entry %s failed: %s", String(entryId), e instanceof Error ? e.message : String(e))
    return new Map()
  }
  // Common case (first pay click): no OPEN rows, so no Stripe call at all.
  if (open.length === 0) return new Map()
  const pairs = await Promise.all(
    open.map(async ({ stripeSessionId: id }) => [id, await retrievePrior(stripe, id)] as const),
  )
  return new Map(pairs)
}

/**
 * Expire a session believed open. If Stripe refuses (the prefetched state was
 * stale), re-check it live instead of failing the checkout.
 * @param stripe Stripe client
 * @param id Checkout Session id
 * @returns "dead" when it can no longer be paid, "complete" when it was paid
 * @throws the original expire error when the session may still be payable
 *   (still open, or the re-check failed): never open a second payable session
 */
async function expireOrRecheck(stripe: Stripe, id: string): Promise<"dead" | "complete"> {
  try {
    await stripe.checkout.sessions.expire(id)
    return "dead"
  } catch (e) {
    if (isResourceMissing(e)) return "dead"
    const { session, gone } = await retrievePrior(stripe, id)
    if (gone || session?.status === "expired") return "dead"
    if (session?.status === "complete") return "complete"
    throw e
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
 * Prior sessions are retrieved from Stripe BEFORE the lock (`prefetchPriors`,
 * once per attempt), so the lock is not held across N retrieve round-trips. The
 * expire → create decision stays inside the lock, or two clicks could each open
 * a payable session. A stale prefetch is safe: every state it can go stale
 * towards is terminal (complete / expired), an "open" prior is only ever reused
 * (harmless if it was paid meanwhile) or expired (and an expire that Stripe
 * refuses is re-checked live: dead → marked EXPIRED, paid → not payable), and
 * a prior staged after the prefetch is retrieved inside the lock. A prior
 * session Stripe says is missing is treated as dead; one that cannot be
 * retrieved for a transient reason (timeout, 5xx), in the prefetch and again
 * under the lock, may still be open or paid, so no new session is opened
 * (FundraiserCheckoutBusyError). Prior rows whose session is dead (expired here,
 * already expired, or missing in Stripe) are marked EXPIRED in the same
 * transaction, so `deleteEntry` is not blocked by them until the sweep.
 * @param entry entry id, public token and the caller's remaining (cents)
 * @param event the entry's event (title for the line item, card-fee flag)
 * @param origin trusted app base URL for Stripe's return redirects
 * @returns the Stripe Checkout URL
 * A P2034 retry happens only when the aborted attempt opened no Stripe session
 * or that session was expired: a still-payable orphan plus a retry's new session
 * would leave two payable sessions for one balance, so that case throws.
 * @throws FundraiserNotPayableError when nothing remains or a payment is settling
 * @throws FundraiserAmountOutOfRangeError when the charge is outside Stripe's limits
 * @throws FundraiserCheckoutBusyError when a prior open session could not be checked
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
    // Per attempt: an aborted attempt may have expired sessions in Stripe.
    const prefetched = await prefetchPriors(stripe, entry.id)
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
        const chargeCents = remainingCents + surchargeCents
        if (chargeCents < STRIPE_MIN_CHARGE_CENTS || chargeCents > STRIPE_MAX_CHARGE_CENTS) {
          throw new FundraiserAmountOutOfRangeError(`Charge of ${chargeCents} cents is outside Stripe's limits`)
        }

        const priors = await tx.checkoutSession.findMany({
          where: { fundraiserEntryId: entry.id, status: "OPEN" },
          orderBy: { createdAt: "desc" },
          select: { stripeSessionId: true, totalAmount: true, surchargeCents: true },
        })
        const live = await Promise.all(
          priors.map((p) => {
            const pre = prefetched.get(p.stripeSessionId)
            // A transient prefetch failure is re-checked under the lock.
            return pre && (pre.session !== null || pre.gone) ? pre : retrievePrior(stripe, p.stripeSessionId)
          }),
        )
        // Unknown state (transient Stripe failure): it may be open or already
        // paid. Opening another session could charge the balance twice.
        if (live.some((l) => l.session === null && !l.gone)) throw new FundraiserCheckoutBusyError()
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
        let paidSince = false
        for (const [i, { session: s, gone }] of live.entries()) {
          if (s?.status === "open" && s !== reuse) {
            const now = await expireOrRecheck(stripe, s.id)
            if (now === "complete") paidSince = true
            else dead.push(s.id)
          } else if (gone || s?.status === "expired") {
            dead.push(priors[i].stripeSessionId)
          }
        }
        if (paid || paidSince) throw new FundraiserNotPayableError()
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
      let orphanLive = false
      if (createdSessionId) {
        try {
          await stripe.checkout.sessions.expire(createdSessionId)
        } catch (expireErr) {
          orphanLive = true
          console.error(
            `Fundraiser checkout: could not expire orphan session ${createdSessionId} for entry ${entry.id}`,
            expireErr instanceof Error ? expireErr.message : expireErr,
          )
        }
      }
      // Never retry past a still-payable orphan: the retry would open a second one.
      if (isP2034(e) && attempt < MAX_TX_ATTEMPTS && !orphanLive) continue
      throw e
    }
  }
}
