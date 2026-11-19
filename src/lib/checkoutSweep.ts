import { prisma } from "@/lib/prisma"

// How long an EXPIRED row keeps its (encrypted) staged payload after its
// Stripe session lapsed. Stripe retries a failed webhook delivery for up to
// ~3 days, so a paid confirmation that lands late (app down or restarting
// when Stripe first called) can still build the booking from the payload.
// After this window the payload is scrubbed. The window is measured from
// `expiresAt`, which the sweep rewrites to the moment it marks a row EXPIRED
// (and which a delayed-settlement `completed` delivery pushes forward).
export const PAYLOAD_GRACE_MS = 72 * 60 * 60 * 1000

// Prisma filter for an EXPIRED new-registration ticket row that still holds
// its staged payload: a late paid confirmation can still claim it. Pay-now
// rows (registrationId set) are excluded here; see PAY_NOW_LATE_CLAIMABLE_WHERE.
export const LATE_CLAIMABLE_WHERE = { status: "EXPIRED", registrationId: null, payload: { not: "" } } as const

// Pay-now twin: an EXPIRED row tied to an existing Registration. It holds no
// payload, so late completion needs nothing but the registration itself.
export const PAY_NOW_LATE_CLAIMABLE_WHERE = { status: "EXPIRED", registrationId: { not: null } } as const

/**
 * In-memory twin of PAY_NOW_LATE_CLAIMABLE_WHERE.
 * @param row the staged CheckoutSession fields
 * @returns whether a paid delivery may still claim the EXPIRED pay-now row
 */
export function isPayNowLateClaimable(row: { status: string; registrationId: number | null }): boolean {
  return row.status === "EXPIRED" && row.registrationId != null
}

/**
 * In-memory twin of LATE_CLAIMABLE_WHERE. Expiry only means "the Stripe
 * session lapsed by the clock", not "cannot have been paid": a late or
 * retried paid confirmation can still build the booking from the payload
 * while it is held (PAYLOAD_GRACE_MS).
 * @param row the staged CheckoutSession fields
 * @returns whether a paid delivery may still claim the EXPIRED row
 */
export function isLateClaimable(row: { status: string; registrationId: number | null; payload: string | null }): boolean {
  return row.status === "EXPIRED" && row.registrationId == null && !!row.payload
}

/**
 * Expire abandoned pay-now staging rows, then scrub the PII payload of rows
 * that an earlier run marked EXPIRED more than PAYLOAD_GRACE_MS ago (the
 * window runs from the moment of expiry, or from the last delayed-settlement
 * push of expiresAt, not from the original Stripe expiry). A row is OPEN only
 * until either the webhook completes it or its Stripe session lapses;
 * anything still OPEN past expiresAt was abandoned mid-checkout, or its paid
 * confirmation is late. Expiry keeps the payload so `completePaidCheckout`
 * can still claim the row when Stripe confirms late.
 * @returns rows newly expired, and rows whose payload was scrubbed
 */
export async function sweepExpiredCheckouts(): Promise<{ expired: number; scrubbed: number }> {
  const now = Date.now()
  // Scrub BEFORE expiring: a row this run newly marks EXPIRED (e.g. the sweep
  // was down for days, so expiresAt is long past) is then not scrubbed until
  // the next run, so a late paid delivery still gets at least one sweep
  // interval to claim it. Only rows already EXPIRED by an earlier run are
  // scrubbed here.
  const scrubbed = await prisma.checkoutSession.updateMany({
    where: { status: "EXPIRED", payload: { not: "" }, expiresAt: { lt: new Date(now - PAYLOAD_GRACE_MS) } },
    data: { payload: "" },
  })
  const expired = await prisma.checkoutSession.updateMany({
    where: { status: "OPEN", expiresAt: { lt: new Date(now) } },
    // expiresAt doubles as "when the row became EXPIRED" from here on, so the
    // payload grace window above is measured from this moment, not from the
    // (possibly days-old) Stripe session expiry the sweep only noticed late.
    data: { status: "EXPIRED", expiresAt: new Date(now) },
  })
  return { expired: expired.count, scrubbed: scrubbed.count }
}
