import Stripe from "stripe"

// Optional-feature pattern (mirrors turnstile.ts): the whole event-payment
// feature is inert unless STRIPE_SECRET_KEY is configured. Never construct the
// client at module load — that would throw at import time when the key is unset.
/** API version this app is written against; bump deliberately with the SDK, never implicitly. */
export const STRIPE_API_VERSION = "2026-10-28.endive"

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

let _stripe: Stripe | null = null

/** Lazily builds and memoizes the Stripe client pinned to the SDK's API version; throws if STRIPE_SECRET_KEY is unset. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Stripe not configured")
  // Pins the API version of this client's OWN requests only (account-default
  // drift can't change them). It does NOT pin webhook event payload shape: each
  // webhook endpoint has its own immutable api_version set at creation.
  if (!_stripe) _stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION })
  return _stripe
}
