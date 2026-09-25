import { prisma } from "@/lib/prisma"

// Expire abandoned pay-now staging rows and scrub their (encrypted) PII payload.
// A row is OPEN only until either the webhook completes it or its Stripe session
// lapses; anything still OPEN past expiresAt was abandoned mid-checkout.
export async function sweepExpiredCheckouts(): Promise<{ expired: number }> {
  const res = await prisma.checkoutSession.updateMany({
    where: { status: "OPEN", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", payload: "" },
  })
  return { expired: res.count }
}
