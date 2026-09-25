// Stripe glue for the event-payments flow. No `next/server` import here — a
// Jest test importing this module must not pull in a Next.js route (see
// `docs/reference-jest-nextserver-route-trap.md`). Anything request-specific
// (headers, IP) stays in the caller (`src/lib/actions/eventCheckout.ts`).
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
import { encrypt, decrypt } from "@/lib/crypto"
import { toCents } from "@/lib/formatting"
import { STRIPE_CURRENCY, toStripeAmount, roundCentsForCurrency } from "@/lib/stripeAmount"
import { grossUpTotal } from "@/lib/cardFee"
import { getCardFeeConfig } from "@/lib/cardFeeSettings"
import { persistRegistration } from "@/lib/eventRegistrationPersist"
import type { PricedRegistration, EventWithTickets } from "@/lib/eventRegistrationPricing"
import { EVENT_CAPACITY_INCLUDE } from "@/lib/eventCapacityInclude"
import { notifyStripeAlert } from "@/lib/notifications"

// Stripe rejects `expires_at` under 30 minutes out — keep the staged
// CheckoutSession row's expiry aligned with the Stripe session's own expiry.
// 31 (not 30) min: a +1min buffer above Stripe's 30-min floor so network +
// processing latency can't land the value under the minimum by the time Stripe
// evaluates it, which would reject the CheckoutSession with InvalidRequestError.
const CHECKOUT_EXPIRY_MS = 31 * 60 * 1000

// Delayed/async settlement (e.g. BECS Direct Debit) can take several business
// days after `checkout.session.completed` first fires with an unsettled
// payment_status. While waiting, the staging row must survive the hourly
// sweep (checkoutSweep.ts) far longer than the normal 31-min checkout window
// — otherwise the sweep scrubs it before async_payment_succeeded arrives and
// the eventual PAID webhook silently no-ops. 10 days is a safe upper
// bound above Stripe's documented BECS settlement window.
const DELAYED_SETTLEMENT_EXPIRY_MS = 10 * 24 * 60 * 60 * 1000

// Per-ticket line items give a readable Stripe receipt, but their sum only
// equals priced.totalAmount when NO event-level discount applies. Tiered
// family pricing and the family fee waiver both set
// totalAmount BELOW the per-ticket sum while items keep the true unitPrice
// snapshot. Charging the per-ticket sum then would (a) overcharge the payer
// the discount and (b) fail the webhook amount-match (expectedCents uses
// totalAmount) → money taken, no registration created. Stripe Checkout
// forbids negative line items, so when a discount applies we collapse to a
// single summary line at the net total. The webhook's expectedCents
// (toCents(totalAmount) + surcharge) then always matches amount_total.
async function buildLineItemsAndSurcharge(
  event: { title: string; passCardFee: boolean; ticketTypes: { id: number; name: string }[] },
  items: Array<{ ticketTypeId: number; quantity: number; unitPrice: import("@/lib/generated/prisma/client").Prisma.Decimal | string | number }>,
  netCents: number,
): Promise<{
  line_items: import("stripe").Stripe.Checkout.SessionCreateParams.LineItem[]
  surchargeCents: number
}> {
  const rawCents = items.reduce((sum, it) => sum + toCents(it.unitPrice) * it.quantity, 0)
  const line_items: import("stripe").Stripe.Checkout.SessionCreateParams.LineItem[] =
    rawCents === netCents
      ? // Drop $0 items (e.g. a free "Child" ticket in an otherwise-paid order):
        // Stripe Checkout rejects a line item with unit_amount 0. netCents > 0 here
        // (the caller 400s a free registration) and rawCents === netCents, so at
        // least one priced item survives — line_items is never left empty.
        items
          .filter((it) => toCents(it.unitPrice) > 0)
          .map((it) => {
            const tt = event.ticketTypes.find((t) => t.id === it.ticketTypeId)
            return {
              quantity: it.quantity,
              price_data: {
                currency: STRIPE_CURRENCY,
                unit_amount: toStripeAmount(toCents(it.unitPrice)),
                product_data: { name: `${event.title} — ${tt?.name ?? "Ticket"}` },
              },
            }
          })
      : [
          {
            quantity: 1,
            price_data: {
              currency: STRIPE_CURRENCY,
              unit_amount: toStripeAmount(netCents),
              product_data: { name: `${event.title} — Registration` },
            },
          },
        ]

  // Optionally pass the Stripe card fee to the registrant. Exact gross-up so the
  // church nets the ticket price. Bank-transfer path never reaches here.
  // net===0 (free/waived) → no fee. `surchargeCents` is snapshotted onto the
  // staging row below so the webhook matches against the exact amount charged
  // (immune to a rate/flag change in the checkout→webhook window).
  let surchargeCents = 0
  if (event.passCardFee && netCents > 0) {
    const cfg = await getCardFeeConfig()
    surchargeCents = roundCentsForCurrency(grossUpTotal(netCents, cfg.pct, cfg.fixedCents).feeCents)
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
  }
  return { line_items, surchargeCents }
}

