"use client"

import { useEffect, useState, useTransition } from "react"
import { setRegistrationClosed } from "@/lib/actions/event"
import { Button } from "@/components/ui/button"

type Props = { eventId: number; registrationClosed: boolean }

export function CloseRegistrationToggle({ eventId, registrationClosed }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [optimisticClosed, setOptimisticClosed] = useState(registrationClosed)

  // Re-sync when `registrationClosed` changes server-side through a path other
  // than this toggle (another admin session, or a route-wide revalidation) while
  // this instance stays mounted, so the button never shows stale state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOptimisticClosed(registrationClosed), [registrationClosed])

  const toggle = () =>
    startTransition(async () => {
      setError(null)
      const next = !optimisticClosed
      setOptimisticClosed(next)
      try {
        const result = await setRegistrationClosed(eventId, next)
        if (result?.error) {
          setOptimisticClosed(!next)
          setError(result.error)
        }
      } catch {
        setOptimisticClosed(!next)
        setError("Failed to update registration status")
      }
    })

  return (
    <>
      <Button
        onClick={toggle}
        disabled={isPending}
        variant={optimisticClosed ? "default" : "secondary"}
        size="lg"
      >
        {optimisticClosed ? "Reopen Registration" : "Close Registration"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive mt-1">{error}</p>}
    </>
  )
}
