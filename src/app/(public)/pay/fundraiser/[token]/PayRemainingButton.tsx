"use client"
import { useState, useTransition } from "react"
import { startFundraiserCheckout } from "@/lib/actions/eventCheckout"
import { navigateTo } from "@/lib/navigate"

/**
 * "Pay remaining by card" button for the public fundraiser pay page. Starts a
 * Stripe Checkout for the entry's remaining balance and redirects to it.
 * @param publicToken the entry's opaque public token
 * @param feeLabel formatted card fee to show, or null when no fee is passed on
 */
export function PayRemainingButton({ publicToken, feeLabel }: Readonly<{ publicToken: string; feeLabel: string | null }>) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  /** Start checkout; redirect on success, show the error otherwise. */
  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await startFundraiserCheckout(publicToken)
      if (res.ok) navigateTo(res.url)
      else setError(res.error)
    })
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="w-full min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Redirecting…" : "Pay remaining by card"}
      </button>
      {feeLabel && (
        <p className="mt-2 text-center text-xs text-muted-foreground">A card processing fee of {feeLabel} applies.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
