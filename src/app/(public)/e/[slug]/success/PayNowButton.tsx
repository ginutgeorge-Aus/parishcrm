"use client"
import { useState, useTransition } from "react"
import { startExistingRegistrationCheckout } from "@/lib/actions/eventCheckout"
import { navigateTo } from "@/lib/navigate"

/**
 * "Pay now by card" button for a pending registration on the public success page.
 * Failures show the server's message plus the church contact email so the attendee has a next step.
 * @param slug event slug
 * @param publicToken the registration's opaque public token
 * @param passCardFee whether a card processing fee applies (shows a note)
 * @param churchEmail contact address shown as a mailto link under non-transient errors
 */
export function PayNowButton({ slug, publicToken, passCardFee, churchEmail }: Readonly<{ slug: string; publicToken: string; passCardFee: boolean; churchEmail: string }>) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<{ message: string; showContact: boolean } | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await startExistingRegistrationCheckout(slug, publicToken)
      if (res.ok) {
        navigateTo(res.url)
      } else {
        // A 429 rate limit is transient: retrying fixes it, so no contact line.
        setError({ message: res.error, showContact: res.status !== 429 })
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
        <p role="alert" className="mt-2 text-center text-sm text-destructive">
          {error.message}
          {error.showContact && (
            <>
              {" "}Questions? Contact us at{" "}
              <a href={`mailto:${churchEmail}`} className="underline">{churchEmail}</a>
            </>
          )}
        </p>
      )}
    </div>
  )
}
