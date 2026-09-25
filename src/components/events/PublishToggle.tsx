"use client"

import { useEffect, useState, useTransition } from "react"
import { publishEvent } from "@/lib/actions/event"
import { Button } from "@/components/ui/button"

type Props = { eventId: number; isPublished: boolean }

export function PublishToggle({ eventId, isPublished }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Reflect the new state immediately on click instead of waiting for the
  // parent to re-render after the server action + revalidatePath. Reverts on error.
  const [optimisticPublished, setOptimisticPublished] = useState(isPublished)

  // Re-sync when `isPublished` changes server-side through a path other than
  // this toggle (another admin session, or a route-wide revalidation) while this
  // instance stays mounted, so the button never shows stale state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOptimisticPublished(isPublished), [isPublished])

  const toggle = () =>
    startTransition(async () => {
      setError(null)
      const next = !optimisticPublished
      setOptimisticPublished(next)
      const result = await publishEvent(eventId, next)
      if (result?.error) {
        setOptimisticPublished(!next)
        setError(result.error)
      }
    })

  return (
    <>
      <Button
        onClick={toggle}
        disabled={isPending}
        variant={optimisticPublished ? "secondary" : "default"}
        size="lg"
      >
        {optimisticPublished ? "Unpublish" : "Publish Event"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive mt-1">{error}</p>}
    </>
  )
}