export async function createEventCheckoutSession(
  event: EventWithTickets,
  priced: PricedRegistration,
  origin: string,
): Promise<{ url: string }> {
  const stripe = getStripe()

  // Prices are recomputed server-side by validateAndPriceRegistration — never
  // trust client-sent amounts. Integer cents via toCents (no float math).
  const netCents = toCents(priced.totalAmount)

  // Line-item collapse (discount) + card-fee surcharge rules live in
  // buildLineItemsAndSurcharge — see its comment for why.
  const { line_items, surchargeCents } = await buildLineItemsAndSurcharge(event, priced.items, netCents)

  const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRY_MS)
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    success_url: `${origin}/e/${event.slug}/success?token={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/e/${event.slug}?canceled=1`,
    // Tag both the session and the PaymentIntent so charge.* webhook events and
    // Stripe→CRM reconciliation/support lookups can resolve the event.
    metadata: { eventSlug: event.slug, eventId: String(event.id) },
    payment_intent_data: {
      metadata: { eventSlug: event.slug, eventId: String(event.id) },
    },
  })
  if (!session.url) throw new Error("Stripe returned no checkout URL")

  // Stage the priced registration ENCRYPTED — this row holds full registrant
  // PII (name, email, attendee names/answers) until the webhook confirms
  // payment and persists the real Registration (Task 5/6).
  await prisma.checkoutSession.create({
    data: {
      stripeSessionId: session.id,
      eventId: event.id,
      payload: encrypt(JSON.stringify(priced)),
      totalAmount: priced.totalAmount,
      surchargeCents,
      expiresAt,
    },
  })

  return { url: session.url }
}

// Pay-now for an EXISTING PENDING registration (reached from the payment-reminder
// success page). Unlike createEventCheckoutSession this does NOT stage new
// registrant PII — the Registration already exists — so payload is "". The
// staging row carries registrationId; the webhook marks THAT registration PAID.
// The registration is no longer awaiting payment (settled, cancelled, or its
// prior checkout already paid) — caller maps this to a 400.
export class RegistrationNotPayableError extends Error {}

// Reuse a prior open session only if the payer still has time to finish it.
const REUSE_MIN_REMAINING_MS = 5 * 60 * 1000

