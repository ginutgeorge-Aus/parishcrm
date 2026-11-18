import { prisma } from "@/lib/prisma"

// How long an EXPIRED row keeps its (encrypted) staged payload after its
// Stripe session lapsed. Stripe retries a failed webhook delivery for up to
// ~3 days, so a paid confirmation that lands late (app down or restarting
// when Stripe first called) can still build the booking from the payload.
// After this window the payload is scrubbed.
export const PAYLOAD_GRACE_MS = 72 * 60 * 60 * 1000

/**
 * Expire abandoned pay-now staging rows, then scrub the PII payload of rows
 * that have been expired longer than PAYLOAD_GRACE_MS. A row is OPEN only
 * until either the webhook completes it or its Stripe session lapses;
 * anything still OPEN past expiresAt was abandoned mid-checkout, or its paid
 * confirmation is late. Expiry keeps the payload so `completePaidCheckout`
 * can still claim the row when Stripe confirms late.
 * @returns rows newly expired, and rows whose payload was scrubbed
 */
export async function sweepExpiredCheckouts(): Promise<{ expired: number; scrubbed: number }> {
  const now = Date.now()
  const expired = await prisma.checkoutSession.updateMany({
    where: { status: "OPEN", expiresAt: { lt: new Date(now) } },
    data: { status: "EXPIRED" },
  })
  const scrubbed = await prisma.checkoutSession.updateMany({
    where: { status: "EXPIRED", payload: { not: "" }, expiresAt: { lt: new Date(now - PAYLOAD_GRACE_MS) } },
    data: { payload: "" },
  })
  return { expired: expired.count, scrubbed: scrubbed.count }
}
