// Shared Prisma `include` shape for fetching an Event with enough of its
// ticketTypes/registrationItems to compute capacity. Used by BOTH the public
// register endpoint (`fetchEventWithTickets` in eventRegistration.ts) and the
// Stripe webhook's authoritative re-check (`handleStripeWebhook` in
// stripeCheckout.ts) — keeping this in one leaf module (no other local
// imports) means the two capacity checks can never silently drift apart, and
// keeps this constant out of the `@/lib/eventRegistration` mock the webhook
// test already relies on (that mock only stubs `persistRegistration`).
//
// CANCELLED registrations release their seats — only PENDING/PAID holds count
// toward capacity.
export const EVENT_CAPACITY_INCLUDE = {
  ticketTypes: {
    include: {
      registrationItems: {
        where: { registration: { paymentStatus: { not: "CANCELLED" } } },
        select: { quantity: true },
      },
    },
  },
} as const