export async function createExistingRegistrationCheckoutSession(
  event: { id: number; slug: string; title: string; passCardFee: boolean; ticketTypes: { id: number; name: string }[] },
  registration: {
    id: number
    publicToken: string
    totalAmount: import("@/lib/generated/prisma/client").Prisma.Decimal | string | number
    items: { ticketTypeId: number; quantity: number; unitPrice: import("@/lib/generated/prisma/client").Prisma.Decimal | string | number }[]
  },
  origin: string,
): Promise<{ url: string }> {
  const stripe = getStripe()
  const netCents = toCents(registration.totalAmount)
  const { line_items, surchargeCents } = await buildLineItemsAndSurcharge(event, registration.items, netCents)

  // two concurrent pay-now requests (two tabs, reminder link + button)
  // must not each open a payable session for one registration. The no-op
  // UPDATE row-locks the still-PENDING registration so requests serialize;
  // the loser then finds the winner's staged session and reuses it. The
  // Stripe calls sit inside the tx on purpose — the lock must span them.
  let createdSessionId: string | null = null
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.registration.updateMany({
        where: { id: registration.id, paymentStatus: "PENDING" },
        data: { paymentStatus: "PENDING" },
      })
      if (locked.count === 0) throw new RegistrationNotPayableError()
      // Check EVERY open row, not just the newest — requests before this fix
      // could stage several for one registration. Leave at most one payable.
      // One query (one snapshot) also picks up a row a webhook has claimed
      // (OPEN→COMPLETED) but not yet settled onto the registration (no token):
      // that payment is in flight. A row claimed just after this snapshot still
      // reads OPEN here, but Stripe reports it `complete` below.
      const priors = await tx.checkoutSession.findMany({
        where: {
          registrationId: registration.id,
          OR: [{ status: "OPEN" }, { status: "COMPLETED", publicToken: null }],
        },
        orderBy: { createdAt: "desc" },
        select: { stripeSessionId: true },
      })
      const live = await Promise.all(priors.map((p) => stripe.checkout.sessions.retrieve(p.stripeSessionId)))
      // Paid, but checkout.session.completed not processed yet — a second
      // session would be a second charge. Expire every still-open one first so
      // no tab stays payable alongside it.
      const paid = live.some((sess) => sess.status === "complete")
      const open = live.filter((sess) => sess.status === "open")
      const reuse = paid
        ? undefined
        : open.find((sess) => sess.url && sess.expires_at * 1000 - Date.now() > REUSE_MIN_REMAINING_MS)
      // Near expiry, or an older duplicate — expire so it can't also be paid.
      for (const sess of open) {
        if (sess !== reuse) await stripe.checkout.sessions.expire(sess.id)
      }
      if (paid) throw new RegistrationNotPayableError()
      if (reuse?.url) return { url: reuse.url }

      const expiresAt = new Date(Date.now() + CHECKOUT_EXPIRY_MS)
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: `${origin}/e/${event.slug}/success?token={CHECKOUT_SESSION_ID}`,
        // Cancel returns to THIS registration's pending success page (bank details +
        // pay-now button), not the blank registration form.
        cancel_url: `${origin}/e/${event.slug}/success?ref=${registration.publicToken}`,
        metadata: { eventSlug: event.slug, eventId: String(event.id) },
        payment_intent_data: { metadata: { eventSlug: event.slug, eventId: String(event.id) } },
      })
      createdSessionId = session.id
      if (!session.url) throw new Error("Stripe returned no checkout URL")

      await tx.checkoutSession.create({
        data: {
          stripeSessionId: session.id,
          eventId: event.id,
          registrationId: registration.id,
          payload: "",
          totalAmount: registration.totalAmount,
          surchargeCents,
          expiresAt,
        },
      })

      return { url: session.url }
    }, { timeout: 20_000 })
  } catch (e) {
    // The tx failed (e.g. timed out on slow Stripe calls) after a session was
    // created — it has no staging row, so expire it rather than leave it payable.
    if (createdSessionId) {
      try {
        await stripe.checkout.sessions.expire(createdSessionId)
      } catch {
        // best effort — surface the original failure
      }
    }
    throw e
  }
}

