import { notFound } from "next/navigation"
import { headers } from "next/headers"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { isFeatureOn } from "@/lib/featureFlags"
import { rateLimit } from "@/lib/rateLimit"
import { rateKeyFromHeaders } from "@/lib/clientIp"
import { stripeConfigured } from "@/lib/stripe"
import { fmtAUD, centsToNumber, toCents } from "@/lib/formatting"
import { entryTotals } from "@/lib/fundraiserMath"
import { fundraiserSurchargeCents } from "@/lib/fundraiserCheckout"
import { getChurchSettings } from "@/lib/churchSettings"
import { PayRemainingButton } from "./PayRemainingButton"

// Opaque-token page: never index/follow a leaked link.
export const metadata: Metadata = { robots: { index: false, follow: false } }

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string | string[] }> }

// Entry tokens are base64url (mintEntryToken). Anything else is a 404 with no DB lookup.
const TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/
// Throttle token lookups per IP so the page is not a brute-force oracle.
const LOOKUP_LIMIT = 20
const LOOKUP_WINDOW_MS = 60_000

/**
 * Format integer cents for display.
 * @param cents integer cents
 */
const money = (cents: number) => fmtAUD(centsToNumber(cents))

/**
 * Public fundraiser balance page, linked from reminder emails. Resolves the
 * entry by its opaque `publicToken` only and shows owed / paid / remaining plus
 * the bank reference. The card button shows only when something remains, Stripe
 * is configured and the event takes online payments. Shows no buyer name or
 * contact details.
 * @param props route params (token) and search params (`paid=1` after Stripe)
 */
export default async function FundraiserPayPage(props: Readonly<Props>) {
  const { token } = await props.params
  const searchParams = await props.searchParams
  if (!(await isFeatureOn("events"))) notFound()
  if (!TOKEN_RE.test(token)) notFound()

  const { email: churchEmail } = await getChurchSettings()
  if (!rateLimit(`fundraiser-page:${rateKeyFromHeaders(await headers())}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS)) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Too many requests</h1>
          <p className="text-muted-foreground">Please wait a moment and reload this page. Questions? Contact us at {churchEmail}</p>
        </div>
      </div>
    )
  }

  const entry = await prisma.fundraiserEntry.findUnique({
    where: { publicToken: token },
    select: {
      quantity: true, unitPrice: true, delivery: true, bankRef: true,
      payments: { select: { amount: true } },
      fundraiser: {
        select: {
          name: true, unitLabel: true, deliveryPrice: true,
          event: { select: { title: true, onlinePaymentEnabled: true, passCardFee: true } },
        },
      },
    },
  })
  if (!entry) notFound()

  const { fundraiser } = entry
  const { event } = fundraiser
  const t = entryTotals(entry, entry.payments)
  const canPayByCard = t.remainingCents > 0 && stripeConfigured() && event.onlinePaymentEnabled
  const feeCents = canPayByCard ? await fundraiserSurchargeCents(t.remainingCents, event.passCardFee) : 0
  const paidParam = Array.isArray(searchParams.paid) ? searchParams.paid[0] : searchParams.paid
  const justPaid = paidParam === "1"

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <div className="bg-card rounded-2xl border border-border p-6 sm:p-8">
        <p className="text-sm text-muted-foreground">{event.title}</p>
        <h1 className="text-2xl font-bold text-foreground mb-1">{fundraiser.name}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {entry.quantity} × {fundraiser.unitLabel} at {money(toCents(entry.unitPrice))}
          {fundraiser.deliveryPrice !== null && (entry.delivery ? " (delivery)" : " (pickup)")}
        </p>

        {justPaid && (
          <p role="status" className="mb-4 rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
            Thank you. If your card payment went through, it will show below within a minute.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="text-right font-medium">{money(t.owedCents)}</dd>
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="text-right font-medium">{money(t.paidCents)}</dd>
          <dt className="text-muted-foreground font-semibold">Remaining</dt>
          <dd className="text-right font-semibold">{money(t.remainingCents)}</dd>
        </dl>

        {t.remainingCents > 0 && (
          <p className="mt-6 text-sm text-muted-foreground">
            Paying by bank transfer? Use reference <span className="font-mono font-semibold text-foreground">{entry.bankRef}</span>.
          </p>
        )}
        {t.remainingCents === 0 && (
          <p className="mt-6 text-sm text-foreground">Nothing left to pay. Thank you!</p>
        )}

        {canPayByCard && <PayRemainingButton publicToken={token} feeLabel={feeCents > 0 ? money(feeCents) : null} />}

        <p className="mt-6 text-center text-xs text-muted-foreground">Questions? Contact us at {churchEmail}</p>
      </div>
    </div>
  )
}
