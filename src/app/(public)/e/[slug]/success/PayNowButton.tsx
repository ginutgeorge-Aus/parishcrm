"use client"
import { useState, useTransition } from "react"
import { startExistingRegistrationCheckout } from "@/lib/actions/eventCheckout"
import { navigateTo } from "@/lib/navigate"

export function PayNowButton({ slug, publicToken, passCardFee }: { slug: string; publicToken: string; passCardFee: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await startExistingRegistrationCheckout(slug, publicToken)
      if (res.ok) {
        navigateTo(res.url)
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="w-full min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Redirecting…" : "Pay now by card"}
      </button>
      {passCardFee && (
        <p className="mt-2 text-center text-xs text-muted-foreground">A card processing fee applies.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