// Verifies + routes Stripe webhook deliveries for the event-payments flow.
// Signature verification gates everything; the raw body is never logged (it
// could appear in an error from a malformed/forged request).
//
// Church policy: NO ticket refunds ([[project-no-ticket-refunds]]). The three
// "charged but undelivered" safety paths keep the money and emit an ops signal
// (console.error) for a human to resolve — never stripe.refunds.create.
// Stripe-side reversals (charge.refunded full / charge.dispute.created) still
// flip the Registration to CANCELLED so the seat frees; those REACT to a
// reversal done in Stripe, they don't issue one.
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
): Promise<{ status: number }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    // Own-side misconfig, not routine bad traffic: an unset/corrupt webhook
    // secret 400s EVERY delivery (checkout.completed, refund, dispute) with no
    // app-level signal — registrations silently stop completing. Log it
    // loud, like the sibling secret-gated cron entrypoints.
    console.error("STRIPE_WEBHOOK_SECRET unset/corrupt — all webhook deliveries will 400")
    return { status: 400 }
  }
  if (!signature) return { status: 400 } // routine bad/forged traffic — never log

  const stripe = getStripe()
  let event: import("stripe").Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch {
    return { status: 400 } // bad signature — never log the raw body
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session
      // Delayed/async methods (e.g. BECS Direct Debit) fire `completed` with
      // payment_status unpaid|processing BEFORE money clears, then later fire
      // async_payment_succeeded|failed. Only an instantly-settled (card)
      // session is 'paid' here — persist only then.
      if (session.payment_status !== "paid") {
        // A live PaymentIntent is still in flight for this row — protect it
        // from the hourly sweep so it survives until settlement
        // resolves, however many days that takes. Idempotent: only an OPEN
        // row matches (mirrors async_payment_failed below).
        await prisma.checkoutSession.updateMany({
          where: { stripeSessionId: session.id, status: "OPEN" },
          data: { expiresAt: new Date(Date.now() + DELAYED_SETTLEMENT_EXPIRY_MS) },
        })
        return { status: 200 }
      }
      return completePaidCheckout(session)
    }
    case "checkout.session.async_payment_succeeded":
      return completePaidCheckout(event.data.object as import("stripe").Stripe.Checkout.Session)
    case "checkout.session.async_payment_failed": {
      // Debit failed — the staged PII must not persist. Mark the row terminal
      // (mirrors checkoutSweep). Idempotent: only an OPEN row matches.
      const session = event.data.object as import("stripe").Stripe.Checkout.Session
      await prisma.checkoutSession.updateMany({
        where: { stripeSessionId: session.id, status: "OPEN" },
        data: { status: "EXPIRED", payload: "" },
      })
      return { status: 200 }
    }
    case "charge.refunded": {
      const charge = event.data.object as import("stripe").Stripe.Charge
      // Only a FULL refund cancels the seat. A partial refund is an edge that
      // needs a human look (church refunds are all-or-nothing) — signal, no cancel.
      if (charge.amount_refunded >= charge.amount) {
        return cancelRegistrationByPaymentIntent(piOf(charge.payment_intent), "refund")
      } else {
        console.error(`Stripe webhook: partial refund on charge ${charge.id}; no cancel, manual review`)
        await notifyStripeAlert(
          "partial refund — no auto-cancel",
          `Charge ${charge.id}: partial refund (${charge.amount_refunded} of ${charge.amount}). Seat left active; church refunds are all-or-nothing — review manually.`,
        )
      }
      return { status: 200 }
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as import("stripe").Stripe.Dispute
      return cancelRegistrationByPaymentIntent(piOf(dispute.payment_intent), "dispute")
    }
    default:
      return { status: 200 } // unhandled event type
  }
}

