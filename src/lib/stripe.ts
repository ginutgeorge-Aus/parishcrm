import Stripe from "stripe"

// Optional-feature pattern (mirrors turnstile.ts): the whole event-payment
// feature is inert unless STRIPE_SECRET_KEY is configured. Never construct the
// client at module load — that would throw at import time when the key is unset.
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Stripe not configured")
  // Pin the API version so a Stripe account-default drift can't change the
  // webhook payload shape. Value = the installed SDK's bundled version.
  if (!_stripe) _stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" })
  return _stripe
}
