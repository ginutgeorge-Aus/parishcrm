import { handleStripeWebhook } from "@/lib/stripeCheckout"
import { exceedsBodyLimit } from "@/lib/bodyLimit"

// Needs the raw request body (signature verification hashes the exact bytes
// Stripe sent) and the Node Stripe SDK — not Edge-compatible.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// This route is fully public/unauthenticated. Stripe events are small, but
// reject before buffering an unbounded body into heap (same pattern as
// the event-register route) — generous headroom over a real event payload.
const MAX_BODY_BYTES = 256 * 1024

export async function POST(req: Request) {
  if (exceedsBodyLimit(req, MAX_BODY_BYTES)) return new Response(null, { status: 413 })
  const rawBody = await req.text() // MUST be raw text, never req.json() — signature verification needs the exact bytes
  const sig = req.headers.get("stripe-signature")
  const { status } = await handleStripeWebhook(rawBody, sig)
  return new Response(null, { status })
}