// Claims the staged CheckoutSession (atomic OPEN→COMPLETED) and persists the
// real Registration as PAID. The ONLY place a paid Registration is created —
// never trust a success-page redirect. Contains NO refund calls (see the policy
// note on handleStripeWebhook): on any "charged but undelivered" outcome it
// keeps the money and emits an ops signal.
async function completePaidCheckout(
  session: import("stripe").Stripe.Checkout.Session,
): Promise<{ status: number }> {
  const staging = await prisma.checkoutSession.findUnique({ where: { stripeSessionId: session.id } })
  if (!staging) {
    // A paid session with NO staging row means the row was cascade-deleted out
    // from under an in-flight checkout — e.g. deleteEvent wiped the event (and
    // its CheckoutSessions) while the customer was on the Stripe page.
    // Money is retained (no-refund policy) and the CRM has zero record of it.
    // Every other charged-but-undelivered branch alerts ops; this one must too
    // rather than a silent 200. This Stripe account is single-purpose (event
    // Checkout Sessions only), so a completed session we never staged is always
    // a real lost registration, not a stray third-party event.
    console.error(
      `Stripe webhook: paid session ${session.id} has no staging row (cascade-deleted mid-checkout?); money retained, no registration exists, manual review needed`,
    )
    await notifyStripeAlert(
      "charged but no staging row — session vanished",
      `Session ${session.id}: payment settled but the staged CheckoutSession no longer exists (event likely deleted mid-checkout). No registration created. Money retained; resolve manually.`,
    )
    return { status: 200 }
  }
  if (staging.status !== "OPEN") {
    // Crash-recovery: a prior pass claimed COMPLETED and persisted the
    // registration, but the process died before the publicToken write (that
    // write is not inside persistRegistration's transaction), leaving a
    // COMPLETED row with no token. Stripe redelivers and lands here. Recover
    // idempotently by matching this session's PaymentIntent to its registration
    // and backfilling the token so the success page can resolve it. A
    // genuine withheld-token duplicate never reaches this branch — it's
    // terminalized UNFULFILLED, not COMPLETED — so no registration for this PI
    // means a real anomaly worth an ops signal, not the benign dup case.
    if (staging.status === "COMPLETED" && !staging.publicToken) {
      const pi = piOf(session.payment_intent)
      const reg = pi
        ? await prisma.registration.findFirst({
            where: { paymentRef: pi, eventId: staging.eventId },
            select: { publicToken: true },
          })
        : null
      if (reg) {
        await prisma.checkoutSession.update({
          where: { id: staging.id },
          data: { publicToken: reg.publicToken },
        })
      } else {
        console.error(
          `Stripe webhook: COMPLETED session ${session.id} has no publicToken and no registration matches its PaymentIntent ${pi ?? "?"}; success page cannot resolve it, manual review needed`,
        )
        await notifyStripeAlert(
          "completed checkout missing its registration token",
          `Session ${session.id}: COMPLETED with no publicToken and no registration matches its PaymentIntent. The success page can't resolve it; resolve manually.`,
        )
      }
      return { status: 200 }
    }
    // COMPLETED/UNFULFILLED is a benign already-claimed redelivery race — that
    // outcome already signalled ops (or succeeded) on its own first pass, so
    // stay quiet. EXPIRED is different: the sweep scrubbed this row (e.g. the
    // delayed-settlement or unclaim-retry expiry extensions above still ran
    // out, or predate this fix) and a paid webhook has now arrived for a row
    // with no Registration and no PII left to recover it from. Money
    // is retained (no-refund policy) — that must not be a silent 200.
    if (staging.status === "EXPIRED") {
      console.error(
        `Stripe webhook: paid session ${session.id} matched an already-EXPIRED staging row; no registration exists, money retained, manual review needed`,
      )
      await notifyStripeAlert(
        "charged but no registration — checkout already expired",
        `Session ${session.id}: payment settled after the staging row had already expired. No registration was created for this payment. Money retained; resolve manually.`,
      )
    }
    return { status: 200 }
  }

  // Atomically claim the row: flip OPEN→COMPLETED in a single conditional
  // UPDATE before any side effect. Stripe retries delivery, so two near-
  // simultaneous redeliveries can both pass the findUnique above; only the one
  // whose updateMany matches (count===1) owns the transition and proceeds — the
  // loser no-ops. Prevents double registration (TOCTOU).
  const claim = await prisma.checkoutSession.updateMany({
    where: { id: staging.id, status: "OPEN" },
    data: { status: "COMPLETED", completedAt: new Date() },
  })
  if (claim.count === 0) return { status: 200 } // another delivery already claimed it

  // Everything below the claim can throw for reasons that are NOT a deliberate
  // "charged but undelivered" outcome (decrypt failure, a transient DB error
  // inside persistRegistration, etc). Those deliberate outcomes each `return`
  // their own 200 below and are NOT caught here — only an actual exception is.
  // Without this, the row would already be COMPLETED (see the claim above) so
  // a Stripe retry would hit the `staging.status !== "OPEN"` guard at the top
  // of this function and silently no-op — money taken, registration lost for
  // good. On catch we unclaim back to OPEN so a redelivery can retry,
  // and return 500 so Stripe actually redelivers.
  try {
    // Existing-registration pay-now (Task): the staging row references an already
    // -created Registration — mark THAT row PAID instead of persisting a new one.
    if (staging.registrationId != null) {
      return await completeExistingRegistrationPayment(session, staging)
    }

    const priced = JSON.parse(decrypt(staging.payload)) as PricedRegistration
    // Re-fetch the event with the SAME capacity-filter shape as the public
    // register endpoint (fetchEventWithTickets in eventRegistration.ts) — by id
    // here since the staging row only carries eventId, not slug. Both fetches
    // import EVENT_CAPACITY_INCLUDE from the shared leaf module so they can
    // never silently drift apart.
    const fullEvent = await prisma.event.findUnique({
      where: { id: staging.eventId },
      include: EVENT_CAPACITY_INCLUDE,
    })

    const paymentIntent = piOf(session.payment_intent)

    // Defense-in-depth: the amount Stripe actually charged must equal the total
    // we priced server-side (net price + the surcharge snapshotted on the staging
    // row at checkout — 0 when not surcharged). line_items are server-set (never
    // payer-mutable), so a mismatch should be unreachable — but if it ever drifts,
    // do NOT create a registration. Money is retained (no-refund policy); ops
    // resolves manually. Row is already COMPLETED so Stripe won't redeliver. Using
    // the stored snapshot — not a live recompute — means a fee-rate or passCardFee
    // change between checkout and webhook can never falsely reject a correct charge.
    const expectedCents = toCents(priced.totalAmount) + staging.surchargeCents
    if (session.amount_total !== toStripeAmount(expectedCents)) {
      console.error(
        `Stripe webhook: amount mismatch (charged ${session.amount_total}, expected ${toStripeAmount(expectedCents)}) for PI ${paymentIntent ?? "?"}; no registration, money retained, manual review needed`,
      )
      await notifyStripeAlert(
        "amount mismatch — money retained",
        `Charged ${session.amount_total}, expected ${toStripeAmount(expectedCents)} for PI ${paymentIntent ?? "?"} (session ${session.id}). No registration created.`,
      )
      // Terminal: no registration was created and none will be. Mark the row
      // UNFULFILLED so the success page tells the customer explicitly instead
      // of "being finalised" forever. Payload is kept — ops needs it to
      // resolve the retained payment manually.
      await prisma.checkoutSession.update({ where: { id: staging.id }, data: { status: "UNFULFILLED" } })
      return { status: 200 }
    }

    // `!fullEvent` (the event was deleted between checkout and webhook) is treated
    // exactly like a persist failure: money already taken, row stays COMPLETED,
    // ops signalled. Returning without completing would leave the staging row
    // stuck OPEN forever (Stripe got its 200 and won't retry).
    const result = fullEvent
      ? await persistRegistration(fullEvent as unknown as EventWithTickets, priced, {
          paymentStatus: "PAID",
          paymentRef: paymentIntent ?? undefined,
        })
      : { ok: false as const, status: 500, error: "Event no longer exists" }

    if (!result.ok) {
      // Capacity gone / event deleted after the customer paid: keep the money
      // (no-refund policy) and signal ops. No publicToken written.
      console.error(
        `Stripe webhook: registration could not be created after payment for PI ${paymentIntent ?? "?"} (${result.error}); money retained, manual review needed`,
      )
      await notifyStripeAlert(
        "registration not created after payment — money retained",
        `PI ${paymentIntent ?? "?"} (session ${session.id}): ${result.error}. Customer charged, no seat delivered.`,
      )
      // Terminal: capacity gone / event deleted after payment. Mark the row
      // UNFULFILLED so the success page can tell the customer, rather than
      // stranding them on "being finalised". Payload retained for ops.
      await prisma.checkoutSession.update({ where: { id: staging.id }, data: { status: "UNFULFILLED" } })
      return { status: 200 }
    }

    // `duplicate:true` covers TWO different situations that must not be
    // treated the same:
    //  1. A genuine double-charge: two different Checkout Sessions
    //     (different PaymentIntents) for the same event+email both complete
    //     inside persistRegistration's dedupe window. A real second charge —
    //     alert-worthy.
    //  2. An expected SAME-session redelivery: the publicToken `update` below
    //     threw on a PRIOR pass after persistRegistration already succeeded,
    //     the outer catch unclaimed the row, and Stripe redelivered the
    //     identical event. persistRegistration finds its own registration and
    //     reports `duplicate: true`, but only one charge ever happened —
    //     alerting here would be a false "second charge" signal every time.
    // Distinguish them by comparing this event's PaymentIntent against the
    // one stored on the existing registration; only alert when they differ.
    let sameChargeRedelivered = false
    if (result.duplicate) {
      const existingReg = await prisma.registration.findUnique({
        where: { publicToken: result.ref },
        select: { paymentRef: true },
      })
      sameChargeRedelivered = !!paymentIntent && existingReg?.paymentRef === paymentIntent
      if (!sameChargeRedelivered) {
        console.error(
          `Stripe webhook: duplicate registration after payment for PI ${paymentIntent ?? "?"}; second charge retained, manual review needed`,
        )
        await notifyStripeAlert(
          "duplicate charge — second payment retained",
          `PI ${paymentIntent ?? "?"} (session ${session.id}): a second charge landed for an existing registration (${result.ref}). No new seat; money retained.`,
        )
      }
    }
    // A genuine duplicate (different payer/charge) must never write the
    // EXISTING registration's publicToken onto THIS payer's CheckoutSession
    // — that ref resolves on the success page (incl. the check-in QR),
    // so doing so would leak another payer's PII/credential to this one.
    // Only a same-session redelivery (one charge, one owner) may write it.
    if (!result.duplicate || sameChargeRedelivered) {
      await prisma.checkoutSession.update({
        where: { id: staging.id },
        data: { publicToken: result.ref },
      })
    } else {
      // Genuine duplicate charge: the existing registration's token is
      // withheld from this second payer. Terminalize the row as UNFULFILLED so
      // the success page shows the contact-us state, not "being finalised"
      // forever, and so a later redelivery isn't mistaken for the crash-
      // recovery case below (a COMPLETED row with no token → a persist that died
      // before the token write). Ops was already alerted above.
      await prisma.checkoutSession.update({
        where: { id: staging.id },
        data: { status: "UNFULFILLED" },
      })
    }

    return { status: 200 }
  } catch (err) {
    console.error(
      `Stripe webhook: unexpected error persisting registration for session ${session.id}; unclaiming to OPEN so Stripe can retry`,
      err,
    )
    // Email ops too — matching every sibling terminal branch. On a
    // persistent cause (corrupt/undecryptable payload, repeatable DB error) the
    // unclaim+500 loop below just retries silently for Stripe's ~3-day window;
    // without this alert, ops relying on the email channel never learns a
    // customer was charged with no registration until the sweep expires the row.
    await notifyStripeAlert(
      "persist failed after payment — money retained, Stripe retrying",
      `Session ${session.id}: payment settled but persisting the registration threw (${err instanceof Error ? err.message : String(err)}). Row unclaimed to OPEN for Stripe retry; if retries exhaust, the customer was charged with no seat. Resolve manually.`,
    )
    await prisma.checkoutSession.updateMany({
      where: { id: staging.id, status: "COMPLETED" },
      // Reset expiresAt too: an unclaim landing near the end of the
      // 31-min checkout window would otherwise leave too little runway for
      // Stripe's retry to land before the hourly sweep expires the row.
      data: { status: "OPEN", completedAt: null, expiresAt: new Date(Date.now() + CHECKOUT_EXPIRY_MS) },
    })
    return { status: 500 }
  }
}

