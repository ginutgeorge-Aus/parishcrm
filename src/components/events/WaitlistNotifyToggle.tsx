"use client"

import { useEffect, useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { markWaitlistNotified } from "@/lib/actions/waitlist"

export function WaitlistNotifyToggle({
  id,
  eventId,
  notified,
  canEdit,
}: {
  id: number
  eventId: number
  notified: boolean
  canEdit: boolean
}) {
  const [optimistic, setOptimistic] = useState(notified)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Re-sync when the server `notified` prop changes on a later re-render of this
  // still-mounted row (a page-wide revalidation from an unrelated action, or
  // another actor/cron flipping the value) so the badge never shows stale
  // optimistic state vs server truth.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOptimistic(notified), [notified])

  if (!canEdit) {
    return optimistic
      ? <Badge variant="default">Notified</Badge>
      : <Badge variant="outline">Pending</Badge>
  }

  function handleClick() {
    const next = !optimistic
    setOptimistic(next)
    setError(null)
    startTransition(async () => {
      try {
        const result = await markWaitlistNotified(id, eventId, next)
        if (result?.error) {
          setOptimistic(!next)
          setError(result.error)
        }
      } catch {
        // A rejected action (network/server throw) skips the result.error branch;
        // roll back to the previous value and surface an inline error.
        setOptimistic(!next)
        setError("Could not update. Please try again.")
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={optimistic ? "Mark as pending" : "Mark as notified"}
      >
        {optimistic
          ? <Badge variant="default">Notified</Badge>
          : <Badge variant="outline">Pending</Badge>}
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