// Existing-registration pay-now: the staged CheckoutSession references a
// Registration that already exists (created earlier as a PENDING bank-transfer
// booking). Mark it PAID. Never persists a new registration. No refunds: an
// amount mismatch or an already-settled row keeps the money and alerts ops.
async function completeExistingRegistrationPayment(
  session: import("stripe").Stripe.Checkout.Session,
  staging: { id: number; registrationId: number | null; surchargeCents: number },
): Promise<{ status: number }> {
  const reg = await prisma.registration.findUnique({
    where: { id: staging.registrationId! },
    // paymentRef distinguishes a benign same-session redelivery from a genuine
    // second charge in the already-settled branch below ( parity).
    select: { id: true, publicToken: true, totalAmount: true, paymentRef: true },
  })
  const paymentIntent = piOf(session.payment_intent)
  if (!reg) {
    // Registration vanished (e.g. DRAFT reset) after checkout started; SetNull
    // would also have nulled registrationId, so this is the belt-and-braces case.
    console.error(
      `Stripe webhook: paid pay-now session ${session.id} has no registration (id ${staging.registrationId}); money retained, manual review needed`,
    )
    await notifyStripeAlert(
      "card pay-now: registration missing after payment",
      `Session ${session.id}: settled but the target registration no longer exists. Money retained; resolve manually.`,
    )
    return { status: 200 }
  }

  const expectedCents = toCents(reg.totalAmount) + staging.surchargeCents
  if (session.amount_total !== toStripeAmount(expectedCents)) {
    console.error(
      `Stripe webhook: pay-now amount mismatch (charged ${session.amount_total}, expected ${toStripeAmount(expectedCents)}) for PI ${paymentIntent ?? "?"}; registration ${reg.id} left unpaid, money retained`,
    )
    await notifyStripeAlert(
      "card pay-now: amount mismatch — money retained",
      `Charged ${session.amount_total}, expected ${toStripeAmount(expectedCents)} for registration ${reg.id} (session ${session.id}). Not marked paid.`,
    )
    await prisma.checkoutSession.update({ where: { id: staging.id }, data: { status: "UNFULFILLED" } })
    return { status: 200 }
  }

  // Idempotent flip: only a still-PENDING row transitions.
  const upd = await prisma.registration.updateMany({
    where: { id: reg.id, paymentStatus: "PENDING" },
    data: { paymentStatus: "PAID", paymentRef: paymentIntent ?? undefined },
  })
  if (upd.count === 0) {
    // count===0: the flip didn't apply because the row is no longer PENDING. Two
    // cases, distinguished by comparing the stored paymentRef to this delivery's
    // PaymentIntent (mirrors the legacy completion path):
    //  - SAME PaymentIntent already on the row → a benign same-session redelivery
    //    (a prior pass marked PAID then died before the token write below). Just
    //    backfill the token; do NOT alert — the legacy path's false-alert bug.
    //  - DIFFERENT PaymentIntent (or a bank-reconciled PAID with no paymentRef) →
    //    a genuine second charge on an already-settled registration. Keep the
    //    money (no-refund policy) and alert ops.
    const sameChargeRedelivered = !!paymentIntent && reg.paymentRef === paymentIntent
    if (!sameChargeRedelivered) {
      console.error(
        `Stripe webhook: pay-now for registration ${reg.id} that was already settled; second payment retained, manual review needed`,
      )
      await notifyStripeAlert(
        "card pay-now: registration already settled — payment retained",
        `Registration ${reg.id} (session ${session.id}) was already paid when a card pay-now settled. No double credit; money retained.`,
      )
    }
  }

  // Resolve the success page (?token=cs_...) to the now-PAID registration, even
  // in the already-settled case — the payer should see the paid state, not
  // "being finalised".
  await prisma.checkoutSession.update({ where: { id: staging.id }, data: { publicToken: reg.publicToken } })
  return { status: 200 }
}

// Normalises a Stripe expandable reference (string id or expanded object) to a
// plain id string, or null when absent.
function piOf(pi: string | { id: string } | null | undefined): string | null {
  if (!pi) return null
  return typeof pi === "string" ? pi : pi.id
}

// Reacts to a Stripe-side reversal (full refund or chargeback): resolves the
// Registration by its plaintext paymentRef (the PaymentIntent id) and frees the
// seat by flipping it CANCELLED. No AuditLog — the webhook is not a user action
// and AuditLog.userId is a non-null FK to User; the console.error is the durable
// ops signal. Never issues a refund.
async function cancelRegistrationByPaymentIntent(pi: string | null, reason: string): Promise<{ status: number }> {
  if (!pi) return { status: 200 }
  const findReg = () =>
    prisma.registration.findFirst({
      where: { paymentRef: pi },
      select: { id: true, eventId: true, paymentStatus: true },
    })
  let reg = await findReg()
  if (!reg) {
    if (await checkoutInFlight(pi)) {
      console.error(`Stripe webhook: ${reason} for PI ${pi} arrived before its checkout completed; deferring for Stripe redelivery`)
      return { status: 500 }
    }
    // Completion may have landed while we resolved the session — look again
    // before acknowledging, or its registration would stay active.
    reg = await findReg()
    if (!reg) return { status: 200 }
  }
  if (reg.paymentStatus === "CANCELLED") return { status: 200 } // already cancelled → no-op
  await prisma.registration.update({ where: { id: reg.id }, data: { paymentStatus: "CANCELLED" } })
  console.error(`Stripe webhook: registration ${reg.id} (event ${reg.eventId}) auto-cancelled by ${reason}`)
  return { status: 200 }
}

// No registration carries this PaymentIntent yet. Stripe doesn't order
// deliveries, so the reversal may have beaten checkout.session.completed —
// acknowledging it now would let that later completion activate a refunded or
// disputed booking. Resolve the PI to its Checkout Session: while
// the staging row is still in flight (OPEN, or COMPLETED but not yet holding
// its registration's token) return 500 so Stripe redelivers the reversal after
// completion lands. Any other state means no registration will ever carry this
// PI (unknown PI, expired, unfulfilled, or a second charge on an already-settled
// booking) — the caller re-checks paymentRef once, then acknowledges.
async function checkoutInFlight(pi: string): Promise<boolean> {
  const { data } = await getStripe().checkout.sessions.list({ payment_intent: pi, limit: 1 })
  if (!data[0]) return false
  const staging = await prisma.checkoutSession.findUnique({
    where: { stripeSessionId: data[0].id },
    select: { status: true, publicToken: true },
  })
  return staging?.status === "OPEN" || (staging?.status === "COMPLETED" && !staging.publicToken)
}
